/**
 * Converts a Vespene.gg build export into a build-order file.
 *
 *   node tools/import-build.js <export.json> [options]
 *
 *   --list                 show the branches and exit
 *   --branch=<id>          which branch to convert (default: the main line)
 *   --slot=<1-9>           hotkey slot to write into the header
 *   --out=<name.txt>       filename under builds/ (default: derived from name)
 *   --drop-filler          leave repeated production out entirely
 *   --no-situational       leave out steps pros only sometimes build
 *   --notes / --no-notes   keep or drop the site's English coaching notes
 *                          (default: drop — they are long English sentences)
 *   --min-freq=<0-1>       frequency floor for situational steps (default 0.25)
 *   --stdout               print the file instead of writing it
 *
 * Nothing is fetched: you export the build from the site yourself and point
 * this at the file.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { convert } = require(path.join(ROOT, 'src/main/import-vespene.js'));
const { serializeBuild, parseBuild } = require(path.join(ROOT, 'src/main/parse.js'));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const source = argv.find((a) => !a.startsWith('--'));
if (!source) {
  console.error('사용법: node tools/import-build.js <export.json> [--list] [--branch=id] [--slot=N]');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(source, 'utf8'));
} catch (err) {
  console.error(`JSON 을 읽을 수 없습니다: ${err.message}`);
  process.exit(1);
}

// Both directions are spelled out so the choice is never a hidden default.
const keepNotes = flag('notes') && !flag('no-notes');

const result = convert(data, {
  branchId: value('branch'),
  filler: flag('drop-filler') ? 'drop' : 'collapse',
  situational: !flag('no-situational'),
  notes: keepNotes,
  minFrequency: Number(value('min-freq', '0.25')),
});

if (!result.ok) {
  console.error(result.message);
  process.exit(1);
}

if (flag('list')) {
  console.log(`${data.name || '(이름 없음)'}  —  분기 ${result.branches.length}개\n`);
  for (const b of result.branches) {
    const wr = b.winRate != null ? `승률 ${String(Math.round(b.winRate * 100)).padStart(3)}%` : '승률 —   ';
    const games = b.games != null ? `${String(b.games).padStart(4)}판` : '   —판';
    console.log(`  ${b.id === result.selected ? '▶' : ' '} ${b.id.padEnd(10)} ${games}  ${wr}  ${String(b.steps).padStart(4)}단계  ${b.label}`);
  }
  console.log('\n--branch=<id> 로 고를 수 있습니다.');
  process.exit(0);
}

const slot = value('slot');
if (slot) result.build.slot = Number(slot);

const text = serializeBuild(result.build);

// The converter must not produce something the app cannot read back.
const reparsed = parseBuild(text, 'check.txt');
if (reparsed.problems.length) {
  console.error('변환 결과가 다시 읽히지 않습니다:');
  reparsed.problems.forEach((p) => console.error(`  ${p.line}행: ${p.message}`));
  process.exit(1);
}

if (flag('stdout')) {
  process.stdout.write(text);
} else {
  const base = value('out') || `${(result.build.name || 'imported').split('—')[0].trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').toLowerCase()}.txt`;
  const filename = /\.(txt|build|md)$/i.test(base) ? base : `${base}.txt`;
  const target = path.join(ROOT, 'builds', filename);
  fs.writeFileSync(target, text, 'utf8');
  console.log(`저장: builds/${filename}  (${reparsed.steps.length}단계)`);
}

console.error('');
console.error(
  `분기: ${result.selected}  ·  단계 ${reparsed.steps.length}개  ·  ` +
    `메모 ${keepNotes ? '포함 (--no-notes 로 제외)' : '제외 (--notes 로 포함)'}`
);
result.notes.forEach((n) => console.error(`  ⚠ ${n}`));
if (result.missing.length) {
  console.error('');
  console.error('  사전에 추가하려면 src/main/translate.js 의 TERMS 에 넣으세요:');
  result.missing.forEach((k) => console.error(`    ${k}: '',`));
}
