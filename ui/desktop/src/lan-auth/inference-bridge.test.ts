import { afterEach, expect, it, vi } from 'vitest';
import { fetch } from 'undici';
import { startInferenceBridge } from './inference-bridge';
import { LanAuthService } from './service';

let bridge: Awaited<ReturnType<typeof startInferenceBridge>> | undefined;
let auth: LanAuthService | undefined;
afterEach(() => {
  bridge?.close();
  auth?.dispose();
});

it('streams only signed-in requests and keeps the LAN credential out of the child environment', async () => {
  const token = 'b'.repeat(43);
  const frames = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n';
  const upstream = vi.fn((url: string, options: { headers: unknown }) => {
    if (url.endsWith('/auth/login')) {
      return Promise.resolve(Response.json({ access_token: token, token_type: 'bearer' }));
    }
    if (url.endsWith('/auth/me')) {
      return Promise.resolve(
        Response.json({
          id: 1,
          username: 'alice',
          enabled: true,
          allowed_models: ['gilbert-default'],
          history_id: 'a'.repeat(32),
          session_expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
      );
    }
    expect(options.headers).toMatchObject({ Authorization: 'Bearer ' + token });
    if (url.endsWith('/auth/logout')) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(
      new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } })
    );
  });
  auth = new LanAuthService('Gilbert', 'https://ai-server.lan:8443', upstream, vi.fn());
  bridge = await startInferenceBridge(auth);
  const { OPENAI_HOST, OPENAI_API_KEY, GOOSE_PROVIDER, GOOSE_MODEL } = bridge.env;
  expect(OPENAI_HOST).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(GOOSE_PROVIDER).toBe('openai');
  expect(GOOSE_MODEL).toBe('gilbert-default');
  expect(JSON.stringify(bridge.env)).not.toContain(token);

  const address = `${OPENAI_HOST}/v1/chat/completions`;
  const body = JSON.stringify({ model: GOOSE_MODEL, stream: true });
  const request = () =>
    fetch(address, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body,
    });
  expect((await fetch(address, { method: 'POST', body })).status).toBe(401);
  expect((await request()).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
  expect((await auth.login('alice', 'password')).ok).toBe(true);

  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(frames);
  expect(upstream).toHaveBeenLastCalledWith(
    'https://ai-server.lan:8443/v1/chat/completions',
    expect.objectContaining({ body, redirect: 'error' })
  );
  await auth.logout();
  expect((await request()).status).toBe(401);
});
