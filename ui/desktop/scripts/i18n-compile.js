#!/usr/bin/env node
/**
 * Cross-platform i18n compile script.
 * Compiles all JSON message files in src/i18n/messages/ using formatjs.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { withBrandMessages } = require('./branding.cjs');
const { execFileSync } = require('child_process');

const projectDir = path.join(__dirname, '..');
const formatjs = require.resolve('@formatjs/cli/bin/formatjs');
const messagesDir = path.join(projectDir, 'src', 'i18n', 'messages');
const compiledDir = path.join(projectDir, 'src', 'i18n', 'compiled');

fs.mkdirSync(compiledDir, { recursive: true });

const files = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const locale = path.basename(file, '.json');
  const source = JSON.parse(fs.readFileSync(path.join(messagesDir, file), 'utf8'));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-locale-'));
  const inFile = path.join(temporary, file);
  fs.writeFileSync(inFile, JSON.stringify(withBrandMessages(locale, source)));
  const outFile = path.join(compiledDir, `${locale}.json`);
  try {
    execFileSync(process.execPath, [formatjs, 'compile', inFile, '--out-file', outFile], {
      stdio: 'inherit',
      cwd: projectDir,
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
