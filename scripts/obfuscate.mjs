import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Protects the shipped source from being casually opened and read.
//
// Two things get obfuscated as part of packaging (never during normal
// `bun run dev` / `build:offline`, so debugging stays easy day-to-day):
//   1. electron/main.cjs, preload.cjs, license.cjs — these are plain,
//      completely readable CommonJS files that @electron/packager would
//      otherwise copy into the shipped app byte-for-byte.
//   2. The built renderer bundle under dist-electron/assets/*.js — Vite's
//      production build already minifies this, but minification just
//      shortens names; it doesn't hide control flow or string literals the
//      way obfuscation does.
//
// Honest caveat (worth keeping in mind, not just for the person reading
// this file): JavaScript that runs on someone else's machine can never be
// made truly unreadable — it has to be interpretable at runtime. This
// raises the bar a lot for casual inspection/copying, but a determined
// reverse engineer can still work through obfuscated code. Also, aggressive
// obfuscation makes any future crash stack trace far harder to act on, so
// this deliberately avoids the most extreme settings (e.g. debugProtection)
// that are more likely to cause hard-to-diagnose runtime issues than to add
// meaningful extra protection.
export async function obfuscateFile(filePath, overrides = {}) {
  const { default: JavaScriptObfuscator } = await import("javascript-obfuscator");
  const code = readFileSync(filePath, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.3,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: "hexadecimal",
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayEncoding: ["rc4"],
    stringArrayThreshold: 0.85,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    ...overrides,
  }).getObfuscatedCode();
  writeFileSync(filePath, result, "utf8");
}

function walkJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkJsFiles(full, out);
    else if (/\.m?js$/.test(entry)) out.push(full);
  }
  return out;
}

// Obfuscates electron/main.cjs, preload.cjs and license.cjs inside the
// already-copied packaged app at `buildPath`.
export async function obfuscateElectronMainProcess(buildPath) {
  const electronDir = path.join(buildPath, "electron");
  for (const name of ["main.cjs", "preload.cjs", "license.cjs"]) {
    const file = path.join(electronDir, name);
    try {
      await obfuscateFile(file);
      console.log(`Obfuscated electron/${name}`);
    } catch (err) {
      console.warn(`Could not obfuscate electron/${name}:`, err?.message || err);
    }
  }
}

// Obfuscates every built renderer .js file inside the packaged app's
// dist-electron folder.
export async function obfuscateRendererBundle(buildPath) {
  const distDir = path.join(buildPath, "dist-electron");
  let files = [];
  try {
    files = walkJsFiles(distDir);
  } catch {
    return;
  }
  for (const file of files) {
    try {
      // The renderer bundle is much larger than the main-process files, so
      // dead-code injection is skipped here to keep app startup time and
      // package size reasonable — the other protections still apply.
      await obfuscateFile(file, { deadCodeInjection: false });
      console.log(`Obfuscated ${path.relative(buildPath, file)}`);
    } catch (err) {
      console.warn(`Could not obfuscate ${path.relative(buildPath, file)}:`, err?.message || err);
    }
  }
}
