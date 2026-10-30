import { APP_NAME } from '../branding';
import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import config from './config.json';
import { LanAuthService } from './service';
import { LAN_AUTH_CHANNELS } from './types';

export function registerLanAuth(
  requireRenderer: (event: IpcMainInvokeEvent) => BrowserWindow,
  getWindows: () => BrowserWindow[]
): LanAuthService {
  let wasAuthenticated = false;
  const auth = new LanAuthService(
    APP_NAME,
    process.env.GOOSE_LAN_AUTH_URL || String(config.serverUrl || ''),
    (url, options) => session.fromPartition('lan-auth').fetch(url, options),
    (state) => {
      const locked = wasAuthenticated && state.user === null;
      wasAuthenticated = state.user !== null;
      for (const win of getWindows()) {
        if (win.isDestroyed()) continue;
        win.webContents.send(LAN_AUTH_CHANNELS.changed, state);
        // Reload clears ACP sockets, module state, and cached conversation data.
        if (locked) win.webContents.reload();
      }
    }
  );

  ipcMain.handle(LAN_AUTH_CHANNELS.state, (event) => {
    requireRenderer(event);
    auth.isAuthenticated();
    return auth.state();
  });
  ipcMain.handle(LAN_AUTH_CHANNELS.login, (event, username: unknown, password: unknown) => {
    requireRenderer(event);
    return auth.login(username, password);
  });
  ipcMain.handle(LAN_AUTH_CHANNELS.logout, (event) => {
    requireRenderer(event);
    return auth.logout();
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  void app.whenReady().then(() => {
    timer = setInterval(() => void auth.validate(), 60_000);
    timer.unref();
  });
  app.on('browser-window-focus', () => void auth.validate());
  app.once('will-quit', () => {
    if (timer) clearInterval(timer);
    auth.dispose();
  });
  return auth;
}
