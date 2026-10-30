import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { LAN_AUTH_CHANNELS, type LanAuthAPI, type LanAuthState } from './types';

const api: LanAuthAPI = {
  getState: () => ipcRenderer.invoke(LAN_AUTH_CHANNELS.state),
  login: (username, password) => ipcRenderer.invoke(LAN_AUTH_CHANNELS.login, username, password),
  logout: () => ipcRenderer.invoke(LAN_AUTH_CHANNELS.logout),
  onStateChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, state: LanAuthState) => callback(state);
    ipcRenderer.on(LAN_AUTH_CHANNELS.changed, listener);
    return () => ipcRenderer.removeListener(LAN_AUTH_CHANNELS.changed, listener);
  },
};

contextBridge.exposeInMainWorld('lanAuth', api);

declare global {
  interface Window {
    lanAuth: LanAuthAPI;
  }
}
