import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeContext';
import { themes } from '../theme/theme-tokens';
import { LanAuthGate } from './LanAuthGate';

let systemDark: boolean;
let systemChange: (() => void) | undefined;
let themeBroadcast: ((_event: unknown, value: unknown) => void) | undefined;

beforeEach(() => {
  systemDark = false;
  systemChange = undefined;
  themeBroadcast = undefined;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_name: string, listener: () => void) => {
        systemChange = listener;
      },
      removeEventListener: vi.fn(),
    })),
  });
  window.electron.getSetting = vi.fn(async (key: string) =>
    key === 'useSystemTheme' ? false : 'light'
  ) as typeof window.electron.getSetting;
  window.electron.on = vi.fn((_channel, callback) => {
    themeBroadcast = callback;
  });
  window.electron.off = vi.fn();
  window.lanAuth = {
    getState: vi.fn().mockResolvedValue({
      revision: 0,
      appName: 'Gilbert',
      serverUrl: 'https://ai-server.lan:8443',
      user: null,
      message: null,
    }),
    login: vi.fn(),
    logout: vi.fn(),
    onStateChanged: () => () => {},
  };
});

function renderLogin() {
  return render(
    <ThemeProvider>
      <LanAuthGate>
        <div>Chat workspace</div>
      </LanAuthGate>
    </ThemeProvider>
  );
}

describe('login uses the authoritative desktop theme before authentication', () => {
  it.each(['light', 'dark', 'aura'] as const)(
    'loads the saved %s theme while the app stays locked',
    async (theme) => {
      window.electron.getSetting = vi.fn(async (key: string) =>
        key === 'useSystemTheme' ? false : theme
      ) as typeof window.electron.getSetting;
      renderLogin();
      await screen.findByRole('heading', { name: 'Welcome back' });
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe(theme));
      expect(document.documentElement.style.getPropertyValue('--color-background-primary')).toBe(
        themes[theme].tokens['--color-background-primary']
      );
      expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(
        themes[theme].tokens['--font-sans']
      );
      expect(screen.queryByText('Chat workspace')).not.toBeInTheDocument();
    }
  );
  it('follows live system changes when System is selected', async () => {
    window.electron.getSetting = vi.fn(async (key: string) =>
      key === 'useSystemTheme' ? true : 'light'
    ) as typeof window.electron.getSetting;
    renderLogin();
    await waitFor(() => expect(systemChange).toBeDefined());
    act(() => {
      systemDark = true;
      systemChange?.();
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });
  it('receives theme changes broadcast by other app windows while signed out', async () => {
    renderLogin();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    act(() => themeBroadcast?.({}, { useSystemTheme: false, theme: 'aura' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('aura'));
  });
});
