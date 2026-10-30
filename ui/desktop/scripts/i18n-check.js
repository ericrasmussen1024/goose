#!/usr/bin/env node
require('child_process').execFileSync(
  process.execPath,
  [require('path').join(__dirname, 'i18n-extract.js'), '--check'],
  { stdio: 'inherit' }
);
