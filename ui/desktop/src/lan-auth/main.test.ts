import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAN_AUTH_CHANNELS } from './types';
import type { LanAuthService } from './service';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
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
  });
  dispose = () => auth.dispose();
  const invoke = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, ...args);
  return { auth, fetcher, windows, appWindows, requireRenderer, requireStateReader, invoke };
}
describe('Electron login boundary', () => {
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
  it('broadcasts public account state and reloads every regular window on logout', async () => {
    const { auth, fetcher, windows, appWindows, invoke } = await setup();
    const token = 'a'.repeat(43);
    fetcher
      .mockResolvedValueOnce(Response.json({ access_token: token, token_type: 'bearer' }))
      .mockResolvedValueOnce(
        Response.json({
          id: 1,
          username: 'eric',
          enabled: true,
          allowed_models: [],
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
    for (const win of windows) expect(win.webContents.reload).toHaveBeenCalledOnce();
    await logout;
  });
  it('closes every app window when the server revokes the shared session', async () => {
    const { auth, fetcher, appWindows, windows, invoke } = await setup();
    fetcher
      .mockResolvedValueOnce(Response.json({ access_token: 'b'.repeat(43), token_type: 'bearer' }))
      .mockResolvedValueOnce(
        Response.json({
          id: 1,
          username: 'eric',
          enabled: true,
          allowed_models: [],
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await invoke(LAN_AUTH_CHANNELS.login, 'eric', 'test-password');
    await auth.validate();
    expect(auth.isAuthenticated()).toBe(false);
    for (const win of appWindows) expect(win.destroy).toHaveBeenCalledOnce();
    for (const win of windows) expect(win.webContents.reload).toHaveBeenCalledOnce();
  });
});
