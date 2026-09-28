/**
 * Panel text size. One --scale multiplies the type scale and the ruling pitch in
 * app.css, so typed entries stay on their ruled lines at every size. Panel only:
 * the dashboard is a normal tab, where Chrome's own ⌘+/⌘− zoom already works.
 */

export const TEXT_SCALES = [
  { value: 0.9, label: 'Small' },
  { value: 1, label: 'Default' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'Larger' },
] as const;

export type TextScale = (typeof TEXT_SCALES)[number]['value'];

const KEY = 'textScale';
/** A synchronous copy, so the panel opens at the right size instead of flashing the default. */
const CACHE = 'spaces.textScale';

export function normalizeScale(v: unknown): TextScale {
  return TEXT_SCALES.find(s => s.value === v)?.value ?? 1;
}

/** direction 0 resets to 100%. */
export function stepScale(current: number, direction: -1 | 0 | 1): TextScale {
  if (direction === 0) return 1;
  const i = TEXT_SCALES.findIndex(s => s.value === normalizeScale(current));
  return TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, i + direction))].value;
}

function apply(v: TextScale) {
  document.documentElement.style.setProperty('--scale', String(v));
  try {
    localStorage.setItem(CACHE, String(v));
  } catch {
    // storage can be unavailable; the size still applies for this session
  }
}

export async function getTextScale(): Promise<TextScale> {
  return normalizeScale((await chrome.storage.local.get(KEY))[KEY]);
}

export function setTextScale(v: TextScale) {
  return chrome.storage.local.set({ [KEY]: v });
}

/** Call once before the panel renders. */
export function initTextScale() {
  try {
    const cached = Number(localStorage.getItem(CACHE));
    if (cached) apply(normalizeScale(cached));
  } catch {
    // fall through to the stored value
  }
  void getTextScale().then(apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) apply(normalizeScale(changes[KEY].newValue));
  });
}
