const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const directory = path.join(root, 'src/branding/assets');
const manifest = require('../src/branding/assets/manifest.json');
const generated = require('../src/branding/assets/generated.json');
const issues = [];
if (manifest.icon !== generated.source || manifest.imageRendering !== generated.imageRendering)
  issues.push('Regenerate native artwork after changing the source or rendering mode.');
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

for (const filename of [manifest.icon, ...manifest.frames, ...Object.keys(generated.exports)]) {
  if (path.basename(filename) !== filename || !fs.existsSync(path.join(directory, filename)))
    issues.push(`Missing or invalid branding asset: ${filename}`);
}
if (
  !manifest.frames.length ||
  manifest.frameMs < 16 ||
  !['auto', 'pixelated'].includes(manifest.imageRendering)
)
  issues.push('Invalid animation or rendering settings in assets/manifest.json.');
if (digest(path.join(directory, generated.source)) !== generated.sourceSha256)
  issues.push('app.svg changed: regenerate native exports with pnpm branding:assets:generate.');
for (const [filename, hash] of Object.entries(generated.exports)) {
  const file = path.join(directory, filename);
  if (fs.existsSync(file) && digest(file) !== hash)
    issues.push(`${filename} differs from generated.json; regenerate native artwork.`);
}
for (const group of [manifest.window, manifest.tray, manifest.trayUpdate]) {
  for (const filename of Object.values(group)) {
    if (!(filename in generated.exports)) issues.push(`Untracked native export: ${filename}`);
  }
}

const excluded = new Set(['node_modules', '.vite', 'out']);
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(item.name)) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) walk(file);
    else if (/\.(tsx?|mts|cjs|yml|html)$/.test(file) && file !== __filename) {
      const source = fs.readFileSync(file, 'utf8');
      if (
        /src\/images|['"]images['"]\s*,\s*['"]icon|(?:from\s+['"][^'"]*\/)(?:GooseLogo|FlyingBird|icons\/(?:Goose|Geese|Bird[1-6]))['"]/.test(
          source
        )
      )
        issues.push(`Obsolete application artwork reference: ${path.relative(root, file)}`);
    }
  }
}
walk(path.join(root, 'src'));
for (const file of ['forge.config.ts', 'electron-builder.nsis.yml']) {
  if (fs.readFileSync(path.join(root, file), 'utf8').includes('src/images'))
    issues.push(`Obsolete packaging artwork reference: ${file}`);
}
if (issues.length) {
  if (require.main !== module) throw new Error(issues.join('\n'));
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Branding artwork check passed: one asset folder, native exports, and animation frames.'
  );
