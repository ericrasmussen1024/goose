#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { withBrandMessages } = require('./branding.cjs');

const projectDir = path.join(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-i18n-'));
const output = path.join(temporary, 'messages.json');
const enFile = path.join(projectDir, 'src/i18n/messages/en.json');
try {
  execFileSync(
    process.execPath,
    [
      require.resolve('@formatjs/cli/bin/formatjs'),
      'extract',
      'src/**/*.{ts,tsx}',
      '--ignore',
      '**/*.d.ts',
      '--out-file',
      output,
      '--flatten',
    ],
    { cwd: projectDir, stdio: 'inherit' }
  );
  const messages = withBrandMessages('en', JSON.parse(fs.readFileSync(output, 'utf8')));
  if (process.argv.includes('--check')) {
    if (JSON.stringify(JSON.parse(fs.readFileSync(enFile, 'utf8'))) !== JSON.stringify(messages)) {
      console.error('English messages are out of date. Run pnpm i18n:extract.');
      process.exitCode = 1;
    }
  } else {
    fs.writeFileSync(enFile, JSON.stringify(messages, null, 2) + '\n');
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
