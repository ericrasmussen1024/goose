import { APP_NAME } from '../branding';
/* global HTMLFormElement */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { LogOut } from 'lucide-react';
import BrandIcon from '../branding/BrandIcon';
import type { LanAuthState, LanAuthUser } from './types';
import './login.css';

const AccountContext = createContext<LanAuthUser | null>(null);

export function useLanAccount() {
  return useContext(AccountContext);
}

export function LanAccountButton() {
  const user = useLanAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  return (
    <div className="px-3 pt-2 pb-1 text-text-primary no-drag">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate" title={`Signed in as ${user.username}`}>
          {user.username}
        </span>
        <button
          type="button"
          disabled={busy}
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-background-tertiary disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            void window.lanAuth.logout().catch(() => {
              setBusy(false);
              setError('Could not sign out. Please restart the application.');
            });
          }}
        >
          <LogOut size={13} aria-hidden="true" />
          Sign out
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function LanAuthGate({ children }: { children: ReactNode }) {
  const isAppWindow = window.appConfig?.get('GOOSE_WINDOW_ROLE') === 'app';
  const [state, setState] = useState<LanAuthState | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bridgeReady, setBridgeReady] = useState(false);
  const alive = useRef(true);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    const apply = (next: LanAuthState) => {
      if (!alive.current) return;
      setState((previous) => (!previous || next.revision >= previous.revision ? next : previous));
      setPassword('');
      setBridgeReady(true);
    };
    if (!window.lanAuth) {
      setError(
        'The login bridge is missing. Apply the preload and main-process changes, then restart the application.'
      );
      return () => {
        alive.current = false;
      };
    }
    const unsubscribe = window.lanAuth.onStateChanged(apply);
    void window.lanAuth
      .getState()
      .then(apply)
      .catch(() => {
        if (alive.current)
          setError(
            isAppWindow
              ? 'Could not check the desktop session. Close this window and reopen the app from the desktop.'
              : 'Could not initialize login. Restart the application.'
          );
      });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [isAppWindow]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !bridgeReady) return;
    setBusy(true);
    setError('');
    const submittedPassword = password;
    setPassword('');
    try {
      const result = await window.lanAuth.login(username, submittedPassword);
      if (!alive.current) return;
      setState((previous) =>
        !previous || result.state.revision >= previous.revision ? result.state : previous
      );
      if (!result.ok) {
        setError(result.error || 'Could not sign in. Please try again.');
        passwordInput.current?.focus();
      }
    } catch {
      if (alive.current)
        setError('Could not contact the desktop login service. Restart the application.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  if (state?.user) {
    return <AccountContext.Provider value={state.user}>{children}</AccountContext.Provider>;
  }

  if (isAppWindow) {
    return (
      <main className="lan-login">
        <section className="lan-login-card" role="status">
          {error ||
            (bridgeReady
              ? 'Sign in in the main desktop window, then reopen this app.'
              : 'Opening app…')}
        </section>
      </main>
    );
  }

  return (
    <main className="lan-login">
      <div className="lan-login-drag" aria-hidden="true" />
      <section className="lan-login-card" aria-labelledby="lan-login-title">
        <div className="lan-login-mark" aria-hidden="true">
          <BrandIcon width={36} height={36} />
        </div>
        <p className="lan-login-brand">{state?.appName || APP_NAME}</p>
        <h1 id="lan-login-title">Welcome back</h1>
        <p className="lan-login-intro">Sign in with your organization account.</p>
        <form onSubmit={submit} aria-busy={busy}>
          <label htmlFor="lan-username">Username</label>
          <input
            id="lan-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            maxLength={64}
            required
            disabled={busy}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <label htmlFor="lan-password">Password</label>
          <input
            ref={passwordInput}
            id="lan-password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            required
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {(error || state?.message) && (
            <p className="lan-login-error" role="alert">
              {error || state?.message}
            </p>
          )}
          <button
            className="lan-login-submit"
            type="submit"
            disabled={busy || !bridgeReady || !username.trim() || !password}
          >
            {busy ? 'Signing in…' : bridgeReady ? 'Sign in' : 'Connecting…'}
          </button>
        </form>
        <div className="lan-login-server">
          <span className="lan-login-server-dot" aria-hidden="true" />
          <span>{state?.serverUrl || 'Initializing account service'}</span>
        </div>
        <p className="lan-login-help">Need an account? Contact your administrator.</p>
      </section>
    </main>
  );
}
