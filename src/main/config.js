'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // The app opens stopped; flip this to have it start polling on launch.
  autoStart: false,
  // Watch for a game starting while stopped, and start the run when one does.
  autoStartOnGame: false,
  myName: '',
  opacity: 0.9,
  scale: 1,
  bounds: null,
  lastBuild: null,
  // Off by default: slot hotkeys are the primary way builds get chosen.
  autoPick: false,
  // Filenames preferred when several builds fit the same matchup.
  favorites: [],
  // 'none' | 'small' | 'large' — unit/building pictures beside the step text.
  // Off by default: someone who knows the game reads the text faster.
  iconMode: 'none',
  // Header and footer are reference, not the build: once you know the hotkeys
  // and the matchup, the panel can be the steps and nothing else.
  showHeader: true,
  showFooter: true,
  // A second size axis for the step list alone, on top of `scale`: the build
  // order is what gets read mid-game, so it can be made bigger without the
  // header, the footer and the window growing to match.
  stepScale: 1,
  // Window width as a multiple of the computed one. Text stays whatever
  // `scale` and `stepScale` say; only the room for it changes.
  widthScale: 1,
  lookahead: 6,
  lookbehind: 1,
  leadSeconds: 0,
  soundEnabled: true,
  soundVolume: 0.5,
  // null means the built-in synthesized cue. Otherwise { name, file }: the
  // name the user picked the file under, and the copy kept in userData/sounds.
  soundFile: null,
};

function createConfig(file) {
  let data = { ...DEFAULTS };
  try {
    Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    /* first run, or unreadable — defaults are fine */
  }

  let pending = null;

  /* Writing from inside the timer, unguarded, put an EPERM or EBUSY on a path
     nothing could catch — a throw from a timer callback takes the process with
     it. A settings file that fails to save is worth a warning, not a crash. */
  const write = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn('설정을 저장하지 못했습니다:', err.message);
    }
  };

  const save = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      write();
    }, 300);
  };

  return {
    get all() {
      return data;
    },
    get(key) {
      return data[key];
    },
    set(key, value) {
      data[key] = value;
      save();
    },
    merge(patch) {
      Object.assign(data, patch);
      save();
    },
    /* Writes whatever the debounce is still holding. Changing a setting and
       quitting inside 300ms otherwise lost it — most likely of all with the
       last thing you touched before closing the app. */
    flush() {
      if (!pending) return;
      clearTimeout(pending);
      pending = null;
      write();
    },
  };
}

module.exports = { createConfig, DEFAULTS };
