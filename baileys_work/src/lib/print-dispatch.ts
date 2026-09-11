// Sends a rendered HTML document to a printer.
//
// - Web / browser build: unchanged behaviour — opens a popup window and
//   calls window.print(), which lets the browser's own print dialog handle
//   printer selection.
// - Electron/offline desktop build: the popup approach never worked because
//   the app denies all window.open() calls (see electron/main.cjs), so
//   nothing happened. Here we instead hand the HTML to the main process over
//   IPC, which opens a native OS print dialog (letting the user pick a
//   printer) or, if a printer has been saved in Settings and "silent
//   printing" is on, prints straight to that printer with no dialog.

import { isDesktopPrintingAvailable, getPrinterPrefs } from "@/lib/printer-prefs";

export type DispatchPrintKind = "receipt" | "label";

export function dispatchPrintHtml(
  html: string,
  opts: { kind: DispatchPrintKind; windowWidth?: number; windowHeight?: number } = { kind: "receipt" },
) {
  if (isDesktopPrintingAvailable()) {
    const prefs = getPrinterPrefs();
    const deviceName = (opts.kind === "label" ? prefs.labelPrinter : prefs.receiptPrinter) || undefined;
    window
      .electronAPI!.printHTML(html, {
        deviceName,
        // Only skip the printer-selection dialog if the user both picked a
        // specific printer AND turned on silent printing — otherwise always
        // show the native dialog so they can choose a printer.
        silent: !!deviceName && !!prefs.silent,
        copies: 1,
      })
      .catch(() => {
        /* ignore — Electron already surfaces a native error dialog on failure */
      });
    return;
  }

  const w = window.open("", "_blank", `width=${opts.windowWidth ?? 380},height=${opts.windowHeight ?? 720}`);
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      /* ignore */
    }
  }, 350);
}
