'use strict';

const TIME_RE = /^(\d{1,3}):([0-5]\d)(?=\s|$)/;
const HEADER_RE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/;
const SECTION_RE = /^\[(.+)\]$/;
const SUPPLY_RE = /(?:^|\s)@(\d{1,3})(?=\s|$)/;

const RACE_ALIASES = {
  t: 'T', terran: 'T', terr: 'T', 테란: 'T',
  z: 'Z', zerg: 'Z', 저그: 'Z',
  p: 'P', protoss: 'P', prot: 'P', 프로토스: 'P',
  r: 'R', random: 'R', any: '*', all: '*', '*': '*', 랜덤: 'R',
};

function normalizeRace(value) {
  if (!value) return null;
  return RACE_ALIASES[String(value).trim().toLowerCase()] || null;
}

/**
 * Parses one hand-written build order file.
 *
 * Header lines (`key: value`) may appear anywhere, but only before the first
 * step or section are they treated as metadata. Everything else is either a
 * `[Section]` marker, a `# comment`, or a step:
 *
 *   0:20  @16  Barracks  // note
 */
function parseBuild(text, source) {
  const meta = {};
  const steps = [];
  const problems = [];
  let section = null;
  let seenBody = false;

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      seenBody = true;
      return;
    }

    const timeMatch = TIME_RE.exec(line);
    if (timeMatch) {
      seenBody = true;
      const at = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
      let rest = line.slice(timeMatch[0].length).trim();

      let note = null;
      const noteAt = rest.indexOf('//');
      if (noteAt !== -1) {
        note = rest.slice(noteAt + 2).trim() || null;
        rest = rest.slice(0, noteAt).trim();
      }

      let supply = null;
      const supplyMatch = SUPPLY_RE.exec(rest);
      if (supplyMatch) {
        supply = Number(supplyMatch[1]);
        rest = (rest.slice(0, supplyMatch.index) + ' ' + rest.slice(supplyMatch.index + supplyMatch[0].length)).trim();
      }

      const action = rest.replace(/\s+/g, ' ').trim();
      if (!action) {
        problems.push({ line: lineNo, message: '시간만 있고 행동이 비어 있습니다.' });
        return;
      }
      steps.push({ at, supply, action, note, section, line: lineNo });
      return;
    }

    const headerMatch = HEADER_RE.exec(line);
    if (headerMatch && !seenBody) {
      meta[headerMatch[1].toLowerCase()] = headerMatch[2].trim();
      return;
    }

    problems.push({ line: lineNo, message: `해석할 수 없는 줄: ${line}` });
  });

  steps.sort((a, b) => a.at - b.at || a.line - b.line);

  let declaredSlot = null;
  if (meta.slot != null && meta.slot !== '') {
    const n = Number(meta.slot);
    if (Number.isInteger(n) && n >= 1 && n <= 9) {
      declaredSlot = n;
    } else {
      problems.push({ line: 0, message: `slot 은 1~9 사이 숫자여야 합니다 (받은 값: ${meta.slot})` });
    }
  }

  return {
    source,
    name: meta.name || source.replace(/\.[^.]+$/, ''),
    race: normalizeRace(meta.race),
    vs: normalizeRace(meta.vs) || '*',
    notes: meta.notes || null,
    declaredSlot,
    slot: null, // filled in by the library once every file is known
    meta,
    steps,
    problems,
  };
}

/** Formats game seconds as the in-game clock does. */
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Accepts `M:SS`, `MM:SS`, or bare seconds. Returns null if unusable. */
function parseTime(input) {
  const text = String(input == null ? '' : input).trim();
  if (!text) return null;
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d{1,5}$/.test(text)) return Number(text);
  return null;
}

/**
 * Renders a build back into the hand-written file format. The inverse of
 * parseBuild, so the editor can round-trip a file. Comments and blank-line
 * layout are not preserved — only headers, sections, and steps.
 */
function serializeBuild(build) {
  const lines = [];
  const header = (key, value) => {
    if (value != null && String(value).trim() !== '') lines.push(`${key}: ${String(value).trim()}`);
  };

  header('name', build.name);
  header('race', build.race);
  header('vs', build.vs);
  header('slot', build.slot);
  header('notes', build.notes);

  const steps = [...(build.steps || [])]
    .filter((s) => s && s.action && String(s.action).trim())
    .sort((a, b) => a.at - b.at);

  let section = null;
  let first = true;
  for (const step of steps) {
    const stepSection = step.section && String(step.section).trim() ? String(step.section).trim() : null;
    if (first || stepSection !== section) {
      lines.push('');
      if (stepSection) lines.push(`[${stepSection}]`);
      section = stepSection;
      first = false;
    }

    const at = formatTime(step.at).padEnd(5, ' ');
    const supply = (step.supply == null || step.supply === '' ? '' : `@${step.supply}`).padEnd(4, ' ');
    let line = `${at} ${supply} ${String(step.action).trim()}`;
    if (step.note && String(step.note).trim()) line += `  // ${String(step.note).trim()}`;
    lines.push(line.trimEnd());
  }

  return `${lines.join('\n')}\n`;
}

module.exports = { parseBuild, serializeBuild, formatTime, parseTime, normalizeRace };
