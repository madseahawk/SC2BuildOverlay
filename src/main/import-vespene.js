'use strict';

/**
 * Converts a Vespene.gg build export (JSON) into this app's build-order format.
 *
 * The export is far more detailed than an overlay can use, so the conversion is
 * mostly about deciding what to throw away:
 *
 * - `prov.plan` steps are filler production the site generates to pad the
 *   timeline (one entry per Marine, ~100 of them). Runs of them collapse into a
 *   single "계속 생산" line instead of burying the real decisions.
 * - `prov.imp: 'situational'` steps are things pros only sometimes do; they are
 *   kept but marked, or dropped entirely at the caller's choice.
 * - `track.morphs` become their own steps, so a Command Center that becomes an
 *   Orbital Command at 1:45 shows up at 1:45.
 * - `prov.ph` (opening/early/mid) maps onto our `[구간]` markers.
 */

const { translateKey, parseMatchup, raceCode } = require('./translate');

const PHASES = { opening: '오프닝', early: '초반', mid: '중반', late: '후반' };

const DEFAULTS = {
  // Filler production: 'collapse' into one line, or 'drop' outright.
  filler: 'collapse',
  // Keep steps pros only sometimes build? They are marked with the frequency.
  situational: true,
  // Below this frequency a situational step is not worth a line.
  minFrequency: 0.25,
  // The site's coaching notes are long English sentences that cannot be read
  // mid-game, so they stay out unless asked for.
  notes: false,
};

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Picks a branch out of the export's `tree`, defaulting to the main line. */
function branches(data) {
  const out = [];
  const tree = data && data.tree;
  if (tree) {
    for (const race of Object.keys(tree)) {
      for (const branch of (tree[race].list || [])) {
        out.push({
          // The tree is keyed by the *player's* race, and an export carries
          // every race the site had open — see `ownRace`.
          race,
          id: branch.id,
          label: branch.label || branch.id,
          steps: branch.steps || [],
          games: branch.prov && branch.prov.games,
          // As with `supply`, a 0 here means "no figure", not "loses every
          // game": the scouting-reaction branches carry `wr: 0` next to
          // hundreds of games. Shown as 0% it would look like the worst
          // branch when it is the best-sampled one.
          winRate: branch.prov && branch.prov.wr > 0 ? branch.prov.wr : null,
        });
      }
    }
  }
  // Older or flattened exports carry only a top-level `steps`.
  if (out.length === 0 && Array.isArray(data && data.steps)) {
    out.push({ id: 'main', label: data.name || 'main', steps: data.steps });
  }
  return out;
}

/**
 * Which race's tree is the build actually being exported.
 *
 * An export is not one build: `tree` is keyed by the player's race and the site
 * hands over every race it had loaded that session, so a PvZ export can carry a
 * leftover Zerg tree from the build viewed before it — plus one-step stubs for
 * races merely visited. Those come first in key order, so taking the first
 * branch imported a 1-step Terran stub as a Protoss build.
 *
 * `race` (and `source.matchup`) say which one is meant.
 */
function ownRace(data) {
  const tree = (data && data.tree) || {};
  const keys = Object.keys(tree);
  if (keys.length <= 1) return keys[0] || null;

  const matchup = parseMatchup(data.source && data.source.matchup);
  const want = raceCode(data.race) || (matchup && matchup.race);
  const named = keys.find((key) => raceCode(key) === want);
  if (named) return named;

  // Nothing states the race: the real build is the substantial tree, since the
  // leftovers are stubs.
  let best = { key: keys[0], size: -1 };
  for (const key of keys) {
    const size = (tree[key].list || []).reduce((n, b) => n + (b.steps || []).length, 0);
    if (size > best.size) best = { key, size };
  }
  return best.key;
}

/** Notes arrive as one string with ' · ' between separate remarks. */
function cleanNote(note) {
  return String(note || '')
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ');
}

/**
 * The export tags only some steps with a phase, and morphs carry none at all.
 * Assigning per step therefore leaves gaps that split a section into several
 * runs. Derive each phase's start time instead and label every step by which
 * window it falls in, so sections come out contiguous.
 */
function phaseWindows(steps) {
  const starts = new Map();
  for (const step of steps) {
    const ph = step.prov && step.prov.ph;
    if (!ph || !PHASES[ph]) continue;
    const at = Number(step.t) || 0;
    if (!starts.has(ph) || at < starts.get(ph)) starts.set(ph, at);
  }
  return [...starts]
    .map(([ph, at]) => ({ label: PHASES[ph], at }))
    .sort((a, b) => a.at - b.at);
}

function phaseAt(windows, at) {
  let label = null;
  for (const w of windows) {
    if (at >= w.at) label = w.label;
    else break;
  }
  return label;
}

function convert(data, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const missing = new Set();
  const notes = [];

  const all = branches(data);
  const mine = ownRace(data);
  // Restrict before looking up `branchId`: ids repeat across races (every tree
  // has a `main`), so an unfiltered lookup could return another race's build.
  const own = mine ? all.filter((b) => b.race === mine) : [];
  const usable = own.length ? own : all;

  const branch = opts.branchId
    ? usable.find((b) => b.id === opts.branchId) || usable[0]
    : usable[0];
  if (!branch) return { ok: false, message: '변환할 단계가 없습니다.' };

  const ignored = all.filter((b) => !usable.includes(b));
  if (ignored.length) {
    const counts = new Map();
    for (const b of ignored) counts.set(b.race, (counts.get(b.race) || 0) + 1);
    const summary = [...counts].map(([race, n]) => `${race} ${n}개`).join(', ');
    notes.push(
      `이 익스포트에 다른 종족 트리도 들어있어 제외했습니다 (${summary}). ` +
        '사이트에서 이전에 보던 빌드가 함께 내보내집니다.'
    );
  }

  // Add-ons name themselves after the building they attach to.
  const byId = new Map(branch.steps.map((s) => [s.id, s]));
  const windows = phaseWindows(branch.steps);

  const raw = [];
  for (const step of branch.steps) {
    const parent = step.addonOf ? byId.get(step.addonOf) : null;
    const { text, missing: gaps } = translateKey(step.key, parent && parent.key);
    gaps.forEach((g) => missing.add(g));

    const frequency = step.prov && typeof step.prov.f === 'number' ? step.prov.f : 1;
    const importance = (step.prov && step.prov.imp) || null;
    const filler = Boolean(step.prov && step.prov.plan);

    raw.push({
      at: step.t,
      // The export writes 0 where it has no supply figure, not "zero supply".
      supply: step.supply > 0 ? step.supply : null,
      action: text,
      key: step.key,
      note: opts.notes && step.note ? cleanNote(step.note) : null,
      section: phaseAt(windows, step.t),
      filler,
      importance,
      frequency,
    });

    // A morph is a second thing happening later to the same structure.
    const morphs = (step.track && step.track.morphs) || [];
    for (const morph of morphs) {
      if (morph.key === step.key) continue; // the original, not a change
      const m = translateKey(morph.key);
      m.missing.forEach((g) => missing.add(g));
      raw.push({
        at: morph.t,
        supply: null,
        action: m.text,
        key: morph.key,
        note: null,
        section: phaseAt(windows, morph.t),
        filler: false,
        importance,
        frequency,
      });
    }
  }

  raw.sort((a, b) => a.at - b.at);

  // ---- drop what an overlay cannot use -----------------------------------
  const kept = [];
  const fillerSeen = new Map();
  let droppedSituational = 0;
  let collapsedFiller = 0;

  for (const step of raw) {
    if (step.filler) {
      if (opts.filler === 'drop') {
        collapsedFiller += 1;
        continue;
      }
      // One standing line per unit. Consecutive-only collapsing would repeat
      // it, because sorting by time interleaves filler with real steps.
      const already = fillerSeen.get(step.key);
      if (already) {
        collapsedFiller += 1;
        if (step.note && !already.note) already.note = step.note;
        continue;
      }
      const line = { ...step, action: `${step.action} 계속 생산` };
      fillerSeen.set(step.key, line);
      kept.push(line);
      continue;
    }

    if (step.importance === 'situational') {
      if (!opts.situational || step.frequency < opts.minFrequency) {
        droppedSituational += 1;
        continue;
      }
      const pct = Math.round(step.frequency * 100);
      step.note = step.note ? `${step.note} / 상황부 ${pct}%` : `상황부 ${pct}%`;
    }

    kept.push(step);
  }

  // ---- header ------------------------------------------------------------
  const matchup = parseMatchup(data.source && data.source.matchup);
  const race = matchup ? matchup.race : raceCode(data.race);
  const vs = matchup ? matchup.vs : '*';

  const name = [data.name || branch.label, all.length > 1 ? branch.label : null]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(' — ');

  const meta = [];
  if (data.source && data.source.games) {
    const wr = data.source.wr != null ? ` 승률 ${Math.round(data.source.wr * 100)}%` : '';
    meta.push(`출처 표본 ${data.source.games}판${wr}`);
  }
  if (branch.games) {
    const wr = branch.winRate != null ? ` 승률 ${Math.round(branch.winRate * 100)}%` : '';
    meta.push(`이 분기 ${branch.games}판${wr}`);
  }
  if (data.mapName) meta.push(`맵 ${data.mapName}`);

  if (collapsedFiller) notes.push(`반복 생산 ${collapsedFiller}줄을 "계속 생산" 으로 합쳤습니다.`);
  if (droppedSituational) notes.push(`빈도가 낮은 상황부 단계 ${droppedSituational}개를 제외했습니다.`);
  if (missing.size) notes.push(`번역 못 한 용어 ${missing.size}개: ${[...missing].join(', ')}`);

  return {
    ok: true,
    build: {
      name,
      race,
      vs,
      slot: null,
      notes: meta.join(' · ') || null,
      steps: kept.map((s) => ({
        at: s.at,
        supply: s.supply,
        action: s.action,
        note: s.note,
        section: s.section,
      })),
    },
    branches: usable.map((b) => ({
      race: b.race || null,
      id: b.id,
      label: b.label,
      games: b.games,
      winRate: b.winRate,
      steps: b.steps.length,
    })),
    selected: branch.id,
    missing: [...missing],
    notes,
  };
}

module.exports = { convert, branches, formatTime, PHASES, DEFAULTS };
