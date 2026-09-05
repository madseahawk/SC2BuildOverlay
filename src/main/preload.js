'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The overlay is display-only: it receives state and changes nothing.
// Everything you can change lives in the control window. What it does send
// back is only ever an answer about itself, which no other window can give.
contextBridge.exposeInMainWorld('overlay', {
  onView: (cb) => ipcRenderer.on('view', (_e, view) => cb(view)),
  onFlash: (cb) => ipcRenderer.on('flash', (_e, text) => cb(text)),
  onCue: (cb) => ipcRenderer.on('cue', (_e, cue) => cb(cue)),
  // The bytes of the user's chosen cue, or null for the built-in one. Pushed on
  // load and whenever the choice changes, so playing never waits on a read.
  onCueSound: (cb) => ipcRenderer.on('cue-sound', (_e, bytes) => cb(bytes)),
  // How tall it turned out, so the window can be fitted to it.
  reportHeight: (height) => ipcRenderer.send('overlay-height', height),
  // Whether those bytes actually decoded. Only the renderer has an audio
  // decoder, so this is the only place the answer exists.
  reportCueSound: (status) => ipcRenderer.send('cue-sound-status', status),
});
