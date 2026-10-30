const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { config, Name, text } = require('./branding.cjs');
const root = path.join(__dirname, '..');
const word = /(?<![A-Za-z0-9_./@:-])goose(?![A-Za-z0-9_/@]|\.[A-Za-z0-9]|:\/\/)/i;
const known = new Set(
  (config.technicalReferences || []).map((item) => item.file + '\n' + item.value)
);
const issues = [];
function scan(file) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  function visit(node) {
    if (ts.isTemplateExpression(node)) {
      const value = node.getText(source);
      if (word.test(value) && !known.has(file + '\n' + value)) issues.push(file + ': ' + value);
      return;
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node)
    ) {
      if (word.test(node.text) && !known.has(file + '\n' + node.text))
        issues.push(file + ': ' + node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
function walk(directory) {
  for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = directory + '/' + item.name;
    if (item.isDirectory()) {
      if (!['test', '__tests__', 'i18n', 'node_modules'].includes(item.name)) walk(file);
    } else if (/\.tsx?$/.test(file) && !/\.test\.|\.spec\.|\.d\.ts$/.test(file)) scan(file);
  }
}
walk('src');
scan('forge.config.ts');
for (const [id, entry] of Object.entries(config.strings)) {
  if (!entry.description || !entry.pages?.length || !entry.sources?.length)
    issues.push(id + ': missing catalog documentation');
  for (const value of [entry.value, ...Object.values(entry.translations || {})]) {
    if (word.test(value)) issues.push(id + ': hardcoded brand in catalog template');
  }
}
const pkg = require('../package.json');
if (
  pkg.productName !== Name ||
  pkg.desktopName !== Name.toLowerCase().replace(/[^a-z0-9+.-]+/g, '-') + '.desktop' ||
  pkg.description !== text('build.packageDescription')
) {
  issues.push('Package metadata is out of date; run pnpm branding:sync.');
}
if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Branding check passed: ' +
      Object.keys(config.strings).length +
      ' documented strings; technical identifiers preserved.'
  );
