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

function canonicalPayload(payload) {
  // Generator and verifier both use this exact field order.
  const clean = {
    v: Number(payload.v || 1),
    product: String(payload.product || ''),
    licenseId: String(payload.licenseId || ''),
    hwid: String(payload.hwid || ''),
    plan: String(payload.plan || 'standard'),
    issuedAt: String(payload.issuedAt || ''),
    expiresAt: String(payload.expiresAt || ''),
    features: Array.isArray(payload.features) ? payload.features.map(String) : [],
  };
  return JSON.stringify(clean);
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

function verifyLicenseText(text, expectedHWID = getHWID()) {
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
  );
  if (!verified) throw new Error('License signature is invalid');

  const now = Date.now();
  if (expires <= now) throw new Error('License has expired');
  if (issued > now + 5 * 60 * 1000) throw new Error('License issue date is in the future');

  return {
    valid: true,
    payload,
    daysLeft: Math.max(0, Math.ceil((expires - now) / 86400000)),
  };
}

function readStoredLicense(app) {
  const file = licensePath(app);
  if (!fs.existsSync(file)) return { valid: false, reason: 'none' };
  try {
    const text = fs.readFileSync(file, 'utf8');
    const result = verifyLicenseText(text);
    return { ...result, fileName: FILE_NAME };
  } catch (error) {
    return { valid: false, reason: error?.message || 'Invalid license', fileName: FILE_NAME };
  }
}

function installLicense(app, text) {
  const result = verifyLicenseText(text);
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
  installLicense,
  removeLicense,
  licensePath,
};
