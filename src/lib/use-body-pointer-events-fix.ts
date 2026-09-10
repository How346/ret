import { useEffect } from "react";

// Known issue class in Radix UI (Dialog/AlertDialog, used by shadcn/ui):
// when a dialog closes in the same tick as something that removes its
// trigger element from the DOM — e.g. confirming "Delete product" and the
// row for that product disappearing on the next render — Radix's own
// cleanup that restores `document.body.style.pointerEvents` can be skipped.
// The whole page then silently stops accepting clicks/typing because the
// body itself has `pointer-events: none`, even though nothing looks wrong
// visually. This shows up as "I deleted something and now I can't type in
// any box."
//
// This is a defensive safety net, not a real fix for Radix's internals: it
// periodically checks whether any dialog/overlay is actually still open,
// and if not, clears a stuck `pointer-events: none` off <body>.
export function useBodyPointerEventsFix() {
  useEffect(() => {
    const clearIfStuck = () => {
      if (document.body.style.pointerEvents !== "none") return;
      const anyOpenOverlay = document.querySelector(
        '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-radix-popper-content-wrapper]',
      );
      if (!anyOpenOverlay) document.body.style.pointerEvents = "";
    };

    const observer = new MutationObserver(clearIfStuck);
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    // Cheap periodic safety net in case a mutation is missed entirely.
    const interval = window.setInterval(clearIfStuck, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);
}
