const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

// Public verification key supplied by the product owner.
// This key is safe to ship with the application. NEVER put the private key here.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA6f1rsEY8pjbDseIWBbWCUFeoUYHRUqSp4scW+bdcYio=\n-----END PUBLIC KEY-----`;

const PRODUCT_ID = 'quick-retail-nexus';
const FILE_NAME = 'licence.lic';
const CLOCK_STATE_FILE = 'clock-state.json';
const CLOCK_BACKUP_FILE = 'clock-state.bak';
const CLOCK_ROLLBACK_TOLERANCE_MS = 2 * 60 * 1000;
const CLOCK_REG_PATH = 'HKCU\\Software\\MarginERP\\QuickRetailNexus';
const CLOCK_REG_VALUE = 'LastSeenUtcMs';
const TIME_SYNC_URL = process.env.LICENSE_TIME_URL || 'https://tllxvwwfvvbtdatnqhit.supabase.co/rest/v1/';
const SERVER_TIME_TIMEOUT_MS = 2500;
const TRUSTED_TIME_CACHE_MS = 15000;
let trustedTimeCache = null;

function machineGuid() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
      ], { windowsHide: true, encoding: 'utf8', timeout: 3000 });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      if (m && m[1]) return m[1].trim();
    } catch {}
  }
  return [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()?.[0]?.model || '',
  ].join('|');
}

function getHWID() {
  return crypto.createHash('sha256')
    .update(`${PRODUCT_ID}|${machineGuid()}`, 'utf8')
    .digest('hex')
    .toUpperCase()
    .match(/.{1,8}/g)
    .join('-');
}

function licensePath(app) {
  return path.join(app.getPath('userData'), 'license', FILE_NAME);
}

function clockStatePaths(app) {
  const dir = path.join(app.getPath('userData'), 'license');
  return {
    dir,
    primary: path.join(dir, CLOCK_STATE_FILE),
    backup: path.join(dir, CLOCK_BACKUP_FILE),
  };
}

function readClockFile(file) {
  try {
    if (!fs.existsSync(file)) return 0;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const value = Number(parsed?.lastSeenUtcMs);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function readWindowsClockCheckpoint() {
  if (process.platform !== 'win32') return 0;
  try {
    const out = execFileSync('reg', [
      'query', CLOCK_REG_PATH, '/v', CLOCK_REG_VALUE,
    ], { windowsHide: true, encoding: 'utf8', timeout: 3000 });
    const m = out.match(new RegExp(CLOCK_REG_VALUE + '\\s+REG_QWORD\\s+(?:0x)?([0-9A-Fa-f]+)', 'i'));
    if (!m) return 0;
    const value = parseInt(m[1], 16);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeClockCheckpoint(app, value) {
  try {
    const { dir, primary, backup } = clockStatePaths(app);
    fs.mkdirSync(dir, { recursive: true });
    const body = JSON.stringify({ version: 1, lastSeenUtcMs: Math.floor(value) });
    // Keep two local copies. The registry copy below adds another independent
    // checkpoint on Windows, making an accidental clock rollback much harder
    // to bypass by changing/deleting one normal app file.
    fs.writeFileSync(primary, body + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(backup, body + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    // A read-only profile should not make an otherwise valid license unusable.
  }

  if (process.platform === 'win32') {
    try {
      execFileSync('reg', [
        'add', CLOCK_REG_PATH, '/v', CLOCK_REG_VALUE,
        '/t', 'REG_QWORD', '/d', `0x${Math.floor(value).toString(16)}`, '/f',
      ], { windowsHide: true, encoding: 'utf8', timeout: 3000, stdio: 'ignore' });
    } catch {
      // Registry writes can fail under locked-down Windows profiles.
    }
  }
}

async function getTrustedNowMs(app) {
  const localNow = Date.now();
  if (trustedTimeCache && localNow - trustedTimeCache.fetchedAt < TRUSTED_TIME_CACHE_MS) {
    return { ...trustedTimeCache, nowMs: trustedTimeCache.nowMs + (localNow - trustedTimeCache.fetchedAt) };
  }

  // Primary Indian Standard Time source: CSIR-NPL public NTP service.
  // time.nplindia.org is maintained by India's national time authority and
  // provides IST/UTC(NPLI) through NTP. Keep several independent fallbacks.
  const ntpServers = process.platform === 'win32'
    ? ['time.nplindia.org', 'time.nplindia.in', 'time.windows.com', 'time.cloudflare.com']
    : [];

  if (process.platform === 'win32') {
    for (const server of ntpServers) {
      try {
        const out = execFileSync('w32tm', [
          '/stripchart',
          `/computer:${server}`,
          '/dataonly',
          '/samples:1',
        ], { windowsHide: true, encoding: 'utf8', timeout: 7000 });

        // Windows output varies by locale/version. Do not require the offset
        // to be at the absolute end of the line.
        const matches = String(out).match(/([+-]\d+(?:\.\d+)?)s\b/g);
        if (matches?.length) {
          const offsetSeconds = Number.parseFloat(matches[matches.length - 1].slice(0, -1));
          if (Number.isFinite(offsetSeconds) && Math.abs(offsetSeconds) < 7 * 86400) {
            const trustedNow = localNow + Math.round(offsetSeconds * 1000);
            const result = { nowMs: trustedNow, source: server.startsWith('time.nplindia') ? 'npl-india-ntp' : 'ntp-fallback', serverDate: new Date(trustedNow).toISOString() };
            trustedTimeCache = { ...result, fetchedAt: localNow };
            return result;
          }
        }
      } catch {
        // Try the next independent NTP source.
      }
    }
  }

  // HTTPS Date headers are a second layer. They do not depend on the PC's
  // clock. NPL's web clock is preferred, then independent major providers.
  const timeUrls = [
    'https://www.nplindia.org/clockcode/html/',
    'https://www.microsoft.com/',
    'https://www.cloudflare.com/',
    TIME_SYNC_URL,
  ];
  for (const url of timeUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SERVER_TIME_TIMEOUT_MS);
      const started = Date.now();
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        signal: controller.signal,
      });
      // Consume the body so Electron/node completes the request cleanly.
      try { await response.arrayBuffer(); } catch {}
      clearTimeout(timer);
      const finished = Date.now();
      const serverDate = response.headers.get('date');
      const parsed = serverDate ? Date.parse(serverDate) : NaN;
      if (Number.isFinite(parsed)) {
        const trustedNow = parsed + Math.max(0, Math.floor((finished - started) / 2));
        const result = { nowMs: trustedNow, source: url.includes('nplindia.org') ? 'npl-india-web' : 'server', serverDate: new Date(trustedNow).toISOString() };
        trustedTimeCache = { ...result, fetchedAt: localNow };
        return result;
      }
    } catch {
      // Try the next independent time source.
    }
  }

  return { nowMs: localNow, source: 'local-offline' };
}

function enforceMonotonicClock(app, nowMs) {
  if (!app) return;

  const { primary, backup } = clockStatePaths(app);
  const stored = Math.max(
    readClockFile(primary),
    readClockFile(backup),
    readWindowsClockCheckpoint(),
  );

  // A normal timezone change does not alter Date.now(). A real rollback of
  // the computer clock does. Once the app has observed a later UTC timestamp,
  // going materially backwards cannot be used to extend a license.
  if (stored > 0 && nowMs + CLOCK_ROLLBACK_TOLERANCE_MS < stored) {
    const deltaHours = Math.max(1, Math.round((stored - nowMs) / 3600000));
    throw new Error(`System clock moved backwards by about ${deltaHours} hour(s); license time protection is active`);
  }

  if (nowMs > stored) writeClockCheckpoint(app, nowMs);
}

function canonicalPayload(payload) {
  // Generator and verifier both use this exact field order.
  const clean = {
    v: Number(payload.v || 1),
    product: String(payload.product || ''),
    licenseId: String(payload.licenseId || ''),
    hwid: String(payload.hwid || ''),
    plan: String(payload.plan || 'standard'),
    registeredTo: String(payload.registeredTo || ''),
    issuedAt: String(payload.issuedAt || ''),
    expiresAt: String(payload.expiresAt || ''),
    features: Array.isArray(payload.features) ? payload.features.map(String) : [],
  };
  return JSON.stringify(clean);
}

function canonicalPayloadLegacy(payload) {
  // Compatibility with licenses generated before the Registered-to field was added.
  return JSON.stringify({
    v: Number(payload.v || 1),
    product: String(payload.product || ''),
    licenseId: String(payload.licenseId || ''),
    hwid: String(payload.hwid || ''),
    plan: String(payload.plan || 'standard'),
    issuedAt: String(payload.issuedAt || ''),
    expiresAt: String(payload.expiresAt || ''),
    features: Array.isArray(payload.features) ? payload.features.map(String) : [],
  });
}

function decodeBase64Url(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function encodeBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseLicenseText(text) {
  const raw = String(text || '').trim();
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== 'QRN-LIC-V1') {
    throw new Error('Unsupported license file format');
  }
  const body = lines.slice(1).join('').trim();
  const parts = body.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid license file');
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'));
  } catch {
    throw new Error('License payload is corrupted');
  }
  return { payload, payloadB64: parts[0], signatureB64: parts[1] };
}

function verifyLicenseText(text, expectedHWID = getHWID(), app = null, nowOverrideMs = null, timeSource = 'local-offline') {
  const parsed = parseLicenseText(text);
  const { payload, signatureB64 } = parsed;

  if (payload.product !== PRODUCT_ID) throw new Error('This license belongs to another product');
  if (payload.hwid !== expectedHWID) throw new Error('HWID does not match this computer');
  if (!payload.licenseId) throw new Error('License ID is missing');
  if (!payload.issuedAt || !payload.expiresAt) throw new Error('License dates are missing');

  const issued = Date.parse(payload.issuedAt);
  const expires = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) throw new Error('Invalid license dates');
  if (expires <= issued) throw new Error('License expiry is invalid');

  const signature = decodeBase64Url(signatureB64);
  const verified = crypto.verify(
    null,
    Buffer.from(canonicalPayload(payload), 'utf8'),
    PUBLIC_KEY_PEM,
    signature,
  ) || crypto.verify(
    null,
    Buffer.from(canonicalPayloadLegacy(payload), 'utf8'),
    PUBLIC_KEY_PEM,
    signature,
  );
  if (!verified) throw new Error('License signature is invalid');

  const now = Number.isFinite(nowOverrideMs) ? nowOverrideMs : Date.now();
  // Enforce a persistent high-water mark before evaluating expiry. If an old
  // test/build left a checkpoint beyond this license's own expiry, it cannot
  // represent a legitimate observation for this license, so safely discard
  // that stale checkpoint and start a fresh high-water mark. This avoids a
  // false rollback error after the PC clock has been corrected.
  if (app) {
    // A trusted network/NPL time source is authoritative. If the user moved
    // the PC clock into the future and then corrected it, the trusted server
    // time must win instead of comparing against the stale future checkpoint.
    // High-water rollback protection is only needed while genuinely offline.
    if (timeSource === 'local-offline') {
      enforceMonotonicClock(app, now);
    } else {
      writeClockCheckpoint(app, now);
    }
  }
  if (expires <= now) throw new Error('License has expired');
  if (issued > now + 5 * 60 * 1000) throw new Error('License issue date is in the future');

  return {
    valid: true,
    payload,
    daysLeft: Math.max(0, Math.ceil((expires - now) / 86400000)),
  };
}

async function verifyLicenseWithTrustedTime(text, expectedHWID = getHWID(), app = null) {
  const trusted = await getTrustedNowMs(app);
  const result = verifyLicenseText(text, expectedHWID, app, trusted.nowMs, trusted.source);
  return { ...result, timeSource: trusted.source, serverDate: trusted.serverDate || null };
}

async function readStoredLicenseAsync(app) {
  const file = licensePath(app);
  if (!fs.existsSync(file)) return { valid: false, reason: 'none' };
  try {
    const text = fs.readFileSync(file, 'utf8');
    const result = await verifyLicenseWithTrustedTime(text, getHWID(), app);
    return { ...result, fileName: FILE_NAME };
  } catch (error) {
    return { valid: false, reason: error?.message || 'Invalid license', fileName: FILE_NAME };
  }
}

async function installLicenseAsync(app, text) {
  const result = await verifyLicenseWithTrustedTime(text, getHWID(), app);
  const dir = path.dirname(licensePath(app));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${licensePath(app)}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, String(text).trim() + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, licensePath(app));
  return { ...result, fileName: FILE_NAME };
}

function readStoredLicense(app) {
  const file = licensePath(app);
  if (!fs.existsSync(file)) return { valid: false, reason: 'none' };
  try {
    const text = fs.readFileSync(file, 'utf8');
    const result = verifyLicenseText(text, getHWID(), app);
    return { ...result, fileName: FILE_NAME };
  } catch (error) {
    return { valid: false, reason: error?.message || 'Invalid license', fileName: FILE_NAME };
  }
}

function installLicense(app, text) {
  const result = verifyLicenseText(text, getHWID(), app);
  const dir = path.dirname(licensePath(app));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${licensePath(app)}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, String(text).trim() + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, licensePath(app));
  return { ...result, fileName: FILE_NAME };
}

function removeLicense(app) {
  const file = licensePath(app);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  return { valid: false, reason: 'none' };
}

module.exports = {
  PUBLIC_KEY_PEM,
  PRODUCT_ID,
  getHWID,
  verifyLicenseText,
  readStoredLicense,
  readStoredLicenseAsync,
  installLicense,
  installLicenseAsync,
  removeLicense,
  licensePath,
};
