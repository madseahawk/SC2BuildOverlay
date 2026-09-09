'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editor', {
  onClock: (cb) => ipcRenderer.on('clock', (_e, clock) => cb(clock)),
  list: () => ipcRenderer.invoke('editor:list'),
  read: (source) => ipcRenderer.invoke('editor:read', source),
  preview: (build) => ipcRenderer.invoke('editor:preview', build),
  save: (payload) => ipcRenderer.invoke('editor:save', payload),
  remove: (source) => ipcRenderer.invoke('editor:delete', source),
  importText: (raw) => ipcRenderer.invoke('editor:import', raw),
  openExport: () => ipcRenderer.invoke('editor:open-export'),
  convertExport: (payload) => ipcRenderer.invoke('editor:convert-export', payload),
  terms: () => ipcRenderer.invoke('editor:terms'),
  replayState: (refresh) => ipcRenderer.invoke('editor:replay-state', refresh),
  replaySetup: () => ipcRenderer.invoke('editor:replay-setup'),
  openPythonSite: () => ipcRenderer.invoke('editor:open-python-site'),
  onReplayProgress: (cb) => ipcRenderer.on('replay-progress', (_e, line) => cb(line)),
  openReplay: () => ipcRenderer.invoke('editor:open-replay'),
  convertReplay: (payload) => ipcRenderer.invoke('editor:convert-replay', payload),
  openDir: () => ipcRenderer.invoke('editor:open-dir'),
});
