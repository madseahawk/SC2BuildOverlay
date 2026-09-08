'use strict';

/**
 * Suggests the words that put a picture next to a step.
 *
 * Typing `수정탑` in a step's 행동 is what makes the 수정탑 icon appear on the
 * overlay — the match happens on the text, with no separate picture to choose.
 * That is convenient once you know the vocabulary and invisible until then, so
 * the editor offers the vocabulary while you type, with the picture beside each
 * name so the thing you are choosing is the thing you will see.
 *
 * One popup is shared by every row. A 60-step build would otherwise carry 60
 * hidden lists around, and only one input can have the caret anyway.
 */

/**
 * What separates one thing from the next inside a step: `보급고 → 병영`,
 * `해병/불곰`, `추출장, 대군주`. Text after the last of these is the thing being
 * named, and the only part a suggestion may replace.
 *
 * A space is deliberately *not* one of them. 61% of the vocabulary has a space
 * in it (`지상 무기 1단계`, `공학 연구소`, `병영 기술실`), and stopping at the
 * space meant the suggestion vanished the moment you typed past it — `지상`
 * offered the upgrade, `지상 무` offered 무기고, and the term you were halfway
 * through typing became unreachable.
 */
const HARD = /[,/+·→>()[\]]/;

const MAX_SHOWN = 8;

let terms = [];
let box = null;
let input = null;
let items = [];
let active = -1;
let onPick = null;
/* The fragment the visible list was built from. `accept` has to replace this
   exact span — recomputing it would pick the longest reading again and
   overwrite words the match never covered. */
let span = null;

/** @param list [{ term, src }] from the main process */
function setTerms(list) {
  terms = Array.isArray(list) ? list : [];
}

function ensureBox() {
  if (box) return box;
  box = document.createElement('ul');
  box.className = 'suggest';
  box.hidden = true;
  // `mousedown`, not `click`: the input loses focus first on a click, and the
  // blur handler would have closed the popup before the click landed.
  box.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    accept(Number(li.dataset.index));
  });
  document.body.append(box);
  watchMovement();
  return box;
}

/**
 * What the caret could be in the middle of naming, longest first.
 *
 * Since a space no longer ends a fragment, the text back to the last hard
 * separator can hold more than one thing: in `앞마당 병영` the whole run matches
 * nothing but its last word matches 병영. So the run is offered whole, then with
 * its leading words dropped one at a time, and the caller takes the first
 * candidate that finds anything — the most specific reading that works.
 */
function fragmentsOf(el) {
  const caret = el.selectionStart == null ? el.value.length : el.selectionStart;
  const before = el.value.slice(0, caret);

  let cut = before.length;
  while (cut > 0 && !HARD.test(before[cut - 1])) cut -= 1;

  // Leading blanks belong to the separator, not to the name.
  const run = before.slice(cut);
  const base = cut + (run.length - run.trimStart().length);
  const text = before.slice(base);

  const out = [];
  for (let i = 0; i <= text.length; ) {
    if (i === 0 || text[i - 1] === ' ') out.push({ text: text.slice(i), start: base + i, caret });
    const next = text.indexOf(' ', i);
    if (next < 0) break;
    i = next + 1;
  }
  return out;
}

/**
 * Names worth offering for `fragment`, best first.
 *
 * Ranked by where the fragment lands rather than by the term's own length: with
 * `무기` there are 17 candidates and only eight places, and sorting by length
 * pushed `지상 무기 1단계` to ninth — outside the list — while three levels of
 * 공중 무기 took its place. Position puts every prefix match first, and length
 * only breaks the ties that are left.
 */
function matches(fragment) {
  if (!fragment) return [];
  /* One character is too little to search inside names with: `병` appears in
     해병, 화염기갑병 and 보병 무기 1단계, none of which is what someone typing
     it is reaching for. Prefix only until there are two to go on. */
  const inside = fragment.length >= 2;

  const found = [];
  for (const t of terms) {
    const at = t.term.indexOf(fragment);
    if (at === 0 || (inside && at > 0)) found.push({ t, at });
  }

  found.sort(
    (a, b) => a.at - b.at || a.t.term.length - b.t.term.length || a.t.term.localeCompare(b.t.term)
  );
  /* The name typed exactly stays in the list like any other. Dropping it meant
     the popup closed the moment a term was complete — and it closes on a typo
     too, so `제련소` and `제련솧` looked identical while one draws a picture and
     the other does not. Its presence is the confirmation that the word works. */
  return found.slice(0, MAX_SHOWN).map(({ t }) => t);
}

function place() {
  const r = input.getBoundingClientRect();
  box.style.left = `${Math.round(r.left)}px`;
  box.style.minWidth = `${Math.round(r.width)}px`;
  // Below the field, unless that would run off the bottom of the window.
  const below = window.innerHeight - r.bottom;
  if (below < box.offsetHeight + 8 && r.top > box.offsetHeight + 8) {
    box.style.top = `${Math.round(r.top - box.offsetHeight - 2)}px`;
  } else {
    box.style.top = `${Math.round(r.bottom + 2)}px`;
  }
}

function render() {
  box.replaceChildren();
  items.forEach((t, i) => {
    const li = document.createElement('li');
    li.dataset.index = String(i);
    li.className = i === active ? 'on' : '';
    if (t.src) {
      const img = document.createElement('img');
      img.src = t.src;
      img.alt = '';
      img.draggable = false;
      img.addEventListener('error', () => img.remove());
      li.append(img);
    }
    const name = document.createElement('span');
    name.textContent = t.term;
    li.append(name);
    box.append(li);
  });
  box.hidden = false;
  place();
}

/* The popup is positioned once, from the field's viewport rect. The step list
   scrolls inside its own pane, so anything that moves the field leaves the
   popup behind, pointing at a row that is no longer there. Closing is both
   cheaper and less confusing than chasing it. Capture phase, because the pane
   scrolls, not the window. */
function watchMovement() {
  addEventListener('scroll', close, true);
  addEventListener('resize', close);
}

function close() {
  if (!box || box.hidden) return;
  box.hidden = true;
  // Emptied, not just hidden. Leaving the last list in the DOM keeps images
  // and stale names around for whatever reads it next.
  box.replaceChildren();
  items = [];
  active = -1;
  span = null;
}

const open = () => Boolean(box && !box.hidden && items.length);

function accept(index) {
  const pick = items[index];
  /* `isConnected` because the row list is rebuilt wholesale on add, delete and
     sort. Writing into a field that has already been thrown away loses the text
     with nothing on screen to say so. */
  if (!pick || !input || !span || !input.isConnected) return;
  const { start, caret } = span;
  const el = input;
  el.value = el.value.slice(0, start) + pick.term + el.value.slice(caret);
  const at = start + pick.term.length;
  el.setSelectionRange(at, at);
  close();
  // The row keeps its own copy of the text, so it has to be told.
  if (onPick) onPick(el);
  el.focus();
}

function update() {
  if (!input) return;
  items = [];
  span = null;
  // The most specific reading that finds anything wins.
  for (const candidate of fragmentsOf(input)) {
    const found = matches(candidate.text);
    if (found.length) {
      items = found;
      span = candidate;
      break;
    }
  }
  active = items.length ? 0 : -1;
  if (!items.length) close();
  else render();
}

/**
 * Wires one 행동 field.
 *
 * @param el the input
 * @param onChange called after a suggestion is inserted, so the row can read
 *   the new value back into its step
 * @returns a handler the caller runs on keydown *before* its own Enter
 *   handling, returning true when the key was spent on the popup
 */
function attach(el, onChange) {
  ensureBox();

  el.addEventListener('input', () => {
    input = el;
    onPick = onChange;
    update();
  });
  el.addEventListener('blur', close);
  el.addEventListener('click', () => {
    if (input === el) update();
  });

  return (e) => {
    /* While the IME is composing, Enter commits the syllable being typed — it
       is not a press aimed at this list. Acting on it replaced a half-finished
       word with a suggestion, and Korean is the only language this editor is
       written in, so it happened constantly. */
    if (e.isComposing) return true;
    if (!open() || input !== el) {
      // Escape with no popup is not ours to eat.
      return false;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
      return true;
    }
    /* Tab and Enter both accept, and an open popup always gets the key first.
       So a name typed out in full takes two presses: the first settles the
       popup, the second is the editor's "next row". One key doing two things
       depending on a list the eye has already stopped reading is worse than one
       extra press. */
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(active);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  };
}

window.suggest = { setTerms, attach, close };
