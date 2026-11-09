import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAN_AUTH_CHANNELS } from './types';
import type { LanAuthService } from './service';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllEnvs();
  vi.doUnmock('undici');
});
beforeEach(() => {
  vi.resetModules();
});
async function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const fetcher = vi.fn();
  const windows = [0, 1].map(() => ({
    isDestroyed: () => false,
    webContents: { send: vi.fn(), reload: vi.fn() },
  }));
  const appWindows = [2, 3].map(() => ({
    isDestroyed: () => false,
    destroy: vi.fn(),
    webContents: { send: vi.fn() },
  }));
  const requireRenderer = vi.fn();
  const requireStateReader = vi.fn();
  const onLock = vi.fn();
  vi.doMock('electron', () => ({
    app: { whenReady: () => new Promise(() => {}), on: vi.fn(), once: vi.fn() },
    BrowserWindow: {},
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    },
    session: {
      fromPartition: (partition: string) => {
        expect(partition).toBe('lan-auth');
        return { fetch: fetcher };
      },
    },
  }));
  const { registerLanAuth } = await import('./main');
  const auth: LanAuthService = registerLanAuth(requireRenderer, () => windows as never, {
    requireStateReader,
    getWindows: () => appWindows as never,
    onLock,
  });
  dispose = () => auth.dispose();
  const invoke = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, ...args);
  return { auth, fetcher, windows, appWindows, requireRenderer, requireStateReader, invoke, onLock };
}
describe('Electron login boundary', () => {
  it('uses the bundled CA transport for the configured origin and never retries a TLS failure', async () => {
    vi.stubEnv('GILBERT_LAN_CA', 'site root');
    vi.stubEnv('GOOSE_LAN_AUTH_URL', 'https://ai-server.lan:8443/');
    const tlsFetch = vi.fn().mockRejectedValue(new Error('TLS verification failed'));
    vi.doMock('undici', async (importOriginal) => ({
      ...(await importOriginal<typeof import('undici')>()),
      fetch: tlsFetch,
    }));
    const { fetcher, invoke } = await setup();

    await expect(invoke(LAN_AUTH_CHANNELS.login, 'eric', 'test-password')).resolves.toMatchObject({
      ok: false,
    });
    expect(tlsFetch).toHaveBeenCalledExactlyOnceWith(
      'https://ai-server.lan:8443/auth/login',
      expect.objectContaining({ dispatcher: expect.anything(), redirect: 'error' })
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the bundled CA away from a different origin selected at runtime', async () => {
    vi.stubEnv('GILBERT_LAN_CA', 'site root');
    vi.stubEnv('GOOSE_LAN_AUTH_URL', 'https://ai-server.lan:9443');
    const tlsFetch = vi.fn();
    vi.doMock('undici', async (importOriginal) => ({
      ...(await importOriginal<typeof import('undici')>()),
      fetch: tlsFetch,
    }));
    const { fetcher, invoke } = await setup();
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(invoke(LAN_AUTH_CHANNELS.login, 'eric', 'test-password')).resolves.toMatchObject({
      error: 'Invalid username or password.',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://ai-server.lan:9443/auth/login',
      expect.anything()
    );
    expect(tlsFetch).not.toHaveBeenCalled();
  });

  it('checks caller provenance for every exposed IPC handler', async () => {
    const { invoke, requireRenderer, requireStateReader } = await setup();
    requireRenderer.mockImplementation(() => {
      throw new Error('unauthorized');
    });
    requireStateReader.mockImplementation(() => {
      throw new Error('unauthorized');
    });
    for (const channel of [
      LAN_AUTH_CHANNELS.state,
      LAN_AUTH_CHANNELS.login,
      LAN_AUTH_CHANNELS.logout,
    ]) {
      expect(() => invoke(channel, 'eric', 'password')).toThrow('unauthorized');
    }
  });
  it('lets app shells read the shared account without allowing them to log in or out', async () => {
    const { invoke, requireRenderer, requireStateReader } = await setup();
    requireRenderer.mockImplementation(() => {
      throw new Error('main desktop only');
    });
    expect(invoke(LAN_AUTH_CHANNELS.state)).toMatchObject({ user: null });
    expect(requireStateReader).toHaveBeenCalledOnce();
    expect(() => invoke(LAN_AUTH_CHANNELS.login, 'eric', 'password')).toThrow('main desktop only');
    expect(() => invoke(LAN_AUTH_CHANNELS.logout)).toThrow('main desktop only');
  });
  it('broadcasts public account state and retires every regular window on logout', async () => {
    const { auth, fetcher, windows, appWindows, invoke, onLock } = await setup();
    const token = 'a'.repeat(43);
    fetcher
      .mockResolvedValueOnce(Response.json({ access_token: token, token_type: 'bearer' }))
      .mockResolvedValueOnce(
        Response.json({
          id: 1,
          username: 'eric',
          enabled: true,
          allowed_models: [],
          history_id: 'a'.repeat(32),
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await invoke(LAN_AUTH_CHANNELS.login, 'eric', 'test-password');
    expect(auth.isAuthenticated()).toBe(true);
    const requestsBeforeAppRead = fetcher.mock.calls.length;
    expect(invoke(LAN_AUTH_CHANNELS.state)).toMatchObject({ user: { username: 'eric' } });
    expect(fetcher).toHaveBeenCalledTimes(requestsBeforeAppRead);
    for (const win of appWindows) {
      expect(win.webContents.send).toHaveBeenCalledOnce();
      expect(JSON.stringify(win.webContents.send.mock.calls)).not.toContain(token);
      expect(win.destroy).not.toHaveBeenCalled();
    }
    for (const win of windows) {
      expect(win.webContents.send).toHaveBeenCalledOnce();
      expect(JSON.stringify(win.webContents.send.mock.calls)).not.toContain(token);
      expect(win.webContents.reload).not.toHaveBeenCalled();
    }
    const logout = invoke(LAN_AUTH_CHANNELS.logout);
    expect(auth.isAuthenticated()).toBe(false);
    for (const win of appWindows) expect(win.destroy).toHaveBeenCalledOnce();
    expect(onLock).toHaveBeenCalledExactlyOnceWith(windows);
    await logout;
  });
  it('closes every app window when the server revokes the shared session', async () => {
    const { auth, fetcher, appWindows, windows, invoke, onLock } = await setup();
    fetcher
      .mockResolvedValueOnce(Response.json({ access_token: 'b'.repeat(43), token_type: 'bearer' }))
      .mockResolvedValueOnce(
        Response.json({
          id: 1,
          username: 'eric',
          enabled: true,
          allowed_models: [],
          history_id: 'a'.repeat(32),
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await invoke(LAN_AUTH_CHANNELS.login, 'eric', 'test-password');
    await auth.validate();
    expect(auth.isAuthenticated()).toBe(false);
    for (const win of appWindows) expect(win.destroy).toHaveBeenCalledOnce();
    expect(onLock).toHaveBeenCalledExactlyOnceWith(windows);
  });
});
