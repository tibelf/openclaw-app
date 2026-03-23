const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getNewApiBaseUrl: () => ipcRenderer.invoke('auth:get-base-url'),
  doLogin: (username, password) => ipcRenderer.invoke('auth:do-login', username, password),
  saveAuthToken: (accessToken, userId, username, apiKey) =>
    ipcRenderer.invoke('auth:save-token', accessToken, userId, username, apiKey),
  getAccountInfo: () => ipcRenderer.invoke('account:info'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  logout: () => ipcRenderer.invoke('auth:logout'),
});
