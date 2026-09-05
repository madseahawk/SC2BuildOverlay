'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  runDot: $('run-dot'),
  runLabel: $('run-label'),
  runDetail: $('run-detail'),
  runToggle: $('run-toggle'),

  mockBanner: $('mock-banner'),
  sClient: $('s-client'),
  sGame: $('s-game'),
  sClock: $('s-clock'),
  sNext: $('s-next'),

  buildList: $('build-list'),
  buildEmpty: $('build-empty'),
  buildProblems: $('build-problems'),
  autoPick: $('auto-pick'),
  reload: $('reload'),
  openEditor: $('open-editor'),

  toggleVisible: $('toggle-visible'),
  toggleLocked: $('toggle-locked'),
  modeAuto: $('mode-auto'),
  modeManual: $('mode-manual'),
  iconsNone: $('icons-none'),
  iconsSmall: $('icons-small'),
  iconsLarge: $('icons-large'),
  iconsHint: $('icons-hint'),
  iconsFetchRow: $('icons-fetch-row'),
  iconsFetchState: $('icons-fetch-state'),
  iconsFetch: $('icons-fetch'),

  lead: $('lead'),
  leadValue: $('lead-value'),
  opacity: $('opacity'),
  opacityValue: $('opacity-value'),
  scale: $('scale'),
  scaleValue: $('scale-value'),
  stepScale: $('step-scale'),
  stepScaleValue: $('step-scale-value'),
  widthScale: $('width-scale'),
  widthScaleValue: $('width-scale-value'),
  lookbehind: $('lookbehind'),
  lookahead: $('lookahead'),

  corners: {
    'top-left': $('pos-tl'),
    'top-right': $('pos-tr'),
    'bottom-left': $('pos-bl'),
    'bottom-right': $('pos-br'),
  },

  soundEnabled: $('sound-enabled'),
  soundVolume: $('sound-volume'),
  soundVolumeValue: $('sound-volume-value'),
  testSound: $('test-sound'),
  soundFile: $('sound-file'),
  soundProblem: $('sound-problem'),
  soundPick: $('sound-pick'),
  soundDefault: $('sound-default'),

  myName: $('my-name'),
  playersHint: $('players-hint'),
  autoStart: $('auto-start'),
  autoStartGame: $('auto-start-game'),

  openDir: $('open-dir'),
  quit: $('quit'),
};

const RACE_LABEL = { T: '테란', Z: '저그', P: '프로토스', R: '랜덤', '*': '아무 종족' };

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** True while the user is interacting with a control, so we don't fight them. */
function busy(input) {
  return document.activeElement === input;
}

function renderRun(view) {
  const { running, game } = view;

  // Mock mode hardcodes connected/inGame and two fake players, so it must never
  // be able to read as a real connection.
  const mock = Boolean(game.mock);

  el.runDot.classList.toggle('on', running);
  el.runDot.classList.toggle('waiting', !running && Boolean(view.watching));
  el.runLabel.textContent = running ? '실행 중' : view.watching ? '대기 중' : '정지됨';
  el.runDetail.textContent = !running
    ? view.watching
      ? '게임이 시작되면 자동으로 시작합니다'
      : '시작을 누르면 SC2 를 읽습니다'
    : mock
      ? '가짜 시계 · SC2 안 읽음'
      : 'SC2 를 250ms 마다 읽는 중';
  el.runToggle.textContent = running ? '■ 정지' : '▶ 시작';
  el.runToggle.classList.toggle('running', running);
  el.mockBanner.hidden = !mock;

  el.sClient.textContent = !running
    ? '—'
    : mock
      ? '읽지 않음 · 가짜'
      : game.connected
        ? '연결됨 · localhost:6119'
        : '대기 중 · SC2 미실행';
  el.sClient.classList.toggle('live', running && !mock && game.connected);
  el.sClient.classList.toggle('mock', running && mock);

  if (!running) {
    el.sGame.textContent = '—';
    el.sClock.textContent = '—';
  } else if (game.inGame) {
    const me = game.me ? `${game.me.name} (${RACE_LABEL[game.me.race] || '?'})` : '미확인';
    const opp = game.opponent ? `${game.opponent.name} (${RACE_LABEL[game.opponent.race] || '?'})` : '미확인';
    el.sGame.textContent = mock ? `가짜: ${me} vs ${opp}` : `${me} vs ${opp}`;
    el.sClock.textContent = `${formatTime(game.displayTime)}${mock ? '  · 가짜' : ''}${game.isReplay ? '  리플레이' : ''}`;
  } else {
    el.sGame.textContent = '게임 대기 중';
    el.sClock.textContent = '—';
  }
  el.sGame.classList.toggle('live', running && !mock && Boolean(game.inGame));
  el.sGame.classList.toggle('mock', running && mock);
  el.sClock.classList.toggle('mock', running && mock);

  const step = running ? view.nextStep : null;
  const noMatch = running ? view.noMatch : null;
  el.sNext.textContent = !running
    ? '—'
    : noMatch && noMatch.unknownPlayer
      ? '내 플레이어 미확인 — 아래에 이름 입력'
      : noMatch
      ? `${noMatch.race || '?'}v${noMatch.vs || '?'} 빌드가 없습니다`
      : step
        ? `${formatTime(step.at)}  ${step.supply ? `@${step.supply}  ` : ''}${step.action}`
        : view.totalSteps
          ? '빌드 끝'
          : '—';
  el.sNext.classList.toggle('warn-text', Boolean(noMatch));
}

function renderBuilds(view) {
  el.buildList.replaceChildren();
  el.buildEmpty.classList.toggle('gone', view.builds.length > 0);

  const favs = view.favorites || [];
  const pinned = view.pinnedSource || null;

  view.builds.forEach((b) => {
    const li = document.createElement('li');
    li.className = 'build-row';

    // A separate control, not part of the row button: starring a build is not
    // the same as choosing it.
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star';
    const fav = favs.includes(b.source);
    star.classList.toggle('on', fav);
    star.textContent = fav ? '★' : '☆';
    star.title = fav ? '즐겨찾기 해제' : '이 매치업의 기본으로';
    star.addEventListener('click', () => window.control.toggleFavorite(b.source));

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'build-item';
    if (b.source === view.activeSource) item.classList.add('active');
    if (b.source === pinned) item.classList.add('pinned');

    const slot = document.createElement('span');
    slot.className = 'slot';
    slot.textContent = b.slot || '·';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = b.name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    const matchup = `${b.race || '?'}v${b.vs === '*' ? 'X' : b.vs || 'X'}`;
    meta.textContent =
      b.source === pinned
        ? '고정 — 눌러서 해제'
        : `${matchup} · ${b.steps}단계${b.problems ? ` · ⚠${b.problems}` : ''}`;

    item.append(slot, name, meta);
    // Clicking the pinned build again releases it back to auto-pick.
    item.addEventListener('click', () =>
      b.source === pinned ? window.control.clearPin() : window.control.pickBuild(b.source)
    );

    li.append(star, item);
    el.buildList.append(li);
  });

  const broken = view.builds.filter((b) => b.problems);
  el.buildProblems.textContent = broken.length
    ? `읽지 못한 줄이 있는 파일: ${broken.map((b) => b.name).join(', ')} — 편집기에서 확인하세요.`
    : '';
}

function renderOverlayControls(view) {
  const { ui } = view;

  // Showing, hiding, locking and moving the overlay all work while stopped —
  // that is the state you set it up in.
  el.toggleVisible.textContent = ui.visible ? '숨기기' : '표시';
  el.toggleLocked.disabled = !ui.visible;
  el.toggleLocked.textContent = ui.locked ? '잠금 해제' : '잠그기';

  el.modeAuto.classList.toggle('on', ui.mode === 'auto');
  el.modeManual.classList.toggle('on', ui.mode === 'manual');

  // Moving a hidden window would be invisible and confusing, so the presets
  // only work while there is an overlay on screen to move.
  const movable = ui.visible;
  Object.values(el.corners).forEach((b) => {
    b.disabled = !movable;
  });
}

/**
 * SC2 does not say which player is the local one, so the name field is how we
 * tell. Rather than have the user guess what the API calls them, show the names
 * it actually reported and mark the one that matches.
 */
function renderPlayersHint(view) {
  const { running, game, settings } = view;
  const players = (game && game.players) || [];
  const el2 = el.playersHint;

  el2.classList.toggle('live', Boolean(running && game.inGame && players.length));

  if (!running || !game.inGame || players.length === 0) {
    el2.textContent = '게임에 들어가면 SC2 가 알려주는 이름이 여기 표시됩니다.';
    return;
  }

  const typed = String(settings.myName || '').trim().toLowerCase();
  el2.replaceChildren(document.createTextNode('이 게임의 플레이어: '));

  players.forEach((p, i) => {
    if (i > 0) el2.append(document.createTextNode(' · '));
    const who = document.createElement('span');
    who.className = 'who';
    const name = p.name || '(이름 없음)';
    if (typed && name.toLowerCase() === typed) who.classList.add('matched');
    who.textContent = name;
    el2.append(who);
  });

  const matched = typed && players.some((p) => (p.name || '').toLowerCase() === typed);
  const humans = players.filter((p) => p.type === 'user').length;
  el2.append(
    document.createTextNode(
      matched ? ' — 인식됨' : humans <= 1 ? ' — 자동 구분됨' : ' — 내 쪽을 위에 입력'
    )
  );
}

function renderSettings(view) {
  const { settings } = view;

  if (!busy(el.lead)) el.lead.value = settings.leadSeconds;
  el.leadValue.textContent = `${settings.leadSeconds}초`;

  const iconMode = settings.iconMode || 'none';
  el.iconsNone.classList.toggle('on', iconMode === 'none');
  el.iconsSmall.classList.toggle('on', iconMode === 'small');
  el.iconsLarge.classList.toggle('on', iconMode === 'large');
  // Nothing to explain while it works — 없음/작게/크게 says it. But an icon
  // folder that failed to load would leave the option looking simply broken.
  const iconsMissing = settings.iconsAvailable === false;
  const fetch = settings.iconFetch;
  const fetching = Boolean(fetch && fetch.running);

  el.iconsHint.hidden = !iconsMissing || fetching;
  el.iconsHint.textContent = iconsMissing
    ? '그림 파일이 아직 없습니다. 아래에서 내려받으면 단계 옆에 표시됩니다.'
    : '';
  el.iconsHint.classList.toggle('warn', iconsMissing && !fetching);

  // Only offered when there is something to do: nothing to fetch once the set
  // is in place, and no reason to mention the network otherwise.
  el.iconsFetchRow.hidden = !iconsMissing && !fetching && !(fetch && fetch.message);
  el.iconsFetch.disabled = fetching;
  el.iconsFetch.textContent = fetching ? '받는 중…' : '그림 내려받기';
  el.iconsFetchState.textContent = fetching
    ? `${fetch.done} / ${fetch.total || '…'}`
    : (fetch && fetch.message) || '';
  el.iconsFetchState.classList.toggle('warn', Boolean(!fetching && fetch && fetch.message));

  if (!busy(el.opacity)) el.opacity.value = settings.opacity;
  el.opacityValue.textContent = `${Math.round(settings.opacity * 100)}%`;

  if (!busy(el.scale)) el.scale.value = settings.scale;
  el.scaleValue.textContent = `${Math.round(settings.scale * 100)}%`;

  if (!busy(el.stepScale)) el.stepScale.value = settings.stepScale;
  el.stepScaleValue.textContent = `${Math.round(settings.stepScale * 100)}%`;

  // The multiplier on its own says nothing about how much text now fits, and
  // 크기 and 아이콘 feed into the same number — so report the pixels it lands on.
  if (!busy(el.widthScale)) el.widthScale.value = settings.widthScale;
  el.widthScaleValue.textContent =
    `${Math.round(settings.widthScale * 100)}% · ${settings.overlayWidth}px`;

  if (!busy(el.lookbehind)) el.lookbehind.value = settings.lookbehind;
  if (!busy(el.lookahead)) el.lookahead.value = settings.lookahead;
  if (!busy(el.myName)) el.myName.value = settings.myName || '';

  if (!busy(el.soundVolume)) el.soundVolume.value = settings.soundVolume;
  el.soundVolumeValue.textContent = `${Math.round(settings.soundVolume * 100)}%`;
  el.soundVolume.disabled = !settings.soundEnabled;

  // Long filenames would push the field's layout apart, and the tail is the
  // part that identifies the file anyway.
  const custom = settings.soundFile;
  el.soundFile.textContent = custom
    ? (custom.length > 28 ? `…${custom.slice(-27)}` : custom)
    : '기본 내장음';
  el.soundFile.title = custom || '';
  el.soundDefault.disabled = !custom;

  el.soundProblem.textContent = settings.soundProblem || '';
  el.soundProblem.hidden = !settings.soundProblem;

  el.soundEnabled.checked = Boolean(settings.soundEnabled);
  el.autoPick.checked = Boolean(settings.autoPick);
  el.autoStart.checked = Boolean(settings.autoStart);
  el.autoStartGame.checked = Boolean(settings.autoStartOnGame);
}

/** Last state pushed from the main process; buttons read this, not the DOM. */
let current = null;

window.control.onView((view) => {
  current = view;
  renderRun(view);
  renderBuilds(view);
  renderOverlayControls(view);
  renderSettings(view);
  renderPlayersHint(view);
});

// ---------------------------------------------------------------- wiring

el.runToggle.addEventListener('click', () => {
  if (current && current.running) window.control.stop();
  else window.control.start();
});

el.toggleVisible.addEventListener('click', () => {
  if (current) window.control.setVisible(!current.ui.visible);
});
el.toggleLocked.addEventListener('click', () => {
  if (current) window.control.setLocked(!current.ui.locked);
});
el.modeAuto.addEventListener('click', () => window.control.setMode('auto'));
el.modeManual.addEventListener('click', () => window.control.setMode('manual'));

el.iconsNone.addEventListener('click', () => patchSettings({ iconMode: 'none' }));
el.iconsSmall.addEventListener('click', () => patchSettings({ iconMode: 'small' }));
el.iconsLarge.addEventListener('click', () => patchSettings({ iconMode: 'large' }));

const patchSettings = (patch) => window.control.updateSettings(patch);
el.lead.addEventListener('input', () => patchSettings({ leadSeconds: Number(el.lead.value) }));
el.opacity.addEventListener('input', () => patchSettings({ opacity: Number(el.opacity.value) }));
el.scale.addEventListener('input', () => patchSettings({ scale: Number(el.scale.value) }));
el.stepScale.addEventListener('input', () => patchSettings({ stepScale: Number(el.stepScale.value) }));
el.widthScale.addEventListener('input', () => patchSettings({ widthScale: Number(el.widthScale.value) }));
el.lookbehind.addEventListener('change', () => patchSettings({ lookbehind: Number(el.lookbehind.value) }));
el.lookahead.addEventListener('change', () => patchSettings({ lookahead: Number(el.lookahead.value) }));
el.myName.addEventListener('change', () => patchSettings({ myName: el.myName.value.trim() }));
// Re-mark the matching player as you type, not only on commit.
el.myName.addEventListener('input', () => {
  if (current) renderPlayersHint({ ...current, settings: { ...current.settings, myName: el.myName.value } });
});
el.autoPick.addEventListener('change', () => patchSettings({ autoPick: el.autoPick.checked }));
el.autoStart.addEventListener('change', () => patchSettings({ autoStart: el.autoStart.checked }));
el.autoStartGame.addEventListener('change', () =>
  patchSettings({ autoStartOnGame: el.autoStartGame.checked })
);

Object.entries(el.corners).forEach(([where, button]) => {
  button.addEventListener('click', () => window.control.moveOverlay(where));
});

el.soundEnabled.addEventListener('change', () => patchSettings({ soundEnabled: el.soundEnabled.checked }));
el.soundVolume.addEventListener('input', () => patchSettings({ soundVolume: Number(el.soundVolume.value) }));
// Play on release, not on every drag step, or dragging the slider machine-guns.
el.soundVolume.addEventListener('change', () => window.control.testSound());
el.testSound.addEventListener('click', () => window.control.testSound());
el.soundPick.addEventListener('click', () => window.control.pickSound());
el.soundDefault.addEventListener('click', () => window.control.resetSound());
el.iconsFetch.addEventListener('click', () => window.control.fetchIcons());

el.reload.addEventListener('click', () => window.control.reload());
el.openEditor.addEventListener('click', () => window.control.openEditor());
el.openDir.addEventListener('click', () => window.control.openDir());
el.quit.addEventListener('click', () => window.control.quit());
