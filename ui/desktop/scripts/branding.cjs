const config = require('../src/branding/app-branding.json');
const { Name, strings } = config;

if (typeof Name !== 'string' || !Name.trim() || /[<>:"/\\|?*{}\r\n]/.test(Name)) {
  throw new Error(
    'app-branding.json Name must be a nonempty filename-safe display name without ICU braces.'
  );
}

function text(id, values = {}) {
  const entry = strings[id];
  if (!entry) throw new Error('Unknown application branding string: ' + id);
  return entry.value.replace(/\{(Name|value\d+)\}/g, (token, key) =>
    key === 'Name' ? Name : Object.hasOwn(values, key) ? String(values[key]) : token
  );
}

// Keep the name out of compiled ICU patterns until the renderer loads them.
function withBrandMessages(locale, messages) {
  const merged = { ...messages };
  for (const [id, entry] of Object.entries(strings)) {
    if (entry.kind !== 'message') continue;
    const message = locale === 'en' ? entry.value : (entry.translations?.[locale] ?? entry.value);
    merged[id] = {
      defaultMessage: message.replaceAll('{Name}', '__APP_NAME__'),
      description: 'Pages: ' + entry.pages.join('; ') + '. ' + entry.description,
    };
  }
  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  );
}

module.exports = { config, Name, text, withBrandMessages };
