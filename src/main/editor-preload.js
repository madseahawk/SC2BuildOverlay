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
  openDir: () => ipcRenderer.invoke('editor:open-dir'),
});
