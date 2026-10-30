import { createIntl, createIntlCache } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import config from './app-branding.json';
import {
  APP_NAME,
  brandMessage,
  brandText,
  resolveBrandTokens,
  resolveExtensionBranding,
} from './index';

const cache = createIntlCache();

beforeEach(() => {
  vi.resetModules();
});

describe('one-file desktop branding', () => {
  it('uses the configured name for messages, native labels, and notifications', () => {
    expect(brandMessage('onboardingGuard.welcomeTitle').defaultMessage).toBe(
      `Welcome to ${APP_NAME}`
    );
    expect(brandText('desktop.main.text8')).toBe(`About ${APP_NAME}`);
    expect(brandText('desktop.utils.autoUpdater.text15', { value0: '2.0' })).toBe(
      `Version 2.0 will be installed when you quit ${APP_NAME}. Click to install now.`
    );
  });

  it('documents every entry with a description, page/surface, and source', () => {
    for (const entry of Object.values(config.strings)) {
      expect(entry.description.length).toBeGreaterThan(15);
      expect(entry.pages.length).toBeGreaterThan(0);
      expect(entry.sources.length).toBeGreaterThan(0);
    }
  });

  it('has no hardcoded original brand in any English or translated template', () => {
    for (const entry of Object.values(config.strings)) {
      const translated = 'translations' in entry ? Object.values(entry.translations) : [];
      for (const value of [entry.value, ...translated]) expect(value).not.toMatch(/\bgoose\b/i);
    }
  });

  it('preserves real filenames and configuration keys in help text', () => {
    expect(brandText('goosehintsModal.helpText1')).toContain('.goosehints');
    expect(brandText('externalBackendSection.secretKeyHelp')).toContain('GOOSE_SERVER__SECRET_KEY');
  });

  it('keeps tool names and other runtime content unchanged while formatting the brand', () => {
    const intl = createIntl({ locale: 'en', messages: {} }, cache);
    expect(
      intl.formatMessage(brandMessage('toolConfirmation.gooseWouldLikeToCallWithName'), {
        toolName: 'Goose search',
      })
    ).toBe(`${APP_NAME} would like to call Goose search. Allow?`);
  });

  it('resolves brand markers inside compiled ICU plural and rich-text trees', () => {
    const tree = {
      message: [
        { type: 0, value: '__APP_NAME__' },
        {
          type: 6,
          value: 'count',
          options: { other: { value: [{ type: 0, value: 'Ask __APP_NAME__' }] } },
        },
      ],
    };
    const result = resolveBrandTokens(tree);
    expect(result.message[0].value).toBe(APP_NAME);
    expect(JSON.stringify(result)).toContain(`Ask ${APP_NAME}`);
    expect(JSON.stringify(tree)).toContain('__APP_NAME__');
  });

  it('resolves only explicitly marked bundled extension descriptions', () => {
    const marked = { description: '@brand:desktop.built-in-extensions.json.text17' };
    expect(resolveExtensionBranding(marked).description).toBe(
      `Teach ${APP_NAME} your preferences as you go.`
    );
    const custom = { description: 'Goose is the name of my project' };
    expect(resolveExtensionBranding(custom)).toBe(custom);
  });

  it('changes all English defaults when only Name changes', async () => {
    vi.doMock('./app-branding.json', () => ({ default: { ...config, Name: 'Morgan' } }));
    try {
      const renamed = await import('./index');
      for (const [id, entry] of Object.entries(config.strings)) {
        if (!entry.value.includes('{Name}')) continue;
        expect(renamed.brandText(id)).toContain('Morgan');
        expect(renamed.brandText(id)).not.toContain('{Name}');
      }
      expect(renamed.resolveBrandTokens('__APP_NAME__')).toBe('Morgan');
    } finally {
      vi.doUnmock('./app-branding.json');
    }
  });
});
