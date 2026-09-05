'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('control', {
  onView: (cb) => ipcRenderer.on('control', (_e, view) => cb(view)),
  start: () => ipcRenderer.invoke('control:start'),
  stop: () => ipcRenderer.invoke('control:stop'),
  quit: () => ipcRenderer.invoke('control:quit'),
  pickBuild: (source) => ipcRenderer.invoke('control:pick-build', source),
  updateSettings: (patch) => ipcRenderer.invoke('control:settings', patch),
  setVisible: (visible) => ipcRenderer.invoke('control:set-visible', visible),
  setLocked: (locked) => ipcRenderer.invoke('control:set-locked', locked),
  setMode: (mode) => ipcRenderer.invoke('control:set-mode', mode),
  reload: () => ipcRenderer.invoke('control:reload'),
  clearPin: () => ipcRenderer.invoke('control:clear-pin'),
  toggleFavorite: (source) => ipcRenderer.invoke('control:toggle-favorite', source),
  moveOverlay: (where) => ipcRenderer.invoke('control:move-overlay', where),
  testSound: () => ipcRenderer.invoke('control:test-sound'),
  pickSound: () => ipcRenderer.invoke('control:pick-sound'),
  resetSound: () => ipcRenderer.invoke('control:reset-sound'),
  fetchIcons: () => ipcRenderer.invoke('control:fetch-icons'),
  openEditor: () => ipcRenderer.invoke('control:open-editor'),
  openDir: () => ipcRenderer.invoke('control:open-dir'),
});
