export interface LanAuthUser {
  id: number;
  username: string;
  allowedModels: string[];
  expiresAt: string;
}

// This is the entire renderer contract. Credentials never appear in this state.
export interface LanAuthState {
  revision: number;
  appName: string;
  serverUrl: string;
  user: LanAuthUser | null;
  message: string | null;
}

export interface LanAuthResult {
  ok: boolean;
  state: LanAuthState;
  error?: string;
}

export interface LanAuthAPI {
  getState: () => Promise<LanAuthState>;
  login: (username: string, password: string) => Promise<LanAuthResult>;
  logout: () => Promise<LanAuthResult>;
  onStateChanged: (callback: (state: LanAuthState) => void) => () => void;
}

export const LAN_AUTH_CHANNELS = {
  state: 'lan-auth:state',
  login: 'lan-auth:login',
  logout: 'lan-auth:logout',
  changed: 'lan-auth:changed',
} as const;
