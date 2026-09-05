'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const { createClient, createWatcher } = require('./sc2client');
const { Library } = require('./library');
const { createConfig } = require('./config');
const { setupEditor } = require('./editor');
const { setupControl } = require('./control');
const { safeSend } = require('./send');
const stepIcons = require('./icons');
const { downloadIcons } = require('./icon-download');

// Width at 100%; the panel is laid out in rem off one root font-size, so the
// content width scales linearly with the 크기 setting.
const BASE_WIDTH = 380;
const WIN_HEIGHT = 560;
const MIN_HEIGHT = 80;

/**
 * Where build files live.
 *
 * In a packaged app the bundle is a read-only asar, so `builds/` has to live in
 * userData instead — the editor writes there and the library watches it, and
 * neither works inside an archive. `seed/` is copied across on first run so a
 * fresh install opens with a sample to look at.
 *
 * `seed/` is deliberately separate from the dev `builds/` folder: what ships
 * should be a chosen sample, not whatever happens to be lying around while
 * working on the app.
 */
const BUNDLED_BUILDS = path.join(app.getAppPath(), 'seed');
const BUILDS_DIR = app.isPackaged ? path.join(app.getPath('userData'), 'builds') : BUNDLED_BUILDS;

// Assets ship unpacked (extraResources), so this is always a real file on disk
// rather than a path inside the archive.
const RESOURCES_DIR = app.isPackaged ? process.resourcesPath : app.getAppPath();
const ICON_PATH = path.join(RESOURCES_DIR, 'assets', 'icon.ico');
/* The cue that plays when nothing has been picked. Shipped as a file rather
   than synthesized so the default is the sound someone actually chose; the
   oscillator in sound.js stays as the fallback for when this cannot be read. */
const DEFAULT_CUE = path.join(RESOURCES_DIR, 'assets', 'cue.wav');
/**
 * Step icons.
 *
 * The pictures are Blizzard Entertainment's, extracted from the game's files,
 * so they are not shipped: the installer would otherwise be distributing that
 * artwork. What ships is `manifest.json`, the Korean-term to filename mapping,
 * which is this project's own work. The images are fetched on request into
 * userData — see `src/main/icon-download.js`.
 *
 * In development they stay where `tools/fetch-icons.js` puts them, so working
 * on the app needs no download step.
 */
const ICON_MANIFEST = path.join(RESOURCES_DIR, 'assets', 'icons', 'manifest.json');
const STEP_ICONS_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'icons')
  : path.join(RESOURCES_DIR, 'assets', 'icons');

/**
 * The user's own cue sound, kept as a copy rather than a path to wherever they
 * found it. A cue picked out of Downloads and later tidied away would otherwise
 * take the sound with it, and the overlay would go quiet mid-game with nothing
 * on screen to say why.
 */
const SOUNDS_DIR = path.join(app.getPath('userData'), 'sounds');

// What Chromium can decode. The list is what the file dialog offers; whether a
// given file really plays is only settled by decoding it in the overlay.
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm'];

// A cue is a fraction of a second. Anything this big is a mistaken pick — a
// whole track, or the wrong file — and is refused rather than read into memory.
const MAX_SOUND_BYTES = 5 * 1024 * 1024;

/**
 * Puts the bundled manifest where the images will be downloaded, so
 * `icons.load` keeps reading a single directory. Copied on every launch rather
 * than once: an app update can carry new terms, and the manifest is ours to
 * overwrite — unlike the builds folder, which is the user's.
 */
function seedIconManifest() {
  if (!app.isPackaged) return;
  try {
    fs.mkdirSync(STEP_ICONS_DIR, { recursive: true });
    fs.copyFileSync(ICON_MANIFEST, path.join(STEP_ICONS_DIR, 'manifest.json'));
  } catch (err) {
    console.warn('아이콘 목록을 준비하지 못했습니다:', err.message);
  }
}

/** Copies the bundled builds into userData the first time, never over the top. */
function seedBuilds() {
  if (!app.isPackaged) return;
  try {
    fs.mkdirSync(BUILDS_DIR, { recursive: true });
    if (fs.readdirSync(BUILDS_DIR).length > 0) return;
    for (const name of fs.readdirSync(BUNDLED_BUILDS)) {
      fs.copyFileSync(path.join(BUNDLED_BUILDS, name), path.join(BUILDS_DIR, name));
    }
  } catch (err) {
    console.warn('could not seed builds:', err.message);
  }
}

let overlay = null;
let tray = null;
let client = null;
let library = null;
let config = null;
let editor = null;
let control = null;
let watcher = null;

/**
 * `running` is the master switch. While false nothing polls the game and
 * nothing is drawn over it — the app just sits in the control window. This is
 * the state `npm start` opens in, unless the user turned on autoStart.
 */
let running = false;

const ui = {
  visible: true, // overlay shown while running; 표시/숨김 toggles this
  locked: true, // click-through; unlock only to drag the panel
  mode: 'auto', // 'auto' follows the game clock, 'manual' is hotkey-driven
  manualIndex: 0,
  buildSource: null,
};

const BLANK_GAME = {
  connected: false,
  inGame: false,
  isReplay: false,
  displayTime: 0,
  me: null,
  opponent: null,
  players: [],
};

let gameState = { ...BLANK_GAME };

/**
 * Baseline for the step-change cue. `source` is tracked alongside the index so
 * that switching builds (or starting a run) re-establishes the baseline instead
 * of firing a cue for a jump that is not real progress.
 */
let lastCue = { source: null, nextIndex: 0 };

/**
 * What the overlay made of the chosen cue sound, since only it can decode one.
 * Null while nothing has been reported — the built-in cue needs no verdict.
 */
let cueSoundProblem = null;

/**
 * Icon download progress, so the control window can show it. Null when idle.
 * Nothing is fetched unless asked for: the app reads the network only when the
 * user presses the button, the same way it only reads SC2 while running.
 */
let iconFetch = null;

// ------------------------------------------------------------------ overlay

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - BASE_WIDTH - 24,
    y: workArea.y + 96,
    width: BASE_WIDTH,
    height: WIN_HEIGHT,
  };
}

function createOverlay() {
  const saved = config.get('bounds');
  overlay = new BrowserWindow({
    ...(saved || defaultBounds()),
    show: false, // stays hidden until 시작
    frame: false,
    transparent: true,
    // Resized programmatically to fit the rendered panel. The user cannot drag
    // an edge anyway: the window is frameless and click-through.
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // never steal focus from the game
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The overlay sits over a fullscreen game and can be treated as occluded;
      // without this its timers and audio would be throttled.
      backgroundThrottling: false,
      // It is click-through, so it never receives a user gesture — without this
      // the AudioContext would stay suspended and the cue would be silent.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  overlay.on('moved', () => config.set('bounds', overlay.getBounds()));
  overlay.webContents.on('did-finish-load', () => {
    push();
    // The overlay decodes it once and keeps it; a reload starts that over.
    pushCueSound();
    // Created hidden so it never flashes un-styled; it appears once it has
    // something to draw — parked at 0:00 until 시작.
    if (ui.visible) showOverlay();
  });
}

// ------------------------------------------------------------------ state

/** Where we are in the build: everything before `nextIndex` is already done. */
function resolveProgress(build) {
  if (!build || build.steps.length === 0) return { nextIndex: 0, clock: 0 };

  if (ui.mode === 'manual') {
    const idx = Math.max(0, Math.min(ui.manualIndex, build.steps.length));
    const last = build.steps[build.steps.length - 1].at;
    return { nextIndex: idx, clock: idx < build.steps.length ? build.steps[idx].at : last };
  }

  const clock = gameState.displayTime + Number(config.get('leadSeconds') || 0);
  // `>=`, not `>`: a step whose time has just arrived is the thing to do now,
  // not one already done. With `>` a step written at 0:00 would be struck out
  // before the game even started.
  let nextIndex = build.steps.findIndex((s) => s.at >= clock);
  if (nextIndex === -1) nextIndex = build.steps.length;
  return { nextIndex, clock };
}

function favorites() {
  const list = config.get('favorites');
  return Array.isArray(list) ? list : [];
}

const isFavorite = (source) => favorites().includes(source);

function activeBuild() {
  if (!library) return null;
  if (ui.buildSource) {
    const pinned = library.find(ui.buildSource);
    if (pinned) return pinned;
  }
  // Auto-pick only has an answer once there is a game to read a matchup from.
  if (config.get('autoPick') && gameState.inGame) {
    // No fallback here: putting up a build for the wrong matchup is worse than
    // putting up none, because it looks right and would be followed. The same
    // goes for not knowing which player is us — the matchup is then a guess.
    if (!gameState.me) return null;
    const oppRace = gameState.opponent && gameState.opponent.race;
    return library.bestFor(gameState.me.race, oppRace, isFavorite) || null;
  }
  return library.builds[0] || null;
}

/**
 * Why auto-pick came up empty, so the renderers can say something actionable
 * instead of leaving a blank panel.
 */
function matchless() {
  if (!config.get('autoPick') || !gameState.inGame || activeBuild()) return null;
  if (!gameState.me) return { unknownPlayer: true };
  return { race: gameState.me.race, vs: (gameState.opponent && gameState.opponent.race) || null };
}

/**
 * Steps with their icon list attached, worked out once per loaded build. The
 * keys are the build objects themselves, so a reload from disk builds new
 * objects and the old entries go with them.
 */
const iconedSteps = new WeakMap();

function stepsFor(build) {
  if (config.get('iconMode') === 'none' || !stepIcons.loaded()) return build.steps;
  let steps = iconedSteps.get(build);
  if (!steps) {
    // One icon per step. Measured across the build files: 95% of steps name
    // exactly one thing, so a fixed one-icon column keeps every row's text
    // starting at the same place. On the rest the text carries the remainder.
    steps = build.steps.map((step) => ({ ...step, icons: stepIcons.iconsFor(step.action, 1) }));
    iconedSteps.set(build, steps);
  }
  return steps;
}

function settingsSnapshot() {
  return {
    iconMode: config.get('iconMode'),
    // So the control window can say the pictures are missing rather than
    // leaving the option looking broken.
    iconsAvailable: stepIcons.loaded(),
    iconFetch,
    opacity: config.get('opacity'),
    scale: config.get('scale'),
    stepScale: config.get('stepScale'),
    widthScale: config.get('widthScale'),
    // What the two width inputs actually add up to, so the control window can
    // report the result rather than only the multiplier that produced it.
    overlayWidth: overlayWidth(),
    lookahead: config.get('lookahead'),
    lookbehind: config.get('lookbehind'),
    leadSeconds: config.get('leadSeconds'),
    autoPick: config.get('autoPick'),
    autoStart: config.get('autoStart'),
    autoStartOnGame: config.get('autoStartOnGame'),
    myName: config.get('myName'),
    soundEnabled: config.get('soundEnabled'),
    soundVolume: config.get('soundVolume'),
    // The name it was picked under; null is the built-in cue.
    soundFile: (config.get('soundFile') || {}).name || null,
    soundProblem: cueSoundProblem,
  };
}

/**
 * Fires the audible cue when the step you are on actually advances. Auto mode
 * only: a manual step is user-initiated, so it needs no confirmation beep.
 */
function maybeCue(source, nextIndex, settings) {
  const advanced =
    running &&
    gameState.inGame &&
    ui.mode === 'auto' &&
    source !== null &&
    source === lastCue.source &&
    nextIndex > lastCue.nextIndex;

  lastCue = { source, nextIndex };
  if (advanced && settings.soundEnabled) playCue(settings.soundVolume);
}

/**
 * Fetches the step icons on request. Progress is pushed as it goes, because
 * 196 files over a slow link is long enough that a frozen button would read as
 * a hang.
 */
async function fetchIcons() {
  if (iconFetch && iconFetch.running) return;
  iconFetch = { running: true, done: 0, total: 0, message: null };
  push();

  const result = await downloadIcons({
    manifestPath: path.join(STEP_ICONS_DIR, 'manifest.json'),
    dir: STEP_ICONS_DIR,
    onProgress: ({ done, total }) => {
      // Pushed at a readable rate rather than 196 times: every frame would
      // spend more effort redrawing the control window than downloading.
      if (done === total || done % 8 === 0) {
        iconFetch = { running: true, done, total, message: null };
        push();
      }
    },
  });

  stepIcons.load(STEP_ICONS_DIR);
  // The icons attach to steps once per build and are cached against the build
  // object, so entries made before the download would keep their empty lists.
  library.load();

  iconFetch = { running: false, done: 0, total: 0, message: result.message };
  push();
}

/** Audio lives in the overlay window, the one renderer that always exists. */
function playCue(volume) {
  safeSend(overlay, 'cue', { volume: Number(volume) || 0 });
}

/**
 * Hands the overlay the bytes of the chosen cue, or null to fall back to the
 * built-in one. Sent on load and on every change, never per cue: decoding is
 * the expensive part and the overlay caches the result.
 */
function pushCueSound() {
  const chosen = config.get('soundFile');
  if (!chosen || !chosen.file) {
    cueSoundProblem = null;
    // The bundled default goes down the same channel as a picked file, so
    // there is one playback path to get right instead of two. A null here
    // would hand playback to the oscillator, which is the last resort.
    try {
      safeSend(overlay, 'cue-sound', fs.readFileSync(DEFAULT_CUE));
    } catch (err) {
      console.warn('기본 효과음을 읽지 못했습니다:', err.message);
      safeSend(overlay, 'cue-sound', null);
    }
    return;
  }
  try {
    safeSend(overlay, 'cue-sound', fs.readFileSync(path.join(SOUNDS_DIR, chosen.file)));
  } catch {
    // The copy is gone — the folder was cleared by hand, or never written.
    cueSoundProblem = '효과음 파일을 찾을 수 없습니다. 다시 불러오세요.';
    safeSend(overlay, 'cue-sound', null);
  }
}

/**
 * Takes a copy of the picked file and makes it the cue. Rejected reasons are
 * returned rather than thrown: picking a wrong file is an ordinary mistake, and
 * the control window says so without the app treating it as a fault.
 */
function setSoundFile(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase().replace('.', '');
  if (!AUDIO_EXTENSIONS.includes(ext)) {
    // The dialog filters by extension, but a name can still be typed into it.
    cueSoundProblem = ext
      ? `.${ext} 는 재생할 수 없는 형식입니다.`
      : '오디오 파일이 아닙니다.';
    push();
    return;
  }
  try {
    const { size } = fs.statSync(sourcePath);
    if (size > MAX_SOUND_BYTES) {
      cueSoundProblem = `파일이 너무 큽니다 (${Math.round(size / 1024 / 1024)}MB). 5MB 이하로 골라주세요.`;
      push();
      return;
    }

    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    // One cue at a time. Previous copies go, or the folder collects every file
    // ever auditioned and the one in use stops being obvious.
    for (const name of fs.readdirSync(SOUNDS_DIR)) {
      if (name.startsWith('cue.')) fs.rmSync(path.join(SOUNDS_DIR, name), { force: true });
    }
    const file = `cue.${ext}`;
    fs.copyFileSync(sourcePath, path.join(SOUNDS_DIR, file));

    config.set('soundFile', { name: path.basename(sourcePath), file });
    cueSoundProblem = null;
    pushCueSound();
    push();
  } catch (err) {
    cueSoundProblem = `파일을 읽지 못했습니다: ${err.message}`;
    push();
  }
}

/** Back to the built-in cue. The copy is left alone — replacing it is enough. */
function clearSoundFile() {
  config.set('soundFile', null);
  cueSoundProblem = null;
  pushCueSound();
  push();
}

/** One state push per change, to both the overlay and the control window. */
function push() {
  const build = activeBuild();
  const { nextIndex, clock } = resolveProgress(build);
  const settings = settingsSnapshot();

  const noMatch = matchless();

  safeSend(overlay, 'view', {
    running,
    watching: isWatching(),
    game: gameState,
    ui: { ...ui },
    settings,
    clock,
    nextIndex,
    noMatch,
    build: build && {
      source: build.source,
      name: build.name,
      race: build.race,
      vs: build.vs,
      notes: build.notes,
      slot: build.slot,
      steps: stepsFor(build),
      problems: build.problems,
    },
  });

  if (control) {
    control.push({
      running,
      watching: isWatching(),
      game: gameState,
      ui: { ...ui },
      settings,
      clock,
      nextIndex,
      totalSteps: build ? build.steps.length : 0,
      noMatch,
      activeSource: build ? build.source : null,
      pinnedSource: ui.buildSource,
      favorites: favorites(),
      nextStep: build && nextIndex < build.steps.length ? build.steps[nextIndex] : null,
      builds: library.builds.map((b) => ({
        source: b.source,
        name: b.name,
        race: b.race,
        vs: b.vs,
        slot: b.slot,
        steps: b.steps.length,
        problems: b.problems.length,
      })),
    });
  }

  maybeCue(build ? build.source : null, nextIndex, settings);
}

/** A short on-screen note, since the overlay is click-through mid-game. */
function flash(text) {
  safeSend(overlay, 'flash', text);
}

// ------------------------------------------------------------------ start/stop

/**
 * Rewinds to the top of the build. Both start and stop do this, so a run always
 * begins at 0:00 rather than resuming wherever the last one left off — the
 * selected build is kept, only the position in it is cleared.
 */
function resetProgress() {
  ui.mode = 'auto';
  ui.manualIndex = 0;
  lastCue = { source: null, nextIndex: 0 };
}

/**
 * Showing the overlay and running the clock are separate axes. The overlay can
 * sit on screen parked at 0:00 while stopped, so you can line up a build before
 * the game and press 시작 when it actually begins.
 */
/**
 * While stopped, optionally wait for a game to begin and start then. Pressing
 * 시작 by hand at the right moment is the app's biggest bit of friction: too
 * early and nothing happens, too late and the opening is already marked done.
 *
 * This is a separate, slower poll so that "정지 상태에서는 SC2 를 읽지 않습니다"
 * stays true in spirit — it asks one question a second and nothing else.
 */
function syncWatcher() {
  if (!watcher) return;
  if (!running && config.get('autoStartOnGame')) watcher.start();
  else watcher.stop();
}

const isWatching = () => Boolean(!running && config.get('autoStartOnGame'));

function start() {
  if (running) return;
  running = true;
  resetProgress();
  client.start();
  syncWatcher();
  refreshTrayMenu();
  push();
}

function stop() {
  if (!running) return;
  running = false;
  client.stop();
  gameState = { ...BLANK_GAME };
  resetProgress();
  syncWatcher();
  refreshTrayMenu();
  push();
}

/**
 * Corner presets, because dragging requires unlocking first and is easy to
 * miss. Uses the display the overlay currently sits on, not always the primary.
 */
const EDGE_MARGIN = 24;

function moveOverlay(where) {
  if (!overlay || overlay.isDestroyed()) return;
  const bounds = overlay.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);

  const left = workArea.x + EDGE_MARGIN;
  const right = workArea.x + workArea.width - bounds.width - EDGE_MARGIN;
  const top = workArea.y + EDGE_MARGIN;
  const bottom = workArea.y + workArea.height - bounds.height - EDGE_MARGIN;
  const spots = {
    'top-left': { x: left, y: top },
    'top-right': { x: right, y: top },
    'bottom-left': { x: left, y: bottom },
    'bottom-right': { x: right, y: bottom },
  };

  const spot = spots[where];
  if (!spot) return;
  overlay.setBounds({ ...bounds, x: Math.round(spot.x), y: Math.round(spot.y) });
  config.set('bounds', overlay.getBounds());
  push();
}

let lastContentHeight = WIN_HEIGHT;

/**
 * The icon column plus its gap, in px at 100%. Matches `--icon-size` in
 * overlay.css. Added to the window rather than taken out of the action column,
 * so switching icons on does not start truncating step text.
 */
const ICON_GAP = 0.4 * 15; // .step's column gap
const ICON_LEAD = 0.3 * 15; // the extra space before the action text
const ICON_COLUMN = {
  none: 0,
  small: 1.15 * 15 + ICON_GAP + ICON_LEAD,
  large: 2.5 * 15 + ICON_GAP + ICON_LEAD,
};

function overlayWidth() {
  const scale = Number(config.get('scale')) || 1;
  // Room for the text, independent of how big the text is. Widening lets a long
  // step read in full instead of being cut to an ellipsis; narrowing gives the
  // game back the screen. Applied on top of 크기 so the two compose.
  const width = Number(config.get('widthScale')) || 1;
  const extra = ICON_COLUMN[config.get('iconMode')] || 0;
  return Math.round((BASE_WIDTH + extra) * scale * width);
}

/**
 * Sizes the window to the panel the renderer just drew. Width comes from the
 * 크기 setting; height is whatever the content turned out to be, so changing
 * scale or the number of visible steps moves the window's edges too instead of
 * clipping the text or leaving dead space.
 *
 * The docked corner is kept: an overlay parked bottom-right grows leftward and
 * upward rather than sliding off the screen.
 */
function fitOverlay(contentHeight) {
  if (!overlay || overlay.isDestroyed()) return;
  lastContentHeight = contentHeight;

  const bounds = overlay.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);

  const width = Math.min(overlayWidth(), workArea.width);
  const height = Math.max(
    MIN_HEIGHT,
    Math.min(Math.round(contentHeight), workArea.height)
  );
  if (width === bounds.width && height === bounds.height) return;

  const gapLeft = bounds.x - workArea.x;
  const gapRight = workArea.x + workArea.width - (bounds.x + bounds.width);
  const gapTop = bounds.y - workArea.y;
  const gapBottom = workArea.y + workArea.height - (bounds.y + bounds.height);

  let x = gapRight < gapLeft ? bounds.x + bounds.width - width : bounds.x;
  let y = gapBottom < gapTop ? bounds.y + bounds.height - height : bounds.y;

  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));

  overlay.setBounds({ x, y, width, height });
  config.set('bounds', overlay.getBounds());
}

function showOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.showInactive();
  // 'screen-saver' is the highest level Electron exposes, and it is what gets
  // the overlay above a game running in borderless/windowed fullscreen.
  overlay.setAlwaysOnTop(true, 'screen-saver');
}

function setVisible(visible) {
  ui.visible = visible;
  if (visible) showOverlay();
  else if (overlay && !overlay.isDestroyed()) overlay.hide();
  push();
}

function setLocked(locked) {
  ui.locked = locked;
  if (overlay && !overlay.isDestroyed()) {
    overlay.setIgnoreMouseEvents(locked, { forward: true });
    overlay.setFocusable(!locked);
    if (!locked && ui.visible) overlay.focus();
  }
  push();
}

// ------------------------------------------------------------------ build/mode

/**
 * Switching build stops the run and rewinds to 0:00. Carrying the old clock
 * into a different build would drop you into its middle, which is never what
 * picking a new build means — you press 시작 again when you are ready.
 *
 * How long the choice sticks depends on the 자동 선택 setting:
 *
 * - auto on  — this is a one-game override. It is dropped when the game ends
 *   and never persisted, so auto-pick is in charge again next game.
 * - auto off — this is the only way builds get chosen, so it persists.
 *
 * Previously the pick was always permanent and always checked before auto-pick,
 * which meant one hotkey press silently disabled matchup selection forever.
 */
function selectBuild(build) {
  ui.buildSource = build.source;
  if (!config.get('autoPick')) config.set('lastBuild', build.source);
  stop();
  resetProgress();
  push();
}

/** Releases a one-game override, handing control back to auto-pick. */
function clearPin() {
  ui.buildSource = null;
  config.set('lastBuild', null);
  stop();
  resetProgress();
  push();
}

function toggleFavorite(source) {
  const list = favorites();
  config.set('favorites', list.includes(source) ? list.filter((s) => s !== source) : [...list, source]);
  push();
}

function selectSlot(slot) {
  const build = library.bySlot(slot);
  if (!build) {
    flash(`${slot} · 빈 슬롯`);
    return;
  }
  selectBuild(build);
  flash(`${slot} · ${build.name}`);
}

function setMode(mode) {
  const build = activeBuild();
  if (mode === 'manual') {
    ui.manualIndex = build ? resolveProgress(build).nextIndex : 0;
    ui.mode = 'manual';
  } else {
    ui.mode = 'auto';
  }
  push();
}

function stepBy(delta) {
  const build = activeBuild();
  if (!build) return;
  if (ui.mode === 'auto') {
    // Nudging while in auto mode switches to manual from where you actually are.
    ui.mode = 'manual';
    ui.manualIndex = resolveProgress(build).nextIndex;
  }
  ui.manualIndex = Math.max(0, Math.min(ui.manualIndex + delta, build.steps.length));
  push();
}

// ------------------------------------------------------------------ shortcuts

function registerShortcuts() {
  const bind = (accel, fn) => {
    if (!globalShortcut.register(accel, fn)) console.warn(`hotkey unavailable: ${accel}`);
  };

  bind('Control+Alt+S', () => (running ? stop() : start()));
  bind('Control+Alt+O', () => setVisible(!ui.visible));
  bind('Control+Alt+L', () => setLocked(!ui.locked));
  bind('Control+Alt+Right', () => stepBy(1));
  bind('Control+Alt+Left', () => stepBy(-1));
  bind('Control+Alt+M', () => setMode(ui.mode === 'auto' ? 'manual' : 'auto'));
  bind('Control+Alt+R', () => library.load());
  bind('Control+Alt+C', () => control.open());
  bind('Control+Alt+E', () => editor.open());
  bind('Control+Alt+Q', () => app.quit());

  for (let slot = 1; slot <= 9; slot += 1) {
    bind(`Control+Alt+${slot}`, () => selectSlot(slot));
  }

  if (process.env.SC2_MOCK === '1') {
    bind('Control+Alt+P', () => client.togglePause());
    bind('Control+Alt+0', () => client.seek(0));
  }
}

// ------------------------------------------------------------------ tray

function buildTray() {
  // The .ico is a single 256px image, which Windows would squash badly in the
  // 16px notification area — resize it here rather than let the shell do it.
  let icon = nativeImage.createFromPath(ICON_PATH);
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16, quality: 'best' });

  tray = new Tray(icon);
  tray.on('click', () => control.open());
  refreshTrayMenu();
}

/** Rebuilt whenever the running state or the library changes. */
function refreshTrayMenu() {
  if (!tray) return;

  const slots = library.builds
    .filter((b) => b.slot)
    .sort((a, b) => a.slot - b.slot)
    .map((b) => ({
      label: `${b.slot}.  ${b.name}`,
      accelerator: `Control+Alt+${b.slot}`,
      registerAccelerator: false, // the global shortcut already owns this key
      click: () => selectSlot(b.slot),
    }));

  tray.setToolTip(`SC2 Build Overlay — ${running ? '실행 중' : '정지됨'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: running ? '■ 정지  (Ctrl+Alt+S)' : '▶ 시작  (Ctrl+Alt+S)', click: () => (running ? stop() : start()) },
      { type: 'separator' },
      { label: '제어창 열기…  (Ctrl+Alt+C)', click: () => control.open() },
      { label: '빌드오더 편집기…  (Ctrl+Alt+E)', click: () => editor.open() },
      { type: 'separator' },
      { label: '오버레이 표시/숨김  (Ctrl+Alt+O)', click: () => setVisible(!ui.visible) },
      { label: '잠금 해제 / 잠금  (Ctrl+Alt+L)', click: () => setLocked(!ui.locked) },
      ...(slots.length ? [{ type: 'separator' }, { label: '빌드 슬롯', submenu: slots }] : []),
      { type: 'separator' },
      { label: '빌드 폴더 열기', click: () => shell.openPath(BUILDS_DIR) },
      { label: '빌드 다시 읽기  (Ctrl+Alt+R)', click: () => library.load() },
      { type: 'separator' },
      { label: '종료  (Ctrl+Alt+Q)', click: () => app.quit() },
    ])
  );
}

// ------------------------------------------------------------------ boot

function boot() {
  if (process.platform === 'win32') app.setAppUserModelId('com.sc2buildoverlay.app');

  config = createConfig(path.join(app.getPath('userData'), 'config.json'));
  // Only restore a pinned build in manual mode. Restoring it under auto-pick
  // is what made matchup selection appear broken after the first ever pick.
  ui.buildSource = config.get('autoPick') ? null : config.get('lastBuild');

  seedBuilds();
  seedIconManifest();

  const iconSet = stepIcons.load(STEP_ICONS_DIR);
  if (iconSet.error) console.warn('단계 아이콘을 읽지 못했습니다:', iconSet.error);

  library = new Library(BUILDS_DIR);
  library.on('loaded', () => {
    refreshTrayMenu();
    push();
  });
  library.load();
  library.watch();

  editor = setupEditor({
    buildsDir: BUILDS_DIR,
    iconPath: ICON_PATH,
    library,
    getGameState: () => gameState,
  });

  control = setupControl({
    buildsDir: BUILDS_DIR,
    iconPath: ICON_PATH,
    actions: {
      start,
      stop,
      quit: () => app.quit(),
      push,
      setVisible,
      setLocked,
      setMode,
      pickBuild: (source) => {
        const build = library.find(source);
        if (build) selectBuild(build);
      },
      updateSettings: (patch) => {
        config.merge(patch);
        if ('myName' in patch) client.setMyName(patch.myName);
        // These change the window width, which no height report would carry:
        // the renderer only reports when its own height moves, and neither of
        // them does that. 단계 글자 is the exception — it retells its height.
        if ('scale' in patch || 'widthScale' in patch) fitOverlay(lastContentHeight);
        if ('autoStartOnGame' in patch) syncWatcher();
        push();
      },
      reload: () => library.load(),
      openEditor: () => editor.open(),
      clearPin,
      toggleFavorite,
      moveOverlay,
      testSound: () => playCue(config.get('soundVolume')),
      setSoundFile,
      clearSoundFile,
      fetchIcons,
    },
  });

  watcher = createWatcher();
  watcher.on('started', () => {
    if (!running) start();
  });

  client = createClient({ myName: config.get('myName') });
  client.on('state', (state) => {
    const leftGame = gameState.inGame && !state.inGame;
    gameState = state;
    if (leftGame) {
      // Leaving a game drops manual mode so the next game starts on the clock,
      // and releases a one-game build override.
      if (ui.mode === 'manual') ui.mode = 'auto';
      if (config.get('autoPick')) ui.buildSource = null;
    }
    push();
    editor.pushClock();
  });

  createOverlay();
  buildTray();
  registerShortcuts();
  control.open();

  if (config.get('autoStart')) start();
  syncWatcher();
  if (process.env.SC2_EDITOR === '1') editor.open();
}

/**
 * Only one copy may run. A second instance cannot register the global hotkeys
 * — the first one holds them — so it would sit there looking alive while every
 * shortcut silently did nothing. Easy to hit with the portable build, so hand
 * the user back to the running copy instead.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (control) control.open();
  });
  app.whenReady().then(boot);
}

ipcMain.on('overlay-height', (_e, height) => fitOverlay(height));

// The overlay's verdict on the chosen sound, once it has tried to decode it.
ipcMain.on('cue-sound-status', (_e, status) => {
  const next = status && status.ok ? null : (status && status.message) || null;
  if (next === cueSoundProblem) return;
  cueSoundProblem = next;
  push();
});

// Stop polling before the renderers are torn down. Electron logs its own
// "Render frame was disposed" diagnostic from inside the IPC layer, which
// safeSend's try/catch cannot reach, so the fix is to not send at all by then.
app.on('before-quit', () => {
  if (client) client.stop();
  if (watcher) watcher.stop();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (client) client.stop();
  if (watcher) watcher.stop();
  if (library) library.close();
});

// Closing the control window leaves the app in the tray, so a running overlay
// is not torn down by tidying windows away. Quitting is always explicit.
app.on('window-all-closed', () => {});
