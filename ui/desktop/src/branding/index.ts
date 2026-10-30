import config from './app-branding.json';

interface BrandEntry {
  kind: 'text' | 'message';
  value: string;
  description: string;
  pages: string[];
  sources: string[];
  translations?: Record<string, string>;
}

const catalog = config as unknown as { Name: string; strings: Record<string, BrandEntry> };
export const APP_NAME = catalog.Name;

export function brandText(id: string, values: Record<string, unknown> = {}): string {
  const entry = catalog.strings[id];
  if (!entry) throw new Error(`Unknown application branding string: ${id}`);
  return entry.value.replace(/\{(Name|value\d+)\}/g, (token, key: string) => {
    if (key === 'Name') return APP_NAME;
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token;
  });
}

export function brandMessage(id: string) {
  const entry = catalog.strings[id];
  if (!entry || entry.kind !== 'message') throw new Error(`Unknown branding message: ${id}`);
  return { id, defaultMessage: brandText(id), description: entry.description };
}

// Only application-owned localization catalogs are passed here, never chat or tool content.
export function resolveBrandTokens<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('__APP_NAME__', APP_NAME) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => resolveBrandTokens(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveBrandTokens(item)])
    ) as T;
  }
  return value;
}

export function resolveExtensionBranding<T extends { description?: string }>(extension: T): T {
  const key = extension.description?.startsWith('@brand:') ? extension.description.slice(7) : null;
  return key ? { ...extension, description: brandText(key) } : extension;
}
