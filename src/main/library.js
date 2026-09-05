'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { parseBuild } = require('./parse');

const EXTENSIONS = new Set(['.txt', '.build', '.md']);

/**
 * The builds folder, watched for changes so edits show up in the overlay
 * without a restart.
 */
class Library extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.builds = [];
    this.watcher = null;
    this.debounce = null;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const files = fs
      .readdirSync(this.dir)
      .filter((f) => EXTENSIONS.has(path.extname(f).toLowerCase()))
      .sort();

    this.builds = files.map((file) => {
      const full = path.join(this.dir, file);
      try {
        return parseBuild(fs.readFileSync(full, 'utf8'), file);
      } catch (err) {
        return {
          source: file,
          name: file,
          steps: [],
          declaredSlot: null,
          slot: null,
          problems: [{ line: 0, message: err.message }],
        };
      }
    });

    // Slots are assigned against filename order so auto-fill stays predictable,
    // then the list is ordered by slot: that is the order the hotkeys use, so
    // showing anything else makes Ctrl+Alt+3 land on the wrong-looking row.
    this.assignSlots();
    this.builds.sort((a, b) => (a.slot || 99) - (b.slot || 99) || a.source.localeCompare(b.source));

    this.emit('loaded', this.builds);
    return this.builds;
  }

  /**
   * Maps builds onto the Ctrl+Alt+1..9 hotkeys. A `slot:` header always wins so
   * that adding a file never renumbers the builds you already know by muscle
   * memory; whatever is left over fills the free slots in filename order.
   */
  assignSlots() {
    const taken = new Map();

    for (const b of this.builds) {
      b.slot = null;
      if (!b.declaredSlot) continue;
      const holder = taken.get(b.declaredSlot);
      if (holder) {
        b.problems.push({
          line: 0,
          message: `slot ${b.declaredSlot} 은 ${holder.source} 가 이미 쓰고 있어 자동 배정으로 넘깁니다.`,
        });
        continue;
      }
      taken.set(b.declaredSlot, b);
      b.slot = b.declaredSlot;
    }

    let next = 1;
    for (const b of this.builds) {
      if (b.slot) continue;
      while (next <= 9 && taken.has(next)) next += 1;
      if (next > 9) break;
      taken.set(next, b);
      b.slot = next;
    }
  }

  bySlot(slot) {
    return this.builds.find((b) => b.slot === slot) || null;
  }

  watch() {
    if (this.watcher) return;
    this.watcher = fs.watch(this.dir, () => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.load(), 150);
    });
  }

  close() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
  }

  find(source) {
    return this.builds.find((b) => b.source === source) || null;
  }

  /**
   * Picks the build that best fits the current matchup: an exact
   * my-race/vs-race match beats a wildcard, which beats nothing.
   */
  /**
   * Picks the build that best fits the matchup. An exact `vs` match always
   * beats a wildcard; within the same tier a favourite beats file order, which
   * is otherwise arbitrary.
   */
  bestFor(myRace, oppRace, isFavorite = () => false) {
    if (!myRace) return null;
    const score = (b) => {
      if (!b.race || b.race !== myRace) return -1;
      const tier = b.vs === oppRace ? 2 : b.vs === '*' ? 1 : -1;
      if (tier < 0) return -1;
      return tier * 10 + (isFavorite(b.source) ? 1 : 0);
    };
    let best = null;
    let bestScore = 0;
    for (const b of this.builds) {
      const s = score(b);
      if (s > bestScore) {
        best = b;
        bestScore = s;
      }
    }
    return best;
  }
}

module.exports = { Library };
