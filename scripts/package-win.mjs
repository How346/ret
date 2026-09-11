import { packager } from '@electron/packager';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { obfuscateElectronMainProcess, obfuscateRendererBundle } from './obfuscate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(
  readFileSync(require.resolve('electron/package.json'), 'utf8'),
).version;

// Ensure runtime dependencies are actually present before Electron Packager copies the app.
// This is important when the project was installed with Bun: a later npm-prune step can
// otherwise leave whatsapp-web.js out of the packaged application.
for (const dep of ['whatsapp-web.js', 'qrcode']) {
  try { require.resolve(dep, { paths: [root] }); }
  catch {
    console.log(`Installing missing runtime dependency: ${dep}`);
    try { execFileSync('bun', ['install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit' }); }
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
  // Obfuscate the shipped source right after Packager stages a copy of the
  // app, so `bun run dev` / a plain `vite build` are completely unaffected
  // and only what actually goes out the door is protected.
  // Note: modern @electron/packager hooks are promise-based (no callback
  // argument) — throwing/rejecting here fails the whole packaging step.
  afterCopy: [
    async (buildPath) => {
      console.log('Obfuscating shipped source before finalizing the package…');
      await obfuscateElectronMainProcess(buildPath);
      await obfuscateRendererBundle(buildPath);
    },
  ],
});

console.log('Packaged to:', paths.join(', '));
