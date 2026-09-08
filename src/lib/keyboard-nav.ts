import type { KeyboardEvent } from "react";

// Generic "Enter behaves like Tab" navigation for data-entry forms (Products,
// Purchases, etc). Wrap a form/section in `<div data-enter-nav onKeyDown={onEnterFocusNext}>`
// and pressing Enter inside any plain <input> in that section moves focus to
// the next focusable field instead of doing nothing / submitting the page.
//
// Deliberately only acts on <input> elements — Select/Combobox triggers,
// checkboxes and buttons keep their own native Enter behaviour (e.g. opening
// a dropdown), so this never fights with those components.
export function focusNextInSequence(
  current: HTMLElement,
  container: HTMLElement | null,
  direction: 1 | -1 = 1,
): boolean {
  if (!container) return false;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button, [tabindex]',
    ),
  ).filter((el) => {
    if ((el as HTMLInputElement).disabled) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("data-enter-skip")) return false;
    if (el.tabIndex === -1 && el !== current) return false;
    // Skip elements hidden via display:none / not in layout (offsetParent is
    // null for those), but keep the element currently focused either way.
    return el.offsetParent !== null || el === current;
  });
  const idx = focusables.indexOf(current);
  if (idx === -1) return false;
  const nextIdx = idx + direction;
  if (nextIdx < 0) return false;

  // At the end of a data-entry form, Enter should submit/save rather than
  // moving into a Cancel button. Forms can mark their primary action with
  // data-enter-submit.
  if (nextIdx >= focusables.length && direction === 1) {
    const submit = container.querySelector<HTMLElement>(
      '[data-enter-submit]:not([disabled])',
    );
    if (submit) {
      submit.click();
      return true;
    }
    return false;
  }

  const next = focusables[nextIdx];
  next.focus();
  if (next instanceof HTMLInputElement) next.select();
  return true;
}

export function onEnterFocusNext(e: KeyboardEvent<HTMLElement>) {
  const target = e.target as HTMLElement;
  // Only hijack plain text/number inputs — leave buttons, selects, textareas
  // (which need Enter/newline or their own activation) alone.
  if (target.tagName !== "INPUT") return;
  const input = target as HTMLInputElement;
  if (input.type === "checkbox" || input.type === "radio") return;

  if (e.key === "Enter") {
    const container = target.closest("[data-enter-nav]") as HTMLElement | null;
    const moved = focusNextInSequence(target, container, e.shiftKey ? -1 : 1);
    if (moved) e.preventDefault();
    return;
  }

  // Full arrow-key support: Up/Down always move to the previous/next field;
  // Left/Right move once the cursor is already at the start/end of the text
  // so normal in-field cursor movement still works.
  if (e.key === "ArrowDown") {
    const container = target.closest("[data-enter-nav]") as HTMLElement | null;
    if (focusNextInSequence(target, container, 1)) e.preventDefault();
    return;
  }
  if (e.key === "ArrowUp") {
    const container = target.closest("[data-enter-nav]") as HTMLElement | null;
    if (focusNextInSequence(target, container, -1)) e.preventDefault();
    return;
  }
  if (e.key === "ArrowLeft" && input.selectionStart === 0 && input.selectionEnd === 0) {
    const container = target.closest("[data-enter-nav]") as HTMLElement | null;
    if (focusNextInSequence(target, container, -1)) e.preventDefault();
    return;
  }
  if (
    e.key === "ArrowRight" &&
    input.selectionStart === input.value.length &&
    input.selectionEnd === input.value.length
  ) {
    const container = target.closest("[data-enter-nav]") as HTMLElement | null;
    if (focusNextInSequence(target, container, 1)) e.preventDefault();
    return;
  }
}
