# Background WhatsApp bill sending

This build integrates `whatsapp-web.js` + `qrcode` into Electron.

- `electron/main.cjs`: LocalAuth, headless Puppeteer, QR generation, IPC `send-bill-image`.
- `electron/preload.cjs`: exposes WhatsApp status/QR/send APIs safely through contextBridge.
- `src/lib/whatsapp-send.ts`: renders the complete bill to a PNG data URL and sends the raw base64 payload plus the configured message to the main process; the message is sent as the WhatsApp image caption.
- `src/components/whatsapp-qr-panel.tsx`: native in-app QR/status UI.
- `src/routes/_app.settings.tsx`: shows the QR connection panel in Settings → WhatsApp.
- `src/routes/_app.sales.tsx`: reserves a fixed action column so the Remove button stays visible.

The packaged app must install dependencies before building:

`npm install`

or use the repository's normal package-manager install step. Node 18+ is required by whatsapp-web.js.
