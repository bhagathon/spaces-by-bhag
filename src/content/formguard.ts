/**
 * Runs on web pages only when "Protect unsaved form text" is on. Tells the
 * worker whether this page holds text the user typed and hasn't submitted, so
 * the suspender (and Chrome's own tab discarder) leaves the tab alone.
 */
import { isTextField, hasUnsavedText } from './formguardCore';

const typed = new Set<Element>();
let dirty = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;

function report(value: boolean) {
  chrome.runtime.sendMessage({ type: 'formDirty', dirty: value }).catch(() => {});
}

function evaluate() {
  const next = hasUnsavedText(typed);
  if (next !== dirty) {
    dirty = next;
    report(dirty);
  }
  // While dirty, re-check (fields cleared by script fire no input event) and re-assert
  // (the worker releases the guard when the tab starts a new page load).
  if (dirty && !heartbeat) {
    heartbeat = setInterval(() => {
      evaluate();
      if (dirty) report(true);
    }, 5000);
  } else if (!dirty && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
}

document.addEventListener(
  'input',
  e => {
    const target = e.composedPath()[0];
    if (!(target instanceof Element) || !isTextField(target)) return;
    typed.add(target);
    clearTimeout(debounce);
    debounce = setTimeout(evaluate, 400);
  },
  true,
);

document.addEventListener(
  'submit',
  () => {
    typed.clear();
    evaluate();
  },
  true,
);
