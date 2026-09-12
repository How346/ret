# Background WhatsApp — Baileys

This build uses `@whiskeysockets/baileys` instead of `whatsapp-web.js`. Baileys connects over WebSockets and does not launch Chromium/Puppeteer, which substantially reduces the background browser overhead.

## Install

```bash
bun install
```

The project pins Baileys to `6.7.24` rather than the newer 7.x release candidates because 7.x introduces breaking API changes. The app also uses `pino` for a silent production logger and `qrcode` for the Settings QR display.

## Authentication

The first connection shows a QR code in **Settings → WhatsApp**. Scan it from WhatsApp → Linked devices. Baileys persists its credentials and Signal keys under Electron's userData directory: `whatsapp-baileys-auth`. The auth folder contains long-lived credentials and must never be committed to source control.

## Sending bills

The POS sends the complete invoice HTML to Electron Chromium, which renders and captures a clean PNG in memory; that PNG is then sent as one WhatsApp image message. The Settings message template is sent as the image caption, so there is no separate race between an image and text message. No bill image is saved to disk by the Baileys send path.

## Performance

- No Chromium/Puppeteer process.
- No WhatsApp Web page rendering.
- `makeCacheableSignalKeyStore` reduces repeated Signal-key disk I/O.
- Full history sync is disabled because the ERP only needs outbound bill sharing.
- `markOnlineOnConnect: false` avoids unnecessarily changing the account's online state.
- Automatic reconnect uses a bounded backoff.

## Important

Baileys is an unofficial WhatsApp Web API. Use it responsibly and comply with WhatsApp's terms; do not use the integration for spam or bulk messaging.
