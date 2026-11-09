/* global RequestInit */
import type { LanAuthResult, LanAuthState, LanAuthUser } from './types';

type AuthRequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: string;
  headers: Record<string, string>;
};

type AuthResponse = Pick<Response, 'ok' | 'status' | 'arrayBuffer'> & {
  headers: {
    get(name: string): string | null;
    entries(): Iterable<[string, string]>;
  };
};

type Fetcher = (url: string, options: AuthRequestOptions) => Promise<AuthResponse>;

export function normalizeAuthServer(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Use HTTPS for a LAN server. HTTP is supported only on localhost.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use only the server origin, for example https://ai-server.lan:8443.');
  }
  return url.origin;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null
  ) {
    super('Authentication request failed');
  }
}

function userFromResponse(body: unknown): LanAuthUser {
  const value = body as Record<string, unknown> | null;
  if (
    !value ||
    !Number.isSafeInteger(value.id) ||
    typeof value.username !== 'string' ||
    value.enabled !== true ||
    !Array.isArray(value.allowed_models) ||
    !value.allowed_models.every((model) => typeof model === 'string') ||
    typeof value.session_expires_at !== 'string' ||
    !(Date.parse(value.session_expires_at) > Date.now())
  ) {
    throw new Error('Invalid account response');
  }
  return {
    id: value.id as number,
    username: value.username,
    allowedModels: value.allowed_models,
    expiresAt: value.session_expires_at,
  };
}

function friendlyError(error: unknown, login: boolean): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return login ? 'Invalid username or password.' : 'Your session ended. Please sign in again.';
    }
    if (error.status === 429) {
      const seconds = Number(error.retryAfter);
      return Number.isFinite(seconds) && seconds > 0 && seconds <= 3600
        ? `Too many attempts. Try again in ${Math.ceil(seconds)} seconds.`
        : 'Too many attempts. Please try again later.';
    }
    if (error.status === 404)
      return 'The server does not have the required authentication endpoint.';
    if (error.status === 422) return 'The server rejected the login details.';
    return 'The authentication server is unavailable. Please try again.';
  }
  return 'Could not verify your account. Check the server address, LAN connection, and trusted HTTPS certificate.';
}

export class LanAuthService {
  private token: string | null = null;
  private user: LanAuthUser | null = null;
  private message: string | null = null;
  private revision = 0;
  private generation = 0;
  private loginPending = false;
  private validation: Promise<void> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly serverUrl: string;
  private readonly configurationError: string | null;

  constructor(
    private readonly appName: string,
    serverUrl: string,
    private readonly fetcher: Fetcher,
    private readonly changed: (state: LanAuthState) => void
  ) {
    try {
      this.serverUrl = normalizeAuthServer(serverUrl);
      this.configurationError = null;
    } catch (error) {
      this.serverUrl = serverUrl;
      this.configurationError = error instanceof Error ? error.message : 'Invalid server address.';
      this.message = this.configurationError;
    }
  }

  state(): LanAuthState {
    return {
      revision: this.revision,
      appName: this.appName,
      serverUrl: this.serverUrl,
      user: this.user ? { ...this.user, allowedModels: [...this.user.allowedModels] } : null,
      message: this.message,
    };
  }

  isServerUrl(value: string): boolean {
    try {
      return new URL(value).origin === new URL(this.serverUrl).origin;
    } catch {
      return false;
    }
  }

  isAuthenticated(): boolean {
    if (this.user && Date.parse(this.user.expiresAt) <= Date.now()) {
      this.lock('Your session expired. Please sign in again.');
    }
    return this.token !== null && this.user !== null;
  }

  private publish(): void {
    this.revision += 1;
    this.changed(this.state());
  }

  private lock(message: string | null): void {
    this.generation += 1;
    this.token = null;
    this.user = null;
    this.message = message;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.publish();
  }

  private async request(endpoint: string, token: string | null, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetcher(this.serverUrl + endpoint, {
        method: endpoint === '/auth/me' ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      // Read within the timeout as well as waiting for the response headers.
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 65_536) throw new Error('Authentication response is too large');
      if (!response.ok) throw new ApiError(response.status, response.headers.get('Retry-After'));
      return new Response(bytes.byteLength ? bytes : null, {
        status: response.status,
        headers: Array.from(response.headers.entries()),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async revoke(token: string): Promise<boolean> {
    try {
      await this.request('/auth/logout', token);
      return true;
    } catch (error) {
      return error instanceof ApiError && error.status === 401;
    }
  }

  async login(username: unknown, password: unknown): Promise<LanAuthResult> {
    if (this.configurationError) {
      return { ok: false, state: this.state(), error: this.configurationError };
    }
    if (this.loginPending || this.isAuthenticated()) {
      return {
        ok: false,
        state: this.state(),
        error: 'A sign-in is already active. Try again shortly.',
      };
    }
    if (
      typeof username !== 'string' ||
      !username.trim() ||
      username.trim().length > 64 ||
      typeof password !== 'string' ||
      !password ||
      new TextEncoder().encode(password).length > 1024
    ) {
      return { ok: false, state: this.state(), error: 'Enter a valid username and password.' };
    }
    this.loginPending = true;
    const generation = ++this.generation;
    let issuedToken: string | null = null;
    try {
      const response = await this.request('/auth/login', null, {
        username: username.trim(),
        password,
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (
        typeof body.access_token !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(body.access_token) ||
        body.token_type !== 'bearer'
      ) {
        throw new Error('Invalid session response');
      }
      issuedToken = body.access_token;
      const account = await this.request('/auth/me', issuedToken);
      const user = userFromResponse(await account.json());
      if (generation !== this.generation) {
        void this.revoke(issuedToken);
        return { ok: false, state: this.state(), error: 'Sign-in was cancelled.' };
      }
      this.token = issuedToken;
      this.user = user;
      this.message = null;
      this.scheduleExpiry();
      this.publish();
      return { ok: true, state: this.state() };
    } catch (error) {
      if (issuedToken) void this.revoke(issuedToken);
      const message = friendlyError(error, true);
      return { ok: false, state: this.state(), error: message };
    } finally {
      this.loginPending = false;
    }
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (!this.user) return;
    const remaining = Date.parse(this.user.expiresAt) - Date.now();
    this.expiryTimer = setTimeout(
      () => {
        if (!this.isAuthenticated()) return;
        this.scheduleExpiry();
      },
      Math.min(Math.max(remaining, 1), 2_147_483_647)
    );
    this.expiryTimer.unref?.();
  }

  async validate(): Promise<void> {
    if (this.validation) return this.validation;
    if (!this.isAuthenticated()) return;
    const generation = this.generation;
    const token = this.token!;
    const operation = (async () => {
      try {
        const response = await this.request('/auth/me', token);
        const user = userFromResponse(await response.json());
        if (generation !== this.generation) return;
        this.user = user;
        this.scheduleExpiry();
        this.publish();
      } catch (error) {
        if (generation === this.generation) {
          this.lock(friendlyError(error, false));
        }
      }
    })();
    this.validation = operation;
    try {
      await operation;
    } finally {
      if (this.validation === operation) this.validation = null;
    }
  }

  async logout(): Promise<LanAuthResult> {
    const token = this.token;
    this.lock(null);
    const revoked = token ? await this.revoke(token) : true;
    if (!revoked && !this.isAuthenticated()) {
      this.message =
        'Signed out on this computer. The server could not confirm revocation; that session remains valid until it expires or an administrator revokes it.';
      this.publish();
    }
    return { ok: true, state: this.state() };
  }

  dispose(): void {
    this.generation += 1;
    this.token = null;
    this.user = null;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
}
