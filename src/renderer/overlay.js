'use strict';

const IMMINENT_SECONDS = 8;

const el = {
  panel: document.getElementById('panel'),
  buildLabel: document.getElementById('build-label'),
  slot: document.getElementById('slot'),
  flash: document.getElementById('flash'),
  matchup: document.getElementById('matchup'),
  clock: document.getElementById('clock'),
  badges: document.getElementById('badges'),
  steps: document.getElementById('steps'),
  status: document.getElementById('status'),
  hint: document.getElementById('hint'),
};

const RACE_LABEL = { T: 'Terran', Z: 'Zerg', P: 'Protoss', R: 'Random', '*': 'Any' };
const RACE_SHORT = { T: 'T', Z: 'Z', P: 'P', R: 'R' };

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The slice of the build worth showing: a little history, then what's coming. */
function visibleRange(steps, nextIndex, { lookbehind, lookahead }) {
  const start = Math.max(0, nextIndex - lookbehind);
  const end = Math.min(steps.length, nextIndex + lookahead);
  return { start, end };
}

function matchupLabel(noMatch) {
  const me = RACE_SHORT[noMatch.race] || '?';
  const opp = noMatch.vs ? RACE_SHORT[noMatch.vs] || '?' : '?';
  return `${me}v${opp}`;
}

function renderSteps(view) {
  const { build, nextIndex, clock, ui, settings } = view;
  const iconMode = settings.iconMode || 'none';
  el.steps.replaceChildren();

  if (!build || build.steps.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    if (build) {
      li.textContent = '이 빌드에 단계가 없습니다.';
    } else if (view.noMatch && view.noMatch.unknownPlayer) {
      // The matchup cannot be read because we do not know which player is us.
      li.innerHTML =
        '내 플레이어를 못 찾았습니다.<br />' +
        '제어창 설정에 <strong>내 플레이어 이름</strong>을 넣으세요.';
    } else if (view.noMatch) {
      // Auto-pick found nothing for this matchup. Naming it beats a blank panel.
      li.innerHTML =
        `<strong>${matchupLabel(view.noMatch)}</strong> 빌드가 없습니다.<br />` +
        '<code>Ctrl+Alt+숫자</code> 로 직접 고르거나 편집기에서 만드세요.';
    } else {
      li.innerHTML = '빌드가 없습니다.<br /><code>Ctrl+Alt+E</code> 로 편집기를 여세요.';
    }
    el.steps.append(li);
    return;
  }

  const { start, end } = visibleRange(build.steps, nextIndex, settings);
  let lastSection = start > 0 ? build.steps[start - 1].section : null;

  for (let i = start; i < end; i += 1) {
    const step = build.steps[i];

    if (step.section && step.section !== lastSection) {
      const label = document.createElement('li');
      label.className = 'section-label';
      label.textContent = step.section;
      el.steps.append(label);
    }
    lastSection = step.section;

    const li = document.createElement('li');
    li.className = 'step';
    if (i < nextIndex) li.classList.add('done');

    const until = step.at - clock;
    if (i === nextIndex) {
      li.classList.add('next');
      // The pulse says "do this now", so it needs a clock that is actually
      // moving — parked at 0:00 while stopped, it would cry wolf.
      const live = view.running && view.game.inGame && ui.mode === 'auto';
      if (live && until <= IMMINENT_SECONDS) li.classList.add('imminent');
    }

    const at = document.createElement('span');
    at.className = 'at';
    at.textContent = formatTime(step.at);

    const supply = document.createElement('span');
    supply.className = 'supply';
    supply.textContent = step.supply == null ? '' : step.supply;

    // Rendered in every icon mode, empty span included, so the action text
    // starts at the same place on rows whose step has no picture.
    const iconCell = iconMode === 'none' ? null : document.createElement('span');
    if (iconCell) {
      iconCell.className = 'icon';
      const icon = step.icons && step.icons[0];
      if (icon) {
        const img = document.createElement('img');
        img.src = icon.src;
        img.alt = ''; // the term is right there as text
        img.draggable = false;
        // A half-copied assets folder would otherwise show broken-image glyphs.
        img.addEventListener('error', () => img.remove());
        iconCell.append(img);
      }
    }

    const action = document.createElement('span');
    action.className = 'action';
    action.textContent = step.action;
    if (step.note) {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = step.note;
      action.append(note);
    }

    const untilEl = document.createElement('span');
    untilEl.className = 'until';
    if (i === nextIndex && ui.mode === 'auto' && view.game.inGame && until > 0) {
      untilEl.textContent = `-${formatTime(until)}`;
    }

    li.append(...(iconCell ? [at, supply, iconCell, action, untilEl] : [at, supply, action, untilEl]));
    el.steps.append(li);
  }
}

function renderHeader(view) {
  const { build, game, ui, clock } = view;

  el.buildLabel.textContent = build ? build.name : '빌드 없음';
  el.slot.textContent = build && build.slot ? build.slot : '';
  el.slot.classList.toggle('shown', Boolean(build && build.slot));
  el.matchup.textContent = build
    ? [RACE_LABEL[build.race] || '?', 'vs', RACE_LABEL[build.vs] || 'Any'].join(' ')
    : '';

  el.clock.textContent = formatTime(ui.mode === 'manual' ? clock : game.displayTime);

  el.badges.replaceChildren();
  const badge = (cls, text) => {
    const span = document.createElement('span');
    span.className = `badge ${cls}`;
    span.textContent = text;
    el.badges.append(span);
  };
  // No badge for the mock clock: it is a dev-only detail and the control window
  // already labels it. Only what matters mid-game earns space over the screen.
  if (ui.mode === 'manual') badge('manual', '수동');
  if (game.isReplay) badge('replay', '리플레이');
}

function renderStatus(view) {
  const { game, ui } = view;
  let text;
  if (!game.connected) text = 'SC2 대기 중';
  else if (!game.inGame) text = '게임 대기 중';
  else if (game.opponent) text = `vs ${game.opponent.name} (${RACE_LABEL[game.opponent.race] || '?'})`;
  else text = '게임 진행 중';

  el.status.textContent = text;
  el.status.classList.toggle('live', Boolean(game.inGame));
  el.hint.textContent = ui.locked ? 'Ctrl+Alt+C 제어창' : '헤더를 끌어 이동';
}

/**
 * Reports the panel's rendered height so the window can be sized to it. The
 * width follows the scale setting and is decided in the main process; the
 * height cannot be, because it depends on how many steps fit, how long the
 * notes are, and whether they wrapped.
 */
let reportedHeight = 0;
function reportHeight() {
  const height = Math.ceil(el.panel.getBoundingClientRect().height);
  if (height > 0 && height !== reportedHeight) {
    reportedHeight = height;
    window.overlay.reportHeight(height);
  }
}

window.overlay.onView((view) => {
  el.panel.classList.toggle('locked', view.ui.locked);
  const iconMode = view.settings.iconMode || 'none';
  document.body.classList.toggle('icons-small', iconMode === 'small');
  document.body.classList.toggle('icons-large', iconMode === 'large');
  el.panel.style.opacity = view.settings.opacity;
  document.documentElement.style.fontSize = `${15 * (view.settings.scale || 1)}px`;
  // A second axis over the root size, for the step list alone. The window width
  // does not follow it — that is the 가로 폭 setting — so a larger size trades
  // room for the action text, which ellipsises rather than wrapping.
  document.documentElement.style.setProperty('--step-scale', view.settings.stepScale || 1);

  renderHeader(view);
  renderSteps(view);
  renderStatus(view);

  // Measure after layout has settled on the new font size and step list.
  requestAnimationFrame(reportHeight);
});

window.overlay.onCue((cue) => {
  window.cueSound.play(cue.volume);
});

// Decoded once here, not on every cue. The verdict goes back because a sound
// that fails to decode is otherwise indistinguishable from one that plays: the
// overlay is muted mid-game either way, and only the control window can say so.
window.overlay.onCueSound(async (bytes) => {
  const result = await window.cueSound.load(bytes);
  window.overlay.reportCueSound(result);
});

let flashTimer = null;
window.overlay.onFlash((text) => {
  el.flash.textContent = text;
  el.flash.classList.add('shown');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.flash.classList.remove('shown'), 1400);
});
