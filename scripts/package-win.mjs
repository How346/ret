import { packager } from '@electron/packager';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(
  readFileSync(require.resolve('electron/package.json'), 'utf8'),
).version;

// Ensure the Baileys runtime dependencies are installed before Electron Packager copies the app.
for (const dep of ['@whiskeysockets/baileys', 'pino', 'qrcode']) {
  try { require.resolve(dep, { paths: [root] }); }
  catch {
    console.log(`Installing missing runtime dependency: ${dep}`);
    try { execFileSync('bun', ['install'], { cwd: root, stdio: 'inherit' }); }
    catch { execFileSync('npm', ['install'], { cwd: root, stdio: 'inherit' }); }
    require.resolve(dep, { paths: [root] });
  }
}

const ignore = [
  /^\/src($|\/)/,
  /^\/public($|\/)/,
  /^\/supabase($|\/)/,
  /^\/scripts($|\/)/,
  /^\/electron-release($|\/)/,
  /^\/dist($|\/)/,
  /^\/\.github($|\/)/,
  /^\/\.git($|\/)/,
];

const paths = await packager({
  dir: root,
  name: 'Margin ERP Offline',
  appVersion: pkg.version || '1.0.0',
  buildVersion: pkg.version || '1.0.0',
  electronVersion,
  platform: 'win32',
  arch: 'x64',
  out: path.join(root, 'electron-release'),
  overwrite: true,
  prune: false,
  ignore,
});

console.log('Packaged to:', paths.join(', '));
