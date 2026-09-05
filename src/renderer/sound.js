'use strict';

/**
 * The step-change cue.
 *
 * Whatever the main process sends through `load` is what plays — the bundled
 * default cue, or a file the user picked in its place. Both arrive as bytes on
 * the same channel, so there is one playback path rather than two.
 *
 * The synthesized tone below is the fallback for when neither can be decoded:
 * a missing asset should leave the overlay quieter, not silent.
 *
 * Exposed on `window.cueSound` for overlay.js.
 */
(() => {
  // A raw sine at gain 1.0 is punishingly loud, so the 0..1 volume setting maps
  // onto this ceiling instead of straight onto the gain node.
  const PEAK = 0.35;

  let ctx = null;
  /** The user's own cue, once decoded. Null means the synthesized one. */
  let sample = null;

  function context() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    return ctx;
  }

  /**
   * Renders one cue into `target` (a live AudioContext, or an
   * OfflineAudioContext when tests want to inspect the samples).
   */
  function render(target, volume, startAt = target.currentTime) {
    const peak = Math.max(0, Math.min(1, volume)) * PEAK;
    if (peak === 0) return;

    const osc = target.createOscillator();
    const gain = target.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, startAt);
    osc.frequency.exponentialRampToValueAtTime(1320, startAt + 0.06);

    // Fast attack, exponential tail: reads as a tick, not a tone.
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);

    osc.connect(gain);
    gain.connect(target.destination);
    osc.start(startAt);
    osc.stop(startAt + 0.2);
  }

  /**
   * Takes the bytes of the user's chosen sound and decodes them once, so that
   * playing costs no more than the built-in cue does. Anything falsy clears the
   * choice and hands playback back to `render`.
   *
   * Decoding is where an unplayable file is actually found out — the extension
   * only ever suggested it would work — so the outcome is returned for the
   * control window to report rather than swallowed into a silent cue.
   */
  async function load(bytes) {
    sample = null;
    if (!bytes || !bytes.byteLength) return { ok: true };

    const target = context();
    if (!target) return { ok: false, message: '오디오 장치를 열지 못했습니다.' };
    try {
      // decodeAudioData detaches what it is given, so it gets a copy: the
      // incoming view belongs to the IPC message, not to us.
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      sample = await target.decodeAudioData(copy);
      return { ok: true };
    } catch {
      sample = null;
      return { ok: false, message: '이 형식은 재생할 수 없습니다. WAV 나 MP3 를 써보세요.' };
    }
  }

  function play(volume) {
    const target = context();
    if (!target) return false;
    // The overlay is click-through and never receives a gesture, so the context
    // can start suspended; the window sets autoplayPolicy so this resume works.
    if (target.state === 'suspended') target.resume();

    const level = Math.max(0, Math.min(1, volume));
    if (sample) {
      if (level === 0) return true;
      const source = target.createBufferSource();
      const gain = target.createGain();
      source.buffer = sample;
      // No PEAK ceiling here. That exists to tame a raw sine, which starts far
      // louder than anything mastered; a file the user chose is already at the
      // level they expect, so the setting maps straight onto it.
      gain.gain.value = level;
      source.connect(gain);
      gain.connect(target.destination);
      source.start();
      return true;
    }

    render(target, volume);
    return true;
  }

  window.cueSound = { play, render, load, PEAK };
})();
