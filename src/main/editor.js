'use strict';

const fs = require('fs');
const path = require('path');
const { BrowserWindow, dialog, shell, ipcMain } = require('electron');

const { parseBuild, serializeBuild } = require('./parse');
const { convert } = require('./import-vespene');
const { safeSend } = require('./send');

/**
 * The build-order editor: a normal, focusable window (unlike the overlay) that
 * reads and writes the files in `builds/`.
 */
function setupEditor({ buildsDir, iconPath, library, getGameState }) {
  let win = null;

  // The last opened export, kept so switching branch or toggling an option
  // re-converts without asking for the file again.
  let lastExport = null;

  const safeName = (filename) => {
    const base = path.basename(String(filename || '').trim());
    if (!base || base === '.' || base === '..') return null;
    const withExt = /\.(txt|build|md)$/i.test(base) ? base : `${base}.txt`;
    // Reject anything that tried to escape the builds folder.
    const full = path.resolve(buildsDir, withExt);
    if (path.dirname(full) !== path.resolve(buildsDir)) return null;
    return withExt;
  };

  function open() {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return;
    }

    win = new BrowserWindow({
      width: 940,
      height: 780,
      minWidth: 720,
      minHeight: 520,
      title: '빌드오더 편집기',
      icon: iconPath,
      backgroundColor: '#0d1017',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'editor-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.loadFile(path.join(__dirname, '..', 'renderer', 'editor.html'));
    win.on('closed', () => {
      win = null;
    });
  }

/**
   * Rewrites only the `slot:` line of a build file, leaving everything else —
   * including `#` comments — byte-identical. Re-serialising the whole file
   * would drop those.
   */
  const setSlotInFile = (file, slot) => {
    const text = fs.readFileSync(file, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);

    const at = lines.findIndex((l) => /^slot\s*:/i.test(l));
    if (at >= 0) {
      if (slot == null) lines.splice(at, 1);
      else lines[at] = `slot: ${slot}`;
    } else if (slot != null) {
      // Headers are only read before the first step or section, so insert after
      // the last one rather than at the top of the file.
      let last = -1;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (/^\[.+\]$/.test(line) || /^\d{1,3}:[0-5]?\d(\s|$)/.test(line)) break;
        if (/^[A-Za-z][A-Za-z0-9_-]*\s*:/.test(line)) last = i;
      }
      lines.splice(last + 1, 0, `slot: ${slot}`);
    }

    fs.writeFileSync(file, lines.join(eol), 'utf8');
  };

  /**
   * Electron's showMessageBox takes either (window, options) or (options) —
   * passing a dead window is not allowed, so pick the arity at the call site.
   */
  const ask = (options) =>
    win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);

  /** Pushes the live game clock so steps can be timed against a real game. */
  function pushClock() {
    if (!win || win.isDestroyed()) return;
    const game = getGameState();
    safeSend(win, 'clock', {
      connected: game.connected,
      inGame: game.inGame,
      mock: Boolean(game.mock),
      displayTime: game.displayTime,
    });
  }

  ipcMain.handle('editor:list', () =>
    library.builds.map((b) => ({
      source: b.source,
      name: b.name,
      slot: b.slot,
      // The declared one is what collides; an auto-filled slot just moves.
      declaredSlot: b.declaredSlot,
      steps: b.steps.length,
      problems: b.problems.length,
    }))
  );

  ipcMain.handle('editor:read', (_e, source) => {
    const filename = safeName(source);
    if (!filename) throw new Error('잘못된 파일 이름입니다.');
    const full = path.join(buildsDir, filename);
    const text = fs.readFileSync(full, 'utf8');
    const parsed = parseBuild(text, filename);
    return {
      filename,
      raw: text,
      build: {
        name: parsed.name,
        race: parsed.race,
        vs: parsed.vs,
        slot: parsed.declaredSlot,
        notes: parsed.notes,
        steps: parsed.steps,
      },
      problems: parsed.problems,
      // The editor rebuilds the file from structured data, so anything the
      // format does not model would be dropped on save. Warn instead of losing it.
      hasComments: text.split(/\r?\n/).some((l) => l.trim().startsWith('#')),
    };
  });

  ipcMain.handle('editor:preview', (_e, build) => {
    const text = serializeBuild(build);
    const parsed = parseBuild(text, 'preview.txt');
    return { text, problems: parsed.problems, steps: parsed.steps.length };
  });

  ipcMain.handle('editor:save', async (_e, { filename, build, replacing }) => {
    const target = safeName(filename);
    if (!target) return { ok: false, message: '파일 이름을 확인하세요.' };

    const text = serializeBuild(build);
    const parsed = parseBuild(text, target);
    if (parsed.problems.length) {
      return { ok: false, message: `내보낸 내용이 다시 읽히지 않습니다: ${parsed.problems[0].message}` };
    }

    const full = path.join(buildsDir, target);
    const previous = safeName(replacing);
    const overwriting = fs.existsSync(full) && target !== previous;
    if (overwriting) {
      const { response } = await ask({
        type: 'question',
        buttons: ['덮어쓰기', '취소'],
        defaultId: 1,
        cancelId: 1,
        message: `${target} 파일이 이미 있습니다. 덮어쓸까요?`,
      });
      if (response === 1) return { ok: false, message: '취소했습니다.' };
    }

    // Taking a slot another file declares would otherwise be resolved by
    // "first one wins", silently moving this build somewhere else. Swap
    // instead: the other build gets the slot this one was using.
    let swapped = null;
    const chosen = parsed.declaredSlot;
    if (chosen) {
      const holder = library.builds.find((b) => b.declaredSlot === chosen && b.source !== target);
      if (holder) {
        const mine = library.find(target);
        const giveBack = mine ? mine.declaredSlot : null;
        try {
          setSlotInFile(path.join(buildsDir, holder.source), giveBack);
          swapped = { name: holder.name, slot: giveBack };
        } catch (err) {
          return { ok: false, message: `${holder.source} 의 슬롯을 바꿀 수 없습니다: ${err.message}` };
        }
      }
    }

    fs.writeFileSync(full, text, 'utf8');

    // Renaming: retire the old file so the slot list does not show both.
    if (previous && previous !== target) {
      const oldFull = path.join(buildsDir, previous);
      if (fs.existsSync(oldFull)) await shell.trashItem(oldFull);
    }

    library.load();
    return { ok: true, filename: target, steps: parsed.steps.length, swapped };
  });

  ipcMain.handle('editor:delete', async (_e, source) => {
    const filename = safeName(source);
    if (!filename) return { ok: false, message: '잘못된 파일 이름입니다.' };
    const full = path.join(buildsDir, filename);
    if (!fs.existsSync(full)) return { ok: false, message: '파일이 없습니다.' };

    const { response } = await ask({
      type: 'warning',
      buttons: ['휴지통으로 이동', '취소'],
      defaultId: 1,
      cancelId: 1,
      message: `${filename} 을 삭제할까요?`,
      detail: '휴지통으로 이동하므로 되돌릴 수 있습니다.',
    });
    if (response === 1) return { ok: false, message: '취소했습니다.' };

    await shell.trashItem(full);
    library.load();
    return { ok: true };
  });

  ipcMain.handle('editor:import', (_e, raw) => {
    const parsed = parseBuild(String(raw || ''), 'import.txt');
    return {
      build: {
        name: parsed.meta.name ? parsed.name : '',
        race: parsed.race,
        vs: parsed.vs,
        slot: parsed.declaredSlot,
        notes: parsed.notes,
        steps: parsed.steps,
      },
      problems: parsed.problems,
    };
  });

  /**
   * Opens a build-order export and reports its branches. Conversion is a second
   * step: which branch to take is a real decision (they carry different win
   * rates), so it is never made silently.
   */
  ipcMain.handle('editor:open-export', async () => {
    const { canceled, filePaths } = await (win && !win.isDestroyed()
      ? dialog.showOpenDialog(win, {
          title: '빌드 익스포트 열기',
          filters: [{ name: '빌드 익스포트 (JSON)', extensions: ['json'] }],
          properties: ['openFile'],
        })
      : dialog.showOpenDialog({ properties: ['openFile'] }));

    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };

    const file = filePaths[0];
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return { ok: false, message: `JSON 을 읽을 수 없습니다: ${err.message}` };
    }

    const probe = convert(data);
    if (!probe.ok) return { ok: false, message: probe.message };

    lastExport = { data, file };
    return {
      ok: true,
      filename: path.basename(file),
      title: data.name || null,
      branches: probe.branches,
      selected: probe.selected,
    };
  });

  /** Converts the opened export's chosen branch with the chosen options. */
  ipcMain.handle('editor:convert-export', (_e, { branchId, options } = {}) => {
    if (!lastExport) return { ok: false, message: '먼저 익스포트 파일을 여세요.' };
    const result = convert(lastExport.data, { ...options, branchId });
    if (!result.ok) return result;
    return {
      ok: true,
      build: result.build,
      notes: result.notes,
      missing: result.missing,
      selected: result.selected,
    };
  });

  ipcMain.handle('editor:open-dir', () => shell.openPath(buildsDir));

  return { open, pushClock, isOpen: () => Boolean(win && !win.isDestroyed()) };
}

module.exports = { setupEditor };
