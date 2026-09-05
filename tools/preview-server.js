/**
 * Dev-only: serves the overlay, editor and control UIs over HTTP with their
 * preload bridges stubbed, so the layouts can be inspected in an ordinary
 * browser. They normally run in Electron windows against the real `builds/`.
 *
 *   node tools/preview-server.js
 *     http://localhost:4173/index.html    (overlay, on a mock game backdrop)
 *     http://localhost:4173/control.html
 *     http://localhost:4173/editor.html
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const PORT = 4173;
const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
};

const ICONS_DIR = path.join(__dirname, '..', 'assets', 'icons');
// PREVIEW_ICONS=small|large to inspect the icon layouts.
const ICON_MODE = process.env.PREVIEW_ICONS || 'none';

const EXPORT_FILE = process.env.PREVIEW_EXPORT || '';
let EXPORT_PROBE = { ok: false };
if (EXPORT_FILE) {
  try {
    const { convert } = require(path.join(__dirname, '..', 'src', 'main', 'import-vespene.js'));
    const data = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8'));
    const probe = convert(data);
    EXPORT_PROBE = {
      ok: probe.ok,
      filename: path.basename(EXPORT_FILE),
      title: data.name || null,
      branches: probe.branches,
      selected: probe.selected,
      // Pre-convert every branch under a few option sets so the stub can answer
      // without running the converter in the browser.
      results: Object.fromEntries(
        probe.branches.flatMap((b) =>
          [true, false].flatMap((notes) =>
            [true, false].map((situational) => {
              const r = convert(data, { branchId: b.id, notes, situational });
              return [`${b.id}|${notes}|${situational}`, { ok: r.ok, build: r.build, notes: r.notes, missing: r.missing, selected: r.selected }];
            })
          )
        )
      ),
    };
  } catch (err) {
    EXPORT_PROBE = { ok: false, message: err.message };
  }
}

const EDITOR_STUB = `<script>
(() => {
  const SAMPLE = {
    name: 'TvZ 리퍼 앞마당', race: 'T', vs: 'Z', slot: 4, notes: '포맷 예시',
    steps: [
      { at: 0, supply: 12, action: 'SCV 계속 생산', note: null, section: '오프닝' },
      { at: 12, supply: 14, action: '보급고', note: null, section: '오프닝' },
      { at: 20, supply: 16, action: '병영', note: null, section: '오프닝' },
      { at: 40, supply: 16, action: '정련소', note: '리퍼 나오면 바로', section: '오프닝' },
      { at: 72, supply: 19, action: '사령부 (앞마당)', note: null, section: '확장' },
      { at: 90, supply: 20, action: '리퍼', note: null, section: '확장' }
    ]
  };
  function serialize(b) {
    const out = [];
    const h = (k, v) => { if (v != null && String(v).trim() !== '') out.push(k + ': ' + v); };
    h('name', b.name); h('race', b.race); h('vs', b.vs); h('slot', b.slot); h('notes', b.notes);
    let sec = null, first = true;
    for (const s of [...b.steps].sort((x, y) => x.at - y.at)) {
      const ss = s.section || null;
      if (first || ss !== sec) { out.push(''); if (ss) out.push('[' + ss + ']'); sec = ss; first = false; }
      const t = (Math.floor(s.at / 60) + ':' + String(s.at % 60).padStart(2, '0')).padEnd(5);
      const sup = (s.supply == null ? '' : '@' + s.supply).padEnd(4);
      out.push((t + ' ' + sup + ' ' + s.action + (s.note ? '  // ' + s.note : '')).trimEnd());
    }
    return out.join('\\n') + '\\n';
  }
  window.editor = {
    onClock: (cb) => { let t = 128; setInterval(() => cb({ connected: true, inGame: true, mock: true, displayTime: t += 0.35 }), 250); },
    list: async () => [
      { source: '1-tvt.txt', name: 'TvT', slot: 1, declaredSlot: 1, steps: 0, problems: 0 },
      { source: '2-tvp.txt', name: 'TvP', slot: 2, declaredSlot: 2, steps: 0, problems: 0 },
      { source: '3-allin.txt', name: '올인', slot: 3, declaredSlot: 3, steps: 0, problems: 0 },
      { source: 'example-tvz.txt', name: 'TvZ 리퍼 앞마당 (예시)', slot: 4, declaredSlot: null, steps: 16, problems: 0 }
    ],
    read: async () => ({ filename: 'example-tvz.txt', raw: '', build: SAMPLE, problems: [], hasComments: true }),
    preview: async (b) => ({ text: serialize(b), problems: [], steps: b.steps.length }),
    save: async () => ({ ok: true, filename: 'demo.txt', steps: 6 }),
    remove: async () => ({ ok: true }),
    importText: async () => ({ build: SAMPLE, problems: [] }),
    openDir: async () => {},
    openExport: async () => {
      const p = ${JSON.stringify(EXPORT_PROBE)};
      if (!p.ok) return { ok: false, message: p.message || '미리보기에 익스포트가 설정되지 않았습니다 (PREVIEW_EXPORT)' };
      window.__probe = p;
      return { ok: true, filename: p.filename, title: p.title, branches: p.branches, selected: p.selected };
    },
    convertExport: async ({ branchId, options }) => {
      const p = window.__probe;
      if (!p) return { ok: false, message: '먼저 파일을 여세요.' };
      const key = branchId + '|' + Boolean(options && options.notes) + '|' + (options ? options.situational !== false : true);
      return p.results[key] || { ok: false, message: '미리보기에 해당 조합이 없습니다: ' + key };
    }
  };
  addEventListener('DOMContentLoaded', () => setTimeout(() => document.querySelectorAll('.build-item')[3]?.click(), 120));
})();
</script>
`;

const BUILDS = [
  { source: '1-tvt.txt', name: 'TvT', slot: 1, race: 'T', vs: 'T', steps: 0, problems: 0 },
  { source: '2-tvp.txt', name: 'TvP', slot: 2, race: 'T', vs: 'P', steps: 0, problems: 0 },
  { source: '3-allin.txt', name: '올인', slot: 3, race: 'T', vs: '*', steps: 0, problems: 0 },
  { source: 'example-tvz.txt', name: 'TvZ 리퍼 앞마당 (예시)', slot: 4, race: 'T', vs: 'Z', steps: 16, problems: 0 }
];
const CONTROL_STUB = `<script>
(() => {
  const BUILDS = ${JSON.stringify(BUILDS)};
  let running = false, t = 0, visible = true, locked = true, mode = 'auto', active = 'example-tvz.txt';
  let pinned = null, favs = [];
  const settings = { iconMode: '${ICON_MODE}', iconsAvailable: true, iconFetch: null, opacity: 0.9, scale: 1, stepScale: 1, widthScale: 1, overlayWidth: 380, lookahead: 6, lookbehind: 1, leadSeconds: 3, autoPick: true, autoStart: false, autoStartOnGame: false, myName: '', soundEnabled: true, soundVolume: 0.5, soundFile: null, soundProblem: null };
  let listener = null;
  const step = { at: 72, supply: 19, action: '사령부 (앞마당)' };
  function emit() {
    if (!listener) return;
    listener({
      running,
      watching: !running && settings.autoStartOnGame,
      game: running
        ? { connected: true, inGame: true, mock: true, isReplay: false, displayTime: t,
            me: { name: 'You', race: 'T' }, opponent: { name: 'Mock Opponent', race: 'Z' },
            players: [
              { id: 1, name: 'You', type: 'user', race: 'T' },
              { id: 2, name: 'Mock Opponent', type: 'user', race: 'Z' },
            ] }
        : { connected: false, inGame: false, isReplay: false, displayTime: 0, me: null, opponent: null, players: [] },
      ui: { visible, locked, mode, manualIndex: 0, buildSource: active },
      settings, clock: t, nextIndex: 4, totalSteps: 16,
      activeSource: active, pinnedSource: pinned, favorites: favs,
      nextStep: running ? step : null, builds: BUILDS
    });
  }
  setInterval(() => { if (running) t += 0.35; emit(); }, 250);
  window.control = {
    onView: (cb) => { listener = cb; emit(); },
    start: async () => { running = true; t = 0; emit(); },
    stop: async () => { running = false; t = 0; emit(); },
    quit: async () => {},
    pickBuild: async (s) => { active = s; pinned = s; emit(); },
    clearPin: async () => { pinned = null; emit(); },
    toggleFavorite: async (s) => { favs = favs.includes(s) ? favs.filter(x=>x!==s) : [...favs, s]; emit(); },
    updateSettings: async (p) => {
      Object.assign(settings, p);
      // The real figure comes from the main process (overlayWidth). Mirrored
      // here, or the 가로 폭 slider would sit reporting the width it started at.
      const ICON_COLUMN = { none: 0, small: 1.15 * 15 + 6, large: 2.5 * 15 + 6 };
      settings.overlayWidth = Math.round(
        (380 + (ICON_COLUMN[settings.iconMode] || 0)) * settings.scale * settings.widthScale
      );
      emit();
    },
    setVisible: async (v) => { visible = v; emit(); },
    setLocked: async (l) => { locked = l; emit(); },
    setMode: async (m) => { mode = m; emit(); },
    pickSound: async () => { settings.soundFile = '미리보기.wav'; settings.soundProblem = null; emit(); },
    resetSound: async () => { settings.soundFile = null; settings.soundProblem = null; emit(); },
    fetchIcons: async () => {
      settings.iconFetch = { running: true, done: 0, total: 196, message: null };
      emit();
      for (let n = 24; n <= 196; n += 24) {
        await new Promise((r) => setTimeout(r, 120));
        settings.iconFetch = { running: true, done: Math.min(n, 196), total: 196, message: null };
        emit();
      }
      settings.iconFetch = { running: false, done: 0, total: 0, message: null };
      settings.iconsAvailable = true;
      emit();
    },
    reload: async () => {}, openEditor: async () => {}, openDir: async () => {},
    moveOverlay: async (where) => { window.__movedTo = where; },
    testSound: async () => { window.__testedSound = (window.__testedSound || 0) + 1; }
  };
})();
</script>
`;

// Real steps, read from a build file, so the preview shows the actual thing.
const OVERLAY_BUILD = (() => {
  const { parseBuild } = require(path.join(__dirname, '..', 'src', 'main', 'parse.js'));
  const file = process.env.PREVIEW_BUILD || '2-tvp.txt';
  const text = fs.readFileSync(path.join(__dirname, '..', 'builds', file), 'utf8');
  return parseBuild(text, file);
})();
/**
 * Step icons, with the main process's `file://` sources rewritten to this
 * server's `/icons/` route — a page served over HTTP cannot load `file://`
 * subresources, so the preview has to serve the images itself.
 */
const OVERLAY_STEPS = (() => {
  // Always attached, even when PREVIEW_ICONS is off: the renderer decides
  // whether to draw them from iconMode, and ?icons= flips that per frame.
  const stepIcons = require(path.join(__dirname, '..', 'src', 'main', 'icons.js'));
  const loaded = stepIcons.load(ICONS_DIR);
  if (loaded.error) console.warn('아이콘을 읽지 못했습니다:', loaded.error);
  return OVERLAY_BUILD.steps.map((step) => ({
    ...step,
    icons: stepIcons
      .iconsFor(step.action, 1)
      .map((icon) => ({ ...icon, src: '/icons/' + icon.src.split('/').pop() })),
  }));
})();

const OVERLAY_STUB = `<script>
(() => {
  // Preview-only backdrop, so overlay legibility can be judged against
  // something other than a blank page. Electron renders on a transparent window.
  const bg = document.createElement('style');
  // No padding here: the stylesheet's own gutter is what the window reserves
  // for the drop shadow, and overriding it would hide sizing bugs.
  bg.textContent = 'body{background:linear-gradient(140deg,#3c4a2a,#6b5636 45%,#243044);}';
  document.head.append(bg);

  const STEPS = ${JSON.stringify(OVERLAY_STEPS)};
  const settings = { iconMode: '${ICON_MODE}', iconsAvailable: true, opacity: 0.9, scale: 1, stepScale: 1, widthScale: 1, overlayWidth: 380, lookahead: 6, lookbehind: 1, leadSeconds: 0 };
  let t = 66, listener = null;
  function emit() {
    if (!listener) return;
    let nextIndex = STEPS.findIndex((s) => s.at >= t);
    if (nextIndex === -1) nextIndex = STEPS.length;
    listener({
      running: true, settings, clock: t, nextIndex,
      game: { connected: true, inGame: true, mock: true, isReplay: false, displayTime: t,
              me: { name: 'You', race: 'T' }, opponent: { name: 'Mock Opponent', race: 'Z' } },
      ui: { visible: true, locked: true, mode: 'auto', manualIndex: 0 },
      build: Object.assign(${JSON.stringify({
        source: OVERLAY_BUILD.source,
        name: OVERLAY_BUILD.name,
        race: OVERLAY_BUILD.race,
        vs: OVERLAY_BUILD.vs,
        notes: OVERLAY_BUILD.notes,
        slot: OVERLAY_BUILD.declaredSlot,
        problems: [],
      })}, { steps: STEPS })
    });
  }
  setInterval(() => { t += 0.35; emit(); }, 250);
  let cueHandler = null;
  window.overlay = {
    onView: (cb) => { listener = cb; emit(); },
    onFlash: () => {},
    onCue: (cb) => { cueHandler = cb; },
    // The bundled default, fetched over this server the way the main process
    // would hand it over in Electron.
    onCueSound: (cb) => {
      fetch('/cue.wav')
        .then((r) => r.arrayBuffer())
        .then((buf) => cb(new Uint8Array(buf)))
        .catch(() => cb(null));
    },
    reportCueSound: () => {},
    reportHeight: () => {},
  };
  // Preview hook: lets a test fire a cue the way the main process would.
  window.__fireCue = (volume) => cueHandler && cueHandler({ volume });
})();
</script>
`;

http
  .createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);

    // Images live outside the renderer root, so they get their own route.
    if (rel === '/cue.wav') {
      fs.readFile(path.join(__dirname, '..', 'assets', 'cue.wav'), (err, wav) => {
        if (err) res.writeHead(404).end('not found');
        else res.writeHead(200, { 'content-type': 'audio/wav' }).end(wav);
      });
      return;
    }

    if (rel.startsWith('/icons/')) {
      fs.readFile(path.join(ICONS_DIR, path.basename(rel)), (err, png) => {
        if (err) res.writeHead(404).end('not found');
        else res.writeHead(200, { 'content-type': 'image/png' }).end(png);
      });
      return;
    }
    const file = path.resolve(ROOT, `.${rel === '/' ? '/control.html' : rel}`);
    if (!file.startsWith(path.resolve(ROOT))) {
      res.writeHead(403).end('forbidden');
      return;
    }

    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      const type = TYPES[path.extname(file)] || 'application/octet-stream';

      // Inject each page's stub ahead of its own script, so the bridge that
      // Electron would have supplied via preload is already there.
      const stubs = {
        'editor.html': [EDITOR_STUB, 'editor.js'],
        'control.html': [CONTROL_STUB, 'control.js'],
        'index.html': [OVERLAY_STUB, 'overlay.js'],
      };
      const stub = stubs[path.basename(file)];
      let out = body;
      if (stub) {
        const tag = `<script src="${stub[1]}">`;
        out = Buffer.from(body.toString('utf8').replace(tag, `${stub[0]}${tag}`));
      }

      const query = req.url.split('?')[1] || '';

      // ?icons=none|small|large overrides PREVIEW_ICONS for one frame, so the
      // preview can be looked at with and without pictures without needing
      // the server restarted between looks.
      const icons = query.match(/icons=(none|small|large)/);
      if (icons && path.basename(file) === 'index.html') {
        out = Buffer.from(
          out.toString('utf8').replace(/iconMode: '[a-z]*'/, `iconMode: '${icons[1]}'`)
        );
      }

      res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
      res.end(out);
    });
  })
  .listen(PORT, () =>
    console.log(`preview on http://localhost:${PORT}/control.html  and  /editor.html`)
  );
