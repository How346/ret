# Plan

This is a large request with three independent modules. I'll implement all three but flag scope trade-offs up-front.

## 1. Label Printer Settings (TSC TTP-244 Pro)

New route `/label-settings` (under `_app`) with:

- **Config form** (all fields you listed): paper W/H, label W/H, columns, H/V gap, L/T margin, density (0–15), speed (1–6 ips), sensor (Gap / Black Mark / Continuous), rotation (0/90/180/270), copies.
- **Defaults** exactly as specified (76×38 media, 25×38 label, 2 cols, gaps 2mm, density 10, speed 4, Gap sensor).
- **Live preview**: SVG rendering the 76mm roll with 2 labels per row, auto-centered, updates on any change.
- **Profiles**: saved in a new `printer_profiles` table (name, JSON config, is_default, user_id). Load / save / delete / set-default.
- **TSPL/TSPL2 generator** (`src/lib/tspl.ts`): outputs commands like `SIZE 25 mm, 38 mm`, `GAP 2 mm, 0 mm`, `DENSITY 10`, `SPEED 4`, `DIRECTION 1`, `REFERENCE`, `CLS`, `TEXT`, `BARCODE`, `QRCODE`, `PRINT n,1`. Supports barcode, QR, product name, SKU, price, batch.
- **Calibrate button** → outputs `GAP` + `SIZE` + `HOME` sequence (also standalone `GAPDETECT`).
- **Test Print button** → prints one sample label using current profile.
- **Multi-label-per-row printing**: existing browser-print grid path already handles 2 columns; wire the label settings profile into `printLabels()` so POS/Products use it.
- **Sending TSPL to the printer**: browsers can't talk to USB thermal printers directly. I'll add:
  - "Download .prn file" button (raw TSPL) — works everywhere, user drags to printer share.
  - Optional WebUSB path (Chromium) behind a feature flag — best-effort; TSC driver install still required for most setups.

## 2. Admin Panel + Licensing

New route `/admin` (admin-only, gated by `has_role`):

- **Users tab**: lists all users from `profiles` + `user_roles`, last sign-in, status. Actions: **Block/Unblock** (new `is_blocked` bool on `profiles`), change role.
- **Licenses tab**: admin generates license keys — new `licenses` table `(id, key, user_id, plan, issued_at, expires_at, status, notes)`. Key format `LMPOS-XXXX-XXXX-XXXX-XXXX` (crypto random). Actions: generate, revoke, extend, copy.
- **License enforcement (client)**:
  - On app load, query current user's active license.
  - If none or expired → full-screen modal "License expired — enter renewal key". Blocks app usage; only Settings → License and Sign Out reachable.
  - If blocked → sign-out + block modal.
- **Settings → License section**: shows current key (masked), plan, expiry, days remaining, "Enter new key" input that validates against `licenses` table and binds to user.

Server functions (all `createServerFn` with `requireSupabaseAuth` + admin check):
`listUsers`, `setUserBlocked`, `setUserRole`, `generateLicense`, `revokeLicense`, `extendLicense`, `redeemLicense`, `getMyLicense`.

RLS: `licenses` — user reads own row; admin reads all. `profiles.is_blocked` — user reads own; admin writes.

## 3. POS Shortcuts (Marg-style)

In `/pos`:

- Global keyboard shortcuts (documented in a "?" popover):
  - `F1` focus barcode/search
  - `F2` new customer
  - `F3` add discount
  - `F4` payment mode
  - `F5` hold bill
  - `F6` recall held bills
  - `F8` reprint last
  - `F9` open cash drawer
  - `Enter` in barcode → add item; empty Enter → jump to payment
  - `+` / `-` in row → qty ±1
  - `*qty` prefix in barcode box → sets qty for next scan (e.g. `3*` then scan)
  - `Esc` clear current line
  - `Ctrl+Enter` finalize & print
  - `Ctrl+D` delete selected row
- Keep existing mouse flow intact.

## Technical section

- Migrations: `printer_profiles`, `licenses`, add `profiles.is_blocked`. All with GRANTs + RLS + `has_role`-based admin policies.
- `licenses.key` unique, indexed. `expires_at` timestamptz. Status enum: active / revoked / expired (computed via view or client).
- License gate lives in `_app.tsx` layout so it wraps every authenticated route.
- TSPL generator is pure TS, unit-testable.
- Preview uses SVG in mm units with `viewBox`.

## Out of scope / caveats

- **Direct raw printing to TSC over USB from browser is unreliable.** I'll ship `.prn` download + WebUSB attempt; a small Electron/Tauri helper is the only fully-reliable path and is a separate build.
- License keys are **soft enforcement** (client + RLS). A determined user with DB access could bypass; true DRM needs a signed-token server check on every request, which I can add later if you want.
- No email delivery of license keys — admin copies & shares manually. Say the word to add resend/email.

Shall I proceed with all three modules in one pass?
