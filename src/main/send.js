'use strict';

/**
 * Sends to a renderer, tolerating a window that is on its way out.
 *
 * The pollers fire every 250ms, so a send can land in the window between a
 * render frame being disposed and `isDestroyed()` turning true — which throws
 * "Render frame was disposed before WebFrameMain could be accessed". There is
 * no check that closes that race, so the throw is absorbed instead: a dropped
 * frame of clock data is worth nothing, and the next tick will catch up.
 */
function safeSend(win, channel, payload) {
  if (!win || win.isDestroyed()) return false;
  const contents = win.webContents;
  if (!contents || contents.isDestroyed()) return false;
  try {
    contents.send(channel, payload);
    return true;
  } catch {
    return false;
  }
}

module.exports = { safeSend };
