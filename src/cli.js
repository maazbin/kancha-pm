#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { openStore } from './store.js';
import { serveMcp } from './mcp.js';
import { startServer } from './server.js';
import { seedDemo } from './demo.js';
import { sync } from './sources.js';
import { mcpConfig } from './connections.js';
import { getAdvicePacket, saveAdvice } from './advisor.js';

const cli = fileURLToPath(import.meta.url);
const root = path.dirname(path.dirname(cli));
const [cmd = 'dashboard', ...args] = process.argv.slice(2);
const tpl = mcpConfig(process.env.KANCHA_HOME).mcpServers['kancha-pm'];
function openBrowser(address) {
  const [name, opts] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', address]]
      : process.platform === 'darwin'
        ? ['open', [address]]
        : ['xdg-open', [address]];
  const p = spawn(name, opts, { detached: true, stdio: 'ignore', windowsHide: true });
  p.on('error', () => console.error('Open ' + address + ' in your browser.'));
  p.unref();
}
async function setup() {
  let target = args[0];
  if (!target && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      target =
        (
          await rl.question('Install for codex, claude, or print generic stdio config? [config] ')
        ).trim() || 'config';
    } finally {
      rl.close();
    }
  }
  if (!target || target === 'config') {
    console.log(JSON.stringify({ mcpServers: { 'kancha-pm': tpl } }, null, 2));
    return;
  }
  if (!['codex', 'claude'].includes(target)) throw Error('Choose codex, claude, or config.');
  const destination = path.join(
    os.homedir(),
    target === 'codex' ? '.agents' : '.claude',
    'skills',
    'kancha-personal-pm',
  );
  const source = await readFile(path.join(root, 'skills', 'personal-pm', 'SKILL.md'), 'utf8');
  await mkdir(destination, { recursive: true });
  const skill = path.join(destination, 'SKILL.md');
  const previous = await readFile(skill, 'utf8').catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return '';
  });
  if (previous && !previous.includes('name: kancha-personal-pm'))
    throw Error('An unrelated skill already occupies ' + skill);
  const reg =
    target === 'codex'
      ? ['mcp', 'add', 'kancha-pm', '--', tpl.command, ...tpl.args]
      : ['mcp', 'add', '--scope', 'user', 'kancha-pm', '--', tpl.command, ...tpl.args];
  execFileSync(target, reg, { stdio: 'inherit', windowsHide: true });
  await writeFile(skill, source, { mode: 0o600 });
  const desk = openStore();
  desk.set('advisor.engine', target);
  desk.db.close();
  console.log(
    'Installed the skill and MCP server. Restart your agent and ask: Start my day with Kancha.',
  );
}
async function main() {
  if (cmd === 'status') {
    const port = Number(process.env.KANCHA_PORT || 4317),
      address = 'http://127.0.0.1:' + port;
    let health;
    try {
      health = await fetch(address + '/health', { signal: AbortSignal.timeout(2500) }).then((r) =>
        r.json(),
      );
    } catch {}
    if (health?.app !== 'kancha-pm')
      throw Error(
        'No Kancha worker responding at ' + address + '. Start npm run worker in this environment.',
      );
    console.log(
      (health.demo ? 'Sample' : 'Personal') +
        ' worker is responding at ' +
        address +
        '/. On a remote machine, forward this port to your browser.',
    );
    return;
  }
  if (cmd === 'setup') return setup();
  if (cmd === 'help' || cmd === '--help') {
    console.log(
      'kancha dashboard [--open] [--notify] | demo [--open] | mcp [--demo] | setup [codex|claude|config] | sync | focus',
    );
    return;
  }
  const demo = cmd === 'demo' || args.includes('--demo');
  const store = openStore({ demo });
  if (demo) seedDemo(store);
  if (cmd === 'advice-context' || cmd === 'save-advice') {
    try {
      if (cmd === 'advice-context')
        console.log(JSON.stringify(await getAdvicePacket(store, '', args.slice(0, 4)), null, 2));
      else {
        let input = '';
        for await (const chunk of process.stdin) {
          input += chunk;
          if (input.length > 24000) throw Error('Recommendation too large.');
        }
        console.log(JSON.stringify(saveAdvice(store, JSON.parse(input), 'session')));
      }
    } finally {
      store.db.close();
    }
    return;
  }
  if (cmd === 'mcp') return serveMcp(store);
  if (cmd === 'sync') {
    const b = await sync(store);
    console.log(JSON.stringify(b.sync, null, 2));
    store.db.close();
    return;
  }
  if (cmd === 'focus') {
    const b = store.board();
    console.log(
      JSON.stringify(
        b.agenda.slice(0, 3).map((id) => store.get(id)),
        null,
        2,
      ),
    );
    store.db.close();
    return;
  }
  if (!['dashboard', 'demo'].includes(cmd)) throw Error('Unknown command. Try --help.');
  const port = Number(process.env.KANCHA_PORT || (demo ? 4318 : 4317));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid KANCHA_PORT');
  let server;
  try {
    server = await startServer(store, { port, native: args.includes('--notify') });
  } catch (e) {
    if (e.code === 'EADDRINUSE' && args.includes('--open')) {
      const address = 'http://127.0.0.1:' + port;
      const h = await fetch(address + '/health', { signal: AbortSignal.timeout(2000) })
        .then((r) => r.json())
        .catch(() => null);
      if (h?.app === 'kancha-pm' && h.demo === demo) {
        openBrowser(address);
        return;
      }
    }
    throw e;
  }
  const address = 'http://127.0.0.1:' + server.address().port;
  console.log('Kancha ' + (demo ? 'sample desk' : 'personal workspace') + '  ' + address);
  if (args.includes('--open')) openBrowser(address);
}
main().catch((e) => {
  console.error('Kancha: ' + e.message);
  process.exitCode = 1;
});
