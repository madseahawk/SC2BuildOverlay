'use strict';

const path = require('path');
const { BrowserWindow, dialog, ipcMain, shell } = require('electron');

const { safeSend } = require('./send');

/**
 * The control window: the app's main window and what `npm start` opens. It is
 * where you start and stop the overlay, pick a build, and change settings.
 * Nothing polls and nothing is drawn over the game until you press 시작.
 */
function setupControl({ buildsDir, iconPath, actions }) {
  let win = null;

  function open() {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return;
    }

    win = new BrowserWindow({
      width: 480,
      height: 760,
      minWidth: 420,
      minHeight: 560,
      title: 'SC2 Build Overlay',
      icon: iconPath,
      backgroundColor: '#0d1017',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'control-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.loadFile(path.join(__dirname, '..', 'renderer', 'control.html'));
    win.webContents.on('did-finish-load', () => actions.push());

    // Closing this window leaves the app in the tray so a running overlay
    // survives; 종료 (button, tray, or Ctrl+Alt+Q) is what actually quits.
    win.on('closed', () => {
      win = null;
    });
  }

  function push(view) {
    safeSend(win, 'control', view);
  }

  ipcMain.handle('control:start', () => actions.start());
  ipcMain.handle('control:stop', () => actions.stop());
  ipcMain.handle('control:quit', () => actions.quit());
  ipcMain.handle('control:pick-build', (_e, source) => actions.pickBuild(source));
  ipcMain.handle('control:settings', (_e, patch) => actions.updateSettings(patch));
  ipcMain.handle('control:set-visible', (_e, visible) => actions.setVisible(visible));
  ipcMain.handle('control:set-locked', (_e, locked) => actions.setLocked(locked));
  ipcMain.handle('control:set-mode', (_e, mode) => actions.setMode(mode));
  ipcMain.handle('control:reload', () => actions.reload());
  ipcMain.handle('control:clear-pin', () => actions.clearPin());
  ipcMain.handle('control:toggle-favorite', (_e, source) => actions.toggleFavorite(source));
  ipcMain.handle('control:move-overlay', (_e, where) => actions.moveOverlay(where));
  ipcMain.handle('control:test-sound', () => actions.testSound());

  /**
   * Picking the cue sound. The dialog is raised here, where the parent window
   * is, and the file itself is handed to the main module to copy and adopt.
   */
  ipcMain.handle('control:pick-sound', async () => {
    const options = {
      title: '효과음 파일 고르기',
      filters: [
        { name: '오디오', extensions: ['wav', 'mp3', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm'] },
      ],
      properties: ['openFile'],
    };
    const { canceled, filePaths } = await (win && !win.isDestroyed()
      ? dialog.showOpenDialog(win, options)
      : dialog.showOpenDialog(options));

    if (canceled || !filePaths || !filePaths[0]) return;
    actions.setSoundFile(filePaths[0]);
  });

  ipcMain.handle('control:reset-sound', () => actions.clearSoundFile());
  ipcMain.handle('control:fetch-icons', () => actions.fetchIcons());
  ipcMain.handle('control:open-editor', () => actions.openEditor());
  ipcMain.handle('control:open-dir', () => shell.openPath(buildsDir));

  return { open, push, isOpen: () => Boolean(win && !win.isDestroyed()) };
}

module.exports = { setupControl };
