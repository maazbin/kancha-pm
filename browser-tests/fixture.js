import { test as base } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
import { startServer } from '../src/server.js';
export const test = base.extend({
  baseURL: async ({}, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kancha-browser-')),
      store = openStore({ directory: dir });
    const server = await startServer(store, { port: 0, background: false });
    try {
      await use('http://127.0.0.1:' + server.address().port);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
});
export { expect } from '@playwright/test';
