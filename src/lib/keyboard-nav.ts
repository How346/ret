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
    if (el.tabIndex === -1 && el !== current) return false;
    // Skip elements hidden via display:none / not in layout (offsetParent is
    // null for those), but keep the element currently focused either way.
    return el.offsetParent !== null || el === current;
  });
  const idx = focusables.indexOf(current);
  if (idx === -1) return false;
  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= focusables.length) return false;
  const next = focusables[nextIdx];
  next.focus();
  if (next instanceof HTMLInputElement) next.select();
  return true;
}

export function onEnterFocusNext(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter") return;
  const target = e.target as HTMLElement;
  // Only hijack plain text/number inputs — leave buttons, selects, textareas
  // (which need Enter/newline or their own activation) alone.
  if (target.tagName !== "INPUT") return;
  const input = target as HTMLInputElement;
  if (input.type === "checkbox" || input.type === "radio") return;
  const container = target.closest("[data-enter-nav]") as HTMLElement | null;
  const moved = focusNextInSequence(target, container, e.shiftKey ? -1 : 1);
  if (moved) e.preventDefault();
}
