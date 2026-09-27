const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'hidden', 'range', 'color', 'image']);

export function isTextField(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable === true;
}

function valueOf(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return el.textContent ?? '';
}

/** True when any field the user typed into still holds non-blank text. Forgets detached fields. */
export function hasUnsavedText(typed: Set<Element>): boolean {
  for (const el of typed) if (!el.isConnected) typed.delete(el);
  return [...typed].some(el => valueOf(el).trim().length > 0);
}
