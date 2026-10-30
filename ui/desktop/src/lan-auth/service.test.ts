/* global RequestInit */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanAuthService, normalizeAuthServer } from './service';
const token = 'a'.repeat(43);
function account(overrides = {}) {
  return {
    id: 1,
    username: 'eric',
    enabled: true,
    allowed_models: ['qwen'],
    session_expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}
function signedIn(fetcher = vi.fn()) {
  const changed = vi.fn();
  const auth = new LanAuthService('Gilbert', 'https://ai-server.lan', fetcher, changed);
  fetcher.mockResolvedValueOnce(Response.json({ access_token: token, token_type: 'bearer' }));
  fetcher.mockResolvedValueOnce(Response.json(account()));
  return { auth, fetcher, changed };
}
const instances: LanAuthService[] = [];
afterEach(() => {
  instances.forEach((auth) => auth.dispose());
  instances.length = 0;
  vi.useRealTimers();
});
function keep(auth: LanAuthService) {
  instances.push(auth);
  return auth;
}
describe('LAN authentication service', () => {
  it('accepts HTTPS origins and only permits HTTP on literal loopback', () => {
    expect(normalizeAuthServer('https://ai-server.lan:8443/')).toBe('https://ai-server.lan:8443');
    expect(normalizeAuthServer('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000');
    expect(normalizeAuthServer('http://[::1]:8000')).toBe('http://[::1]:8000');
    for (const url of [
      'http://192.168.1.50:8000',
      'http://localhost.evil.test',
      'https://a/b',
      'https://u:p@a',
      'https://a?x=1',
      'file:///tmp/a',
    ])
      expect(() => normalizeAuthServer(url)).toThrow();
  });
  it('stays locked with invalid configuration without sending credentials', async () => {
    const fetcher = vi.fn();
    const auth = keep(new LanAuthService('Test', 'http://192.168.1.50', fetcher, vi.fn()));
    expect((await auth.login('eric', 'test-password')).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires both login and /me before exposing the account, without exposing credentials', async () => {
    const { auth, fetcher } = signedIn();
    keep(auth);
    expect(auth.isAuthenticated()).toBe(false);
    const result = await auth.login(' Eric ', ' test password ');
    expect(result.ok).toBe(true);
    expect(auth.isAuthenticated()).toBe(true);
    expect(result.state.user?.allowedModels).toEqual(['qwen']);
    expect(fetcher.mock.calls[0][0]).toBe('https://ai-server.lan/auth/login');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      username: 'Eric',
      password: ' test password ',
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('test password');
  });
  it('does not send oversized UTF-8 passwords', async () => {
    const fetcher = vi.fn();
    const auth = keep(new LanAuthService('Test', 'https://ai-server.lan', fetcher, vi.fn()));
    expect((await auth.login('eric', '🙂'.repeat(257))).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 429, 404, 422, 500])(
    'gives a safe error for HTTP %i without echoing response bodies',
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { detail: 'sensitive-server-content' },
            { status, headers: { 'Retry-After': '22' } }
          )
        );
      const auth = keep(new LanAuthService('Test', 'https://ai-server.lan', fetcher, vi.fn()));
      const result = await auth.login('eric', 'test-password');
      expect(result.ok).toBe(false);
      expect(result.error).not.toContain('sensitive-server-content');
      if (status === 429) expect(result.error).toContain('22 seconds');
      expect(auth.isAuthenticated()).toBe(false);
    }
  );
  it('refuses a session that /me rejects and revokes the provisional token', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: token, token_type: 'bearer' }))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const auth = keep(new LanAuthService('Test', 'https://ai-server.lan', fetcher, vi.fn()));
    expect((await auth.login('eric', 'test-password')).ok).toBe(false);
    expect(auth.isAuthenticated()).toBe(false);
    expect(fetcher.mock.calls[2][0]).toContain('/auth/logout');
  });
  it('clears access before an offline logout finishes and reports unconfirmed revocation', async () => {
    const { auth, fetcher } = signedIn();
    keep(auth);
    await auth.login('eric', 'test-password');
    fetcher.mockRejectedValueOnce(new Error('offline'));
    const promise = auth.logout();
    expect(auth.isAuthenticated()).toBe(false);
    expect((await promise).state.message).toContain('could not confirm revocation');
  });
  it('recognizes an already-revoked session as a completed logout', async () => {
    const { auth, fetcher } = signedIn();
    keep(auth);
    await auth.login('eric', 'test-password');
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    expect((await auth.logout()).state.message).toBeNull();
  });
  it.each(['offline', 'revoked'])(
    'locks callers when periodic validation fails: %s',
    async (reason) => {
      const { auth, fetcher, changed } = signedIn();
      keep(auth);
      await auth.login('eric', 'test-password');
      if (reason === 'offline') fetcher.mockRejectedValueOnce(new Error('offline'));
      else fetcher.mockResolvedValueOnce(Response.json({}, { status: 401 }));
      await auth.validate();
      expect(auth.isAuthenticated()).toBe(false);
      expect(changed.mock.lastCall?.[0].user).toBeNull();
    }
  );
  it('expires locally even without another API request', async () => {
    vi.useFakeTimers();
    const { auth } = signedIn();
    keep(auth);
    await auth.login('eric', 'test-password');
    await vi.advanceTimersByTimeAsync(60_001);
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.state().message).toContain('expired');
  });
  it('does not unlock after logout races with an unfinished sign-in', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
      )
      .mockResolvedValueOnce(Response.json(account()))
      .mockResolvedValue(new Response(null, { status: 204 }));
    const auth = keep(new LanAuthService('Test', 'https://ai-server.lan', fetcher, vi.fn()));
    const pending = auth.login('eric', 'test-password');
    await auth.logout();
    finish(Response.json({ access_token: token, token_type: 'bearer' }));
    expect((await pending).ok).toBe(false);
    expect(auth.isAuthenticated()).toBe(false);
  });
  it('ignores an old validation response after sign-out', async () => {
    const { auth, fetcher } = signedIn();
    keep(auth);
    await auth.login('eric', 'test-password');
    let finish!: (response: Response) => void;
    fetcher
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const validation = auth.validate();
    await auth.logout();
    finish(Response.json(account()));
    await validation;
    expect(auth.isAuthenticated()).toBe(false);
  });
  it('aborts requests that time out', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const auth = keep(new LanAuthService('Test', 'https://ai-server.lan', fetcher, vi.fn()));
    const pending = auth.login('eric', 'test-password');
    await vi.advanceTimersByTimeAsync(15_001);
    expect((await pending).ok).toBe(false);
    expect(auth.isAuthenticated()).toBe(false);
  });
});
