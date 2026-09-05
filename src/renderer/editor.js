'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  buildList: $('build-list'),
  newBuild: $('new-build'),
  openDir: $('open-dir'),

  name: $('f-name'),
  race: $('f-race'),
  vs: $('f-vs'),
  slot: $('f-slot'),
  notes: $('f-notes'),
  filename: $('f-filename'),

  rows: $('rows'),
  stepsEmpty: $('steps-empty'),
  orderWarning: $('order-warning'),
  addStep: $('add-step'),
  addAtClock: $('add-at-clock'),
  sortSteps: $('sort-steps'),
  clockChip: $('clock-chip'),

  preview: $('preview'),
  previewMeta: $('preview-meta'),
  problems: $('problems'),

  importPanel: $('import-panel'),
  importText: $('import-text'),
  doImport: $('do-import'),

  openExport: $('open-export'),
  exportSource: $('export-source'),
  branchBox: $('branch-box'),
  branchList: $('branch-list'),
  impNotes: $('imp-notes'),
  impSituational: $('imp-situational'),
  impFiller: $('imp-filler'),
  importReport: $('import-report'),

  status: $('status'),
  save: $('save-build'),
  remove: $('delete-build'),
};

const state = {
  /** Filename currently loaded from disk; null for an unsaved new build. */
  replacing: null,
  steps: [],
  dirty: false,
  clock: { connected: false, inGame: false, displayTime: 0, mock: false },
  /** Last build list from the main process, for labelling the slot dropdown. */
  builds: [],
  /** Branch currently chosen from an opened export, so options can re-convert. */
  branch: null,
};

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Mirrors parseTime in the main process: `M:SS` or bare seconds. */
function parseTime(input) {
  const text = String(input == null ? '' : input).trim();
  if (!text) return null;
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d{1,5}$/.test(text)) return Number(text);
  return null;
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`;
}

function markDirty() {
  state.dirty = true;
  refreshPreview();
}

// ---------------------------------------------------------------- step rows

/**
 * Rows own their step object and write straight into it, so typing never
 * triggers a re-render (which would steal focus mid-word). The table is only
 * rebuilt when the list changes shape: add, delete, sort, import, load.
 *
 * `step.section` has no column: it is carried through untouched so that saving
 * a hand-written file keeps its [구간] markers. New steps inherit the section of
 * the step above, and the preview is where the markers are visible.
 */
function makeRow(step) {
  const row = document.createElement('div');
  row.className = 'trow';

  const time = document.createElement('input');
  time.className = 't-time';
  time.type = 'text';
  time.placeholder = '0:00';
  time.value = step.at == null ? '' : formatTime(step.at);
  time.addEventListener('input', () => {
    const parsed = parseTime(time.value);
    time.classList.toggle('bad', time.value.trim() !== '' && parsed === null);
    step.at = parsed == null ? null : parsed;
    markDirty();
  });
  time.addEventListener('blur', () => {
    if (step.at != null) time.value = formatTime(step.at);
    refreshOrderWarning();
  });

  const supply = document.createElement('input');
  supply.className = 't-supply';
  supply.type = 'text';
  supply.placeholder = '—';
  supply.value = step.supply == null ? '' : step.supply;
  supply.addEventListener('input', () => {
    const text = supply.value.trim();
    const n = Number(text);
    const bad = text !== '' && (!Number.isInteger(n) || n < 1 || n > 200);
    supply.classList.toggle('bad', bad);
    step.supply = text === '' || bad ? null : n;
    markDirty();
  });

  const action = document.createElement('input');
  action.className = 't-action';
  action.type = 'text';
  action.placeholder = '예: 병영';
  action.value = step.action || '';
  action.addEventListener('input', () => {
    step.action = action.value;
    markDirty();
  });
  // Enter at the end of a row adds the next one — the common authoring rhythm.
  action.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addStep({ at: (step.at || 0) + 15, section: step.section });
    }
  });

  const note = document.createElement('input');
  note.type = 'text';
  note.placeholder = '선택';
  note.value = step.note || '';
  note.addEventListener('input', () => {
    step.note = note.value.trim() || null;
    markDirty();
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'row-del';
  del.title = '이 단계 삭제';
  del.textContent = '✕';
  del.addEventListener('click', () => {
    state.steps = state.steps.filter((s) => s !== step);
    renderRows();
    markDirty();
  });

  row.append(time, supply, action, note, del);
  return row;
}

function renderRows() {
  el.rows.replaceChildren(...state.steps.map(makeRow));
  el.stepsEmpty.classList.toggle('gone', state.steps.length > 0);
  refreshOrderWarning();
}

/**
 * A section that reappears after another one has intervened will be written out
 * twice, because the file is always sorted by time. Usually that means a step's
 * time was moved past a section boundary without updating its section.
 */
function splitSections(sortedSteps) {
  const runs = [];
  let previous;
  for (const step of sortedSteps) {
    const section = step.section || null;
    if (runs.length === 0 || section !== previous) runs.push(section);
    previous = section;
  }
  const counts = new Map();
  runs.forEach((s) => counts.set(s, (counts.get(s) || 0) + 1));
  return [...counts].filter(([section, n]) => section && n > 1).map(([section]) => section);
}

function refreshOrderWarning() {
  const timed = state.steps.filter((s) => s.at != null);
  const outOfOrder = timed.some((s, i) => i > 0 && s.at < timed[i - 1].at);
  const untimed = state.steps.filter((s) => s.at == null && String(s.action || '').trim()).length;
  const split = splitSections([...timed].sort((a, b) => a.at - b.at));

  const notes = [];
  if (outOfOrder) notes.push('시간 순서가 뒤섞여 있습니다. 저장할 때 자동으로 시간순 정렬됩니다.');
  if (untimed) notes.push(`시간이 비어 있는 단계 ${untimed}개는 저장되지 않습니다.`);
  if (split.length) {
    notes.push(
      `구간 ${split.map((s) => `[${s}]`).join(', ')} 이 시간순으로 보면 두 군데로 나뉩니다. ` +
        '아래 미리보기에서 확인하세요 (구간은 텍스트 에디터에서 고칠 수 있습니다).'
    );
  }
  el.orderWarning.textContent = notes.join('\n');
}

function addStep(seed = {}) {
  const last = state.steps[state.steps.length - 1];
  const step = {
    at: seed.at != null ? seed.at : last && last.at != null ? last.at + 15 : 0,
    supply: seed.supply != null ? seed.supply : null,
    action: seed.action || '',
    note: seed.note || null,
    section: seed.section !== undefined ? seed.section : (last && last.section) || null,
  };
  state.steps.push(step);
  renderRows();
  markDirty();

  // Focus the new row's action field so typing continues uninterrupted.
  const fresh = el.rows.lastElementChild;
  if (fresh) fresh.querySelector('.t-action').focus();
}

// ---------------------------------------------------------------- form <-> data

function currentBuild() {
  return {
    name: el.name.value.trim(),
    race: el.race.value || null,
    vs: el.vs.value || '*',
    slot: el.slot.value ? Number(el.slot.value) : null,
    notes: el.notes.value.trim() || null,
    steps: state.steps
      .filter((s) => s.at != null && String(s.action || '').trim())
      .map((s) => ({
        at: s.at,
        supply: s.supply,
        action: String(s.action).trim(),
        note: s.note,
        section: s.section,
      })),
  };
}

function fillForm(build) {
  el.name.value = build.name || '';
  el.race.value = build.race || '';
  el.vs.value = build.vs || '*';
  el.slot.value = build.slot ? String(build.slot) : '';
  el.notes.value = build.notes || '';
  state.steps = (build.steps || []).map((s) => ({
    at: s.at,
    supply: s.supply,
    action: s.action,
    note: s.note,
    section: s.section,
  }));
  renderRows();
}

/** Turns a build name into a usable filename, keeping Hangul intact. */
function suggestFilename() {
  const build = currentBuild();
  const base = (build.name || 'build')
    .toLowerCase()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = build.slot ? `${build.slot}-` : '';
  return `${prefix}${base || 'build'}.txt`;
}

let previewTimer = null;
let previewSeq = 0;
function refreshPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const build = currentBuild();
    // Previews are async, so a slower earlier request must not overwrite a
    // newer one — only the latest request is allowed to paint.
    const seq = (previewSeq += 1);
    const { text, problems, steps } = await window.editor.preview(build);
    if (seq !== previewSeq) return;

    el.preview.textContent = text;
    el.previewMeta.textContent = `${steps}단계 · ${new TextEncoder().encode(text).length} bytes`;
    el.problems.textContent = problems.length
      ? problems.map((p) => `${p.line}행: ${p.message}`).join('\n')
      : '';
    el.problems.classList.toggle('bad', problems.length > 0);
    el.filename.placeholder = suggestFilename();
    if (state.dirty) setStatus(state.replacing ? `${state.replacing} · 저장 안 됨` : '새 빌드 · 저장 안 됨');
  }, 120);
}

// ---------------------------------------------------------------- library

/**
 * Labels each slot with whoever holds it, so taking a used number is a visible
 * choice rather than a silent collision. Picking a used one swaps: the other
 * build inherits this build's old slot.
 *
 * The build being edited labels its own selected slot too, so the dropdown
 * reads the way the list will after saving — but only when that slot is
 * otherwise free. Overwriting a holder's name would hide who is about to be
 * displaced, which is the one thing worth seeing before saving.
 */
function refreshSlotOptions() {
  const holders = new Map();
  (state.builds || []).forEach((b) => {
    if (b.declaredSlot && b.source !== state.replacing) holders.set(b.declaredSlot, b.name);
  });

  const mine = el.slot.value ? Number(el.slot.value) : null;
  if (mine && !holders.has(mine)) holders.set(mine, el.name.value.trim() || '이 빌드');

  [...el.slot.options].forEach((opt) => {
    if (!opt.value) return;
    const held = holders.get(Number(opt.value));
    opt.textContent = held ? `${opt.value} — ${held}` : opt.value;
  });
}

async function refreshList(activeSource) {
  const builds = await window.editor.list();
  state.builds = builds;
  refreshSlotOptions();
  el.buildList.replaceChildren();

  builds.forEach((b) => {
    const li = document.createElement('li');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'build-item';
    if (b.source === (activeSource || state.replacing)) item.classList.add('active');

    const slot = document.createElement('span');
    slot.className = 'slot';
    slot.textContent = b.slot || '·';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = b.name;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${b.steps}`;

    item.append(slot, name, count);
    item.addEventListener('click', () => loadBuild(b.source));
    li.append(item);
    el.buildList.append(li);
  });
}

function confirmDiscard() {
  if (!state.dirty) return true;
  return window.confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?');
}

async function loadBuild(source) {
  if (!confirmDiscard()) return;
  try {
    const result = await window.editor.read(source);
    fillForm(result.build);
    el.filename.value = result.filename;
    state.replacing = result.filename;
    state.dirty = false;
    el.remove.disabled = false;

    const warnings = [];
    if (result.hasComments) warnings.push('이 파일에는 # 주석이 있습니다. 편집기로 저장하면 주석은 사라집니다.');
    if (result.problems.length) {
      warnings.push(...result.problems.map((p) => `${p.line}행: ${p.message}`));
    }
    el.orderWarning.textContent = warnings.join('\n');

    setStatus(`${result.filename} 불러옴`, 'ok');
    refreshPreview();
    await refreshList(result.filename);
  } catch (err) {
    setStatus(`불러오기 실패: ${err.message}`, 'bad');
  }
}

function newBuild() {
  if (!confirmDiscard()) return;
  fillForm({ name: '', race: 'T', vs: '*', slot: null, notes: null, steps: [] });
  el.filename.value = '';
  state.replacing = null;
  state.dirty = false;
  el.remove.disabled = true;
  setStatus('새 빌드');
  refreshPreview();
  refreshList(null);
  el.name.focus();
}

async function save() {
  const build = currentBuild();
  if (!build.name) {
    setStatus('빌드 이름을 입력하세요.', 'bad');
    el.name.focus();
    return;
  }
  if (build.steps.length === 0) {
    setStatus('시간과 행동이 채워진 단계가 하나도 없습니다.', 'bad');
    return;
  }

  const filename = el.filename.value.trim() || suggestFilename();
  const result = await window.editor.save({ filename, build, replacing: state.replacing });
  if (!result.ok) {
    setStatus(result.message, 'bad');
    return;
  }

  state.replacing = result.filename;
  state.dirty = false;
  el.filename.value = result.filename;
  el.remove.disabled = false;

  const swap = result.swapped
    ? ` · ${result.swapped.name} → ${result.swapped.slot ? `${result.swapped.slot}번` : '슬롯 없음'}`
    : '';
  setStatus(`${result.filename} 저장 · ${result.steps}단계${swap}`, 'ok');
  await refreshList(result.filename);
}

async function remove() {
  if (!state.replacing) return;
  const result = await window.editor.remove(state.replacing);
  if (!result.ok) {
    setStatus(result.message, 'bad');
    return;
  }
  setStatus('휴지통으로 옮겼습니다.', 'ok');
  state.dirty = false;
  newBuild();
  await refreshList(null);
}

// ---------------------------------------------------------------- export import

function importOptions() {
  return {
    notes: el.impNotes.checked,
    situational: el.impSituational.checked,
    filler: el.impFiller.checked ? 'drop' : 'collapse',
  };
}

function renderBranches(branches, selected) {
  el.branchList.replaceChildren();

  branches.forEach((b) => {
    const li = document.createElement('li');
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'branch-item';
    if (b.id === selected) item.classList.add('active');

    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = b.id === selected ? '▶' : '';

    const games = document.createElement('span');
    games.className = 'num';
    games.textContent = b.games != null ? `${b.games}판` : '—';

    const wr = document.createElement('span');
    wr.className = 'wr';
    wr.textContent = b.winRate != null ? `승률 ${Math.round(b.winRate * 100)}%` : '승률 —';

    const steps = document.createElement('span');
    steps.className = 'num';
    steps.textContent = `${b.steps}단계`;

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = b.label;

    item.append(mark, games, wr, steps, label);
    item.addEventListener('click', () => useBranch(b.id, branches));
    li.append(item);
    el.branchList.append(li);
  });
}

/** Converts the chosen branch and drops the result into the form. */
async function useBranch(branchId, branches) {
  const result = await window.editor.convertExport({ branchId, options: importOptions() });
  if (!result.ok) {
    setStatus(result.message, 'bad');
    return;
  }

  state.branch = { id: result.selected, branches };
  fillForm(result.build);
  el.filename.value = '';
  state.replacing = null;
  state.dirty = true;
  el.remove.disabled = true;

  renderBranches(branches, result.selected);
  el.importReport.textContent = result.notes.join('\n');
  el.importReport.classList.toggle('bad', result.missing.length > 0);

  setStatus(`${result.build.steps.length}단계 가져옴 · 파일 이름을 정하고 저장하세요`, 'ok');
  refreshPreview();
}

async function openExport() {
  if (!confirmDiscard()) return;
  const result = await window.editor.openExport();
  if (result.canceled) return;
  if (!result.ok) {
    setStatus(result.message, 'bad');
    return;
  }

  // Naming the tree matters: an export carries every race the site had open, and
  // only this one's branches are listed.
  const race = result.branches.length ? result.branches[0].race : null;
  const tree = race ? ` · ${race} 트리 ${result.branches.length}개 분기` : '';
  el.exportSource.textContent =
    `${result.filename}${result.title ? ` — ${result.title}` : ''}${tree}`;
  el.branchBox.hidden = false;
  state.branch = { id: result.selected, branches: result.branches };
  renderBranches(result.branches, result.selected);
  el.importReport.textContent = '';

  // Convert the default branch straight away so there is something to look at.
  await useBranch(result.selected, result.branches);
}

async function importText() {
  const raw = el.importText.value;
  if (!raw.trim()) return;
  const { build, problems } = await window.editor.importText(raw);
  fillForm(build);
  state.dirty = true;
  el.importPanel.open = false;
  el.orderWarning.textContent = problems.length
    ? problems.map((p) => `${p.line}행: ${p.message}`).join('\n')
    : '';
  setStatus(`${build.steps.length}단계 가져옴`, 'ok');
  refreshPreview();
}

// ---------------------------------------------------------------- wiring

[el.name, el.notes].forEach((input) => input.addEventListener('input', markDirty));
[el.race, el.vs, el.slot].forEach((input) => input.addEventListener('change', markDirty));

// The dropdown shows this build's own name against its slot, so both inputs
// have to re-label it.
el.name.addEventListener('input', refreshSlotOptions);
el.slot.addEventListener('change', refreshSlotOptions);
el.filename.addEventListener('input', markDirty);

el.addStep.addEventListener('click', () => addStep());
el.sortSteps.addEventListener('click', () => {
  state.steps.sort((a, b) => (a.at == null ? 1 : b.at == null ? -1 : a.at - b.at));
  renderRows();
  markDirty();
});
el.addAtClock.addEventListener('click', () => addStep({ at: Math.round(state.clock.displayTime) }));

el.newBuild.addEventListener('click', newBuild);
el.openDir.addEventListener('click', () => window.editor.openDir());
el.save.addEventListener('click', save);
el.remove.addEventListener('click', remove);
el.doImport.addEventListener('click', importText);
el.openExport.addEventListener('click', openExport);

// Changing an option re-converts the branch already chosen.
[el.impNotes, el.impSituational, el.impFiller].forEach((input) =>
  input.addEventListener('change', () => {
    if (state.branch) useBranch(state.branch.id, state.branch.branches);
  })
);

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    save();
  }
});

window.editor.onClock((clock) => {
  state.clock = clock;
  const live = clock.inGame;
  el.clockChip.textContent = live
    ? `${formatTime(clock.displayTime)}${clock.mock ? ' (mock)' : ''}`
    : clock.connected
      ? '게임 대기 중'
      : 'SC2 대기 중';
  el.clockChip.classList.toggle('live', live);
  el.addAtClock.disabled = !live;
});

newBuild();
refreshList(null);
