import { useEffect } from 'react';

/**
 * When the browser refuses to send a form (a required field is empty, an email doesn't look like one,
 * a password is too short…) phones – iPhones especially – often show nothing at all: the screen just
 * jumps. This turns every such refusal, in every form, into a plain message naming the field.
 */

/** The field's name from its label: "Password (at least 8 characters)" → "Password". */
function fieldName(el: HTMLInputElement): string {
  const label = el.closest('label');
  let text = el.getAttribute('aria-label') ?? '';
  if (label) {
    const copy = label.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('input, select, textarea, button, [role=button]').forEach((n) => n.remove());
    text = copy.textContent ?? '';
  }
  text = text.split(/\s[–—-]\s|\(/)[0].replace(/\s+/g, ' ').trim();
  return text || el.placeholder || 'this field';
}

export function problemWith(el: HTMLInputElement): string {
  const v = el.validity;
  const name = fieldName(el);
  const value = el.value ?? '';
  if (v.valueMissing) return el.type === 'checkbox' || el.type === 'radio' ? `Choose ${name.toLowerCase()}.` : `Fill in “${name}”.`;
  if (v.typeMismatch && el.type === 'email') return `“${value.trim()}” isn’t a complete email address. It should look like name@gmail.com.`;
  if (v.typeMismatch) return `“${name}” isn’t in the right format.`;
  if (v.tooShort) return `${name} needs at least ${el.minLength} characters – you entered ${value.length}.`;
  if (v.tooLong) return `${name} can be at most ${el.maxLength} characters.`;
  if (v.rangeUnderflow) return `${name} must be at least ${el.min}.`;
  if (v.rangeOverflow) return `${name} can be at most ${el.max}.`;
  if (v.badInput) return `“${name}” isn’t a valid ${el.type === 'date' ? 'date' : 'number'}.`;
  if (v.patternMismatch) return el.title ? `${name}: ${el.title}` : `“${name}” isn’t in the right format.`;
  return `${name}: ${el.validationMessage}`;
}

export function useFriendlyFormChecks(toast: (text: string, error?: boolean) => void) {
  useEffect(() => {
    let shownAt = 0;
    const onInvalid = (e: Event) => {
      const el = e.target as HTMLInputElement;
      e.preventDefault(); // our message replaces the browser's (often invisible) bubble
      el.classList.add('field-invalid');
      el.addEventListener('input', () => el.classList.remove('field-invalid'), { once: true });
      // One submit can flag several fields; speak about the first one only.
      if (Date.now() - shownAt < 300) return;
      shownAt = Date.now();
      toast(problemWith(el), true);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    };
    document.addEventListener('invalid', onInvalid, true);
    return () => document.removeEventListener('invalid', onInvalid, true);
  }, [toast]);
}
