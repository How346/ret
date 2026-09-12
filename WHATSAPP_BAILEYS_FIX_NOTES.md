# Margin ERP — Baileys WhatsApp Fix

This build fixes the WhatsApp error:
`Cannot read properties of null (reading 'message')`

## Changes
- Uses Baileys 6.7.24 without Chromium/Puppeteer.
- Fetches the current WhatsApp Web client revision with `fetchLatestWaWebVersion()` when online, with an 8-second timeout and offline fallback.
- Normalizes Baileys/Boom/null errors before they reach the POS UI.
- Protects the asynchronous `connection.update` handler from unhandled exceptions.
- Treats a stale socket between the ready check and image upload as recoverable and reconnects once before retrying the same in-memory image.
- Renders the receipt with Electron Chromium (not html2canvas) and sends the resulting clean PNG together with the configured message as one WhatsApp image caption.
- Adds Settings → WhatsApp → Reset & reconnect for a corrupted/old Baileys session.
- Keeps the bill image entirely in memory.

## First run after this update
1. Run `bun install`.
2. Build a completely fresh Windows package with `bun run package:win`.
3. Open Settings → WhatsApp.
4. If an old session is reported as invalid, press **Reset & reconnect** and scan the new QR.
5. Send a test bill.

Do not copy the old `whatsapp-baileys-auth` folder into a new installation.
