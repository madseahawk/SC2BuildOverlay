'use strict';

const { EventEmitter } = require('events');

const GAME_URL = 'http://localhost:6119/game';
const UI_URL = 'http://localhost:6119/ui';
const POLL_MS = 250;

const RACE_CODES = { Terr: 'T', Zerg: 'Z', Prot: 'P', random: 'R' };

async function getJSON(url, timeoutMs = 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a game is actually being played.
 *
 * An empty `activeScreens` list means no menu is up, i.e. we are looking at the
 * game itself. When /ui is unreachable, fall back to the clock moving.
 *
 * Shared by the poller and the idle watcher so the two can never disagree
 * about when a game has started.
 */
function isInGame(game, ui) {
  if (!game) return false;
  const onGameScreen = ui
    ? Array.isArray(ui.activeScreens) && ui.activeScreens.length === 0
    : game.displayTime > 0;
  return onGameScreen && (game.players || []).length > 0;
}

/**
 * Polls the retail SC2 client's local HTTP endpoints. Read-only: no memory
 * access, no injection, nothing written back to the game.
 *
 * Emits `state` with:
 *   { connected, inGame, displayTime, isReplay, me, opponent, players }
 */
class SC2Client extends EventEmitter {
  constructor({ myName = '' } = {}) {
    super();
    this.myName = myName;
    this.timer = null;
    this.state = this.blankState();
  }

  blankState() {
    return {
      connected: false,
      inGame: false,
      isReplay: false,
      displayTime: 0,
      me: null,
      opponent: null,
      players: [],
    };
  }

  setMyName(name) {
    this.myName = name || '';
  }

  start() {
    if (this.timer) return;
    const tick = async () => {
      await this.poll();
      this.timer = setTimeout(tick, POLL_MS);
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    // emitState only fires when something differs from `this.state`, so a
    // remembered state would swallow the first poll after a restart and leave
    // the app showing nothing. Forget it, and the next poll always reports.
    this.state = this.blankState();
  }

  async poll() {
    const [game, ui] = await Promise.all([getJSON(GAME_URL), getJSON(UI_URL)]);

    if (!game) {
      this.emitState(this.blankState());
      return;
    }

    const players = (game.players || []).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      race: RACE_CODES[p.race] || p.race || null,
      result: p.result,
    }));

    this.emitState({
      connected: true,
      inGame: isInGame(game, ui),
      isReplay: Boolean(game.isReplay),
      displayTime: game.displayTime || 0,
      players,
      ...this.identify(players),
    });
  }

  identify(players) {
    const humans = players.filter((p) => p.type === 'user');
    let me = null;
    if (this.myName) {
      const wanted = this.myName.trim().toLowerCase();
      me = players.find((p) => (p.name || '').toLowerCase() === wanted) || null;
    }
    if (!me && humans.length === 1) me = humans[0];
    const opponent = me ? players.find((p) => p.id !== me.id) || null : null;
    return { me, opponent };
  }

  emitState(next) {
    const changed = Object.keys(next).some((k) => {
      const a = next[k];
      const b = this.state[k];
      return typeof a === 'object' ? JSON.stringify(a) !== JSON.stringify(b) : a !== b;
    });
    this.state = next;
    if (changed) this.emit('state', next);
  }
}

/**
 * Stand-in for the game, so the overlay can be built and tuned with SC2 shut
 * down. The clock runs at real time: since Legacy of the Void the in-game clock
 * shows real seconds, and written build orders are timed against it.
 */
class MockClient extends EventEmitter {
  constructor() {
    super();
    this.displayTime = 0;
    this.running = true;
    this.timer = null;
  }

  setMyName() {}

  start() {
    if (this.timer) return;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      if (this.running) this.displayTime += (now - last) / 1000;
      last = now;
      this.emit('state', {
        connected: true,
        inGame: true,
        isReplay: false,
        mock: true,
        displayTime: this.displayTime,
        players: [
          { id: 1, name: 'You', type: 'user', race: 'T', result: 'Undecided' },
          { id: 2, name: 'Mock Opponent', type: 'user', race: 'Z', result: 'Undecided' },
        ],
        me: { id: 1, name: 'You', type: 'user', race: 'T' },
        opponent: { id: 2, name: 'Mock Opponent', type: 'user', race: 'Z' },
      });
    }, 250);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.displayTime = 0;
    this.running = true;
  }

  seek(seconds) {
    this.displayTime = Math.max(0, seconds);
  }

  togglePause() {
    this.running = !this.running;
  }
}

/**
 * A slow, single-purpose poll used only while the app is stopped, so
 * "start when a game starts" does not require reading the game continuously.
 * It answers one question and nothing else.
 */
class GameWatcher extends EventEmitter {
  constructor(intervalMs = 1000) {
    super();
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    const tick = async () => {
      this.timer = null;
      const [game, ui] = await Promise.all([getJSON(GAME_URL, 800), getJSON(UI_URL, 800)]);
      if (isInGame(game, ui)) {
        this.emit('started');
        return; // whoever listens takes over the polling
      }
      this.timer = setTimeout(tick, this.intervalMs);
    };
    this.timer = setTimeout(tick, this.intervalMs);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Stands in for the watcher with SC2 shut down, so dev mode can exercise it. */
class MockWatcher extends EventEmitter {
  constructor(delayMs = 3000) {
    super();
    this.delayMs = delayMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.emit('started');
    }, this.delayMs);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

const isMock = () => process.env.SC2_MOCK === '1';

function createClient(options) {
  return isMock() ? new MockClient() : new SC2Client(options);
}

function createWatcher() {
  return isMock() ? new MockWatcher() : new GameWatcher();
}

module.exports = { createClient, createWatcher, isInGame, SC2Client, MockClient, GameWatcher };
