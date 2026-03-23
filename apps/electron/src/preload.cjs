const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__OPENCLAW_DESKTOP__', {
  hiddenTabs: ['debug', 'nodes', 'instances'],
  gatewayUrl: 'ws://localhost:18789',
  brandName: 'OpenClaw',
});

contextBridge.exposeInMainWorld('electronAPI', {
  openAccountWindow: () => ipcRenderer.invoke('account:open-window'),
});
