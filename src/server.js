import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { commands, invoke, markers, quiet } from './engine.js';
import { sync } from './sources.js';
import { deliver } from './desktop.js';
import { openStore } from './store.js';
import { seedDemo } from './demo.js';
import { mcpConfig } from './connections.js';
import { chatHistory, submitChat } from './chat.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = {
  '/': 'index.html',
  '/app.js': 'app.js',
  '/project-views.js': 'project-views.js',
  '/connections.js': 'connections.js',
  '/work-views.js': 'work-views.js',
  '/style.css': 'style.css',
  '/mark.svg': 'mark.svg',
};
const fonts = {
  '/fonts/instrument.woff2':
    '@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2',
  '/fonts/serif.woff2': '@fontsource/dm-serif-text/files/dm-serif-text-latin-400-normal.woff2',
};
const types = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
};
export async function startServer(store, { port = 4317, background = true, native = false } = {}) {
  const map = commands(store),
    cookie = randomBytes(24).toString('hex');
  let tick, sample;
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const host = req.headers.host;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const fail = (code, message) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    try {
      if (!['127.0.0.1:' + port, 'localhost:' + port].includes(host))
        return fail(403, 'Use the local dashboard address');
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + host)
        return fail(403, 'Origin does not match this dashboard');
      const url = new URL(req.url, 'http://' + host);
      let activeStore = store,
        activeMap = map;
      if (url.pathname === '/sample' || url.pathname.startsWith('/sample/')) {
        if (!store.demo) {
          if (!sample) {
            sample = openStore({ directory: store.base, demo: true });
            seedDemo(sample);
          }
          activeStore = sample;
          activeMap = commands(sample);
        }
        url.pathname = url.pathname.replace(/^\/sample/, '') || '/';
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ app: 'kancha-pm', demo: store.demo }));
        return;
      }
      if (
        req.method === 'GET' &&
        (Object.hasOwn(assets, url.pathname) ||
          Object.hasOwn(fonts, url.pathname) ||
          /^\/icons\/[a-z0-9-]+\.svg$/.test(url.pathname))
      ) {
        const icon = url.pathname.startsWith('/icons/');
        const file = Object.hasOwn(fonts, url.pathname)
          ? path.join(root, 'node_modules', fonts[url.pathname])
          : icon
            ? path.join(root, 'node_modules/lucide-static/icons', path.basename(url.pathname))
            : path.join(root, 'web', assets[url.pathname]);
        let bytes;
        try {
          bytes = await readFile(file);
        } catch {
          return fail(404, 'Asset unavailable');
        }
        if (url.pathname === '/')
          res.setHeader(
            'Set-Cookie',
            'kancha' + server.address().port + '=' + cookie + '; HttpOnly; SameSite=Strict; Path=/',
          );
        res.setHeader('Content-Type', types[path.extname(file).slice(1)]);
        res.end(bytes);
        return;
      }
      const authenticated = (req.headers.cookie || '')
        .split(/;\s*/)
        .includes('kancha' + server.address().port + '=' + cookie);
      if (!authenticated || req.headers['x-kancha'] !== '1')
        return fail(403, 'Open the local dashboard to begin');
      let result;
      if (req.method === 'GET' && url.pathname === '/api/board') {
        const b = activeStore.board();
        result = { ...b, markers: markers(b), quiet: quiet(b.settings), standaloneDemo: store.demo };
      } else if (req.method === 'GET' && url.pathname === '/api/mcp-config') {
        result = mcpConfig(activeStore.base, activeStore.demo);
      } else if (req.method === 'GET' && url.pathname === '/api/chat') {
        result = chatHistory(activeStore);
      } else if (
        req.method === 'POST' &&
        ['/api/action', '/api/chat', '/api/chat/cancel'].includes(url.pathname)
      ) {
        if (!req.headers['content-type']?.startsWith('application/json'))
          return fail(415, 'Expected JSON');
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 150000) return fail(413, 'Request too large');
          chunks.push(chunk);
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString());
        if (url.pathname === '/api/chat') result = submitChat(activeStore, payload);
        else if (url.pathname === '/api/chat/cancel')
          result = {
            cancelled: !!activeStore.db
              .prepare("UPDATE chat SET status='cancelled' WHERE id=? AND status='waiting'")
              .run(payload.id).changes,
          };
        else if (['read_browser_chat', 'reply_browser_chat'].includes(payload.name))
          return fail(403, 'Use the coding session’s Kancha MCP connection for agent replies.');
        else result = await invoke(activeMap, payload.name, payload.args || {});
      } else return fail(404, 'Route unavailable');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(result));
    } catch (e) {
      fail(400, e.issues?.[0]?.message || e.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let stopped = false;
  async function poll() {
    try {
      await sync(store);
      if (native) await deliver(store);
    } catch (e) {
      console.error('Kancha sync:', e.message);
    }
    if (!stopped) {
      tick = setTimeout(poll, store.settings().interval * 60000);
      tick.unref();
    }
  }
  if (background && !store.demo) tick = setTimeout(poll, 1000);
  server.on('close', () => {
    stopped = true;
    clearTimeout(tick);
    sample?.db.close();
  });
  return server;
}
