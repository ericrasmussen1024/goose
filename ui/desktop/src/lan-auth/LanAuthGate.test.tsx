import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanAccountButton, LanAuthGate } from './LanAuthGate';
import type { LanAuthState } from './types';
const initial: LanAuthState = {
  revision: 0,
  appName: 'Gilbert',
  serverUrl: 'https://ai-server.lan',
  user: null,
  message: null,
};
const authenticated: LanAuthState = {
  ...initial,
  revision: 1,
  user: { id: 1, username: 'eric', allowedModels: [], expiresAt: '2099-01-01T00:00:00Z' },
};
let change: (state: LanAuthState) => void;
beforeEach(() => {
  window.lanAuth = {
    getState: vi.fn().mockResolvedValue(initial),
    login: vi.fn().mockResolvedValue({ ok: true, state: authenticated }),
    logout: vi.fn().mockResolvedValue({ ok: true, state: { ...initial, revision: 2 } }),
    onStateChanged: vi.fn((callback) => {
      change = callback;
      return vi.fn();
    }),
  };
});
describe('LAN login screen', () => {
  it('does not mount Goose children before successful login', async () => {
    const mounted = vi.fn();
    function Child() {
      mounted();
      return <div>Chat workspace</div>;
    }
    render(
      <LanAuthGate>
        <Child />
      </LanAuthGate>
    );
    await screen.findByText('Gilbert');
    expect(mounted).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'eric' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'private-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Chat workspace');
    expect(window.lanAuth.login).toHaveBeenCalledWith('eric', 'private-password');
  });
  it('shows login failures and clears the password field', async () => {
    vi.mocked(window.lanAuth.login).mockResolvedValue({
      ok: false,
      state: initial,
      error: 'Invalid username or password.',
    });
    render(
      <LanAuthGate>
        <div>Chat workspace</div>
      </LanAuthGate>
    );
    await screen.findByText('Gilbert');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'eric' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByText('Chat workspace')).not.toBeInTheDocument();
  });
  it('unmounts the workspace on an auth-state event and ignores stale replies', async () => {
    vi.mocked(window.lanAuth.getState).mockResolvedValue(authenticated);
    render(
      <LanAuthGate>
        <div>Chat workspace</div>
        <LanAccountButton />
      </LanAuthGate>
    );
    await screen.findByText('Chat workspace');
    expect(screen.getByText('eric')).toBeInTheDocument();
    act(() => change({ ...initial, revision: 2, message: 'Session expired.' }));
    await screen.findByText('Session expired.');
    act(() => change(authenticated));
    expect(screen.queryByText('Chat workspace')).not.toBeInTheDocument();
  });
  it('calls main-process logout from the sidebar', async () => {
    vi.mocked(window.lanAuth.getState).mockResolvedValue(authenticated);
    render(
      <LanAuthGate>
        <LanAccountButton />
      </LanAuthGate>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(window.lanAuth.logout).toHaveBeenCalledOnce());
  });
});
