// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hasUnsavedText, isTextField } from '../src/content/formguardCore';

describe('formguardCore', () => {
  it('treats text inputs and textareas as fields, not buttons or checkboxes', () => {
    const make = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild!;
    };
    expect(isTextField(make('<input type="text">'))).toBe(true);
    expect(isTextField(make('<input>'))).toBe(true);
    expect(isTextField(make('<input type="email">'))).toBe(true);
    expect(isTextField(make('<textarea></textarea>'))).toBe(true);
    expect(isTextField(make('<input type="checkbox">'))).toBe(false);
    expect(isTextField(make('<input type="submit">'))).toBe(false);
    expect(isTextField(make('<div></div>'))).toBe(false);
  });

  it('is dirty only while a typed field holds non-blank text, and forgets removed fields', () => {
    document.body.innerHTML = '<textarea id="a"></textarea><input id="b">';
    const a = document.getElementById('a') as HTMLTextAreaElement;
    const b = document.getElementById('b') as HTMLInputElement;
    const typed = new Set<Element>([a, b]);
    expect(hasUnsavedText(typed)).toBe(false);
    a.value = '   ';
    expect(hasUnsavedText(typed)).toBe(false);
    b.value = 'draft';
    expect(hasUnsavedText(typed)).toBe(true);
    b.remove();
    expect(hasUnsavedText(typed)).toBe(false);
    expect(typed.has(b)).toBe(false);
  });
});
