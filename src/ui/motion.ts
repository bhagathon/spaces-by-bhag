/**
 * Animations, off by default: every transition and animation in the panel and dashboard
 * is extra work for the browser at the moments it's busiest (a new tab, a Space switch).
 * Off means the UI changes instantly, the same way it does under Reduce Motion.
 */

const KEY = 'animations';
/** A synchronous copy, so a page opens already still instead of animating once. */
const CACHE = 'spaces.animations';

function apply(on: boolean) {
  document.documentElement.dataset.motion = on ? 'on' : 'off';
  try {
    localStorage.setItem(CACHE, on ? '1' : '0');
  } catch {
    // storage can be unavailable; the setting still applies for this session
  }
}

export async function getAnimations(): Promise<boolean> {
  return (await chrome.storage.local.get(KEY))[KEY] === true;
}

export function setAnimations(on: boolean) {
  return chrome.storage.local.set({ [KEY]: on });
}

/** Whether to animate right now: the setting is on and the system doesn't ask for reduced motion. */
export function motionOn() {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !reduce && typeof document !== 'undefined' && document.documentElement.dataset.motion === 'on';
}

/** Call once before the page renders. */
export function initMotion() {
  let cached = false;
  try {
    cached = localStorage.getItem(CACHE) === '1';
  } catch {}
  apply(cached);
  void getAnimations().then(apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) apply(changes[KEY].newValue === true);
  });
}
