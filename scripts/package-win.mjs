import { packager } from '@electron/packager';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ignore = [
  /^\/node_modules($|\/)/,
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
  platform: 'win32',
  arch: 'x64',
  out: path.join(root, 'electron-release'),
  overwrite: true,
  prune: true,
  appVersion: '1.0.0',
  electronVersion: '44.1.1',
  ignore,
});

console.log('Packaged to:', paths.join(', '));
