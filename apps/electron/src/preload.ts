import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('__OPENCLAW_DESKTOP__', {
  hiddenTabs: ['debug', 'nodes', 'instances'],
  gatewayUrl: 'ws://localhost:18789',
  brandName: 'OpenClaw',
});
