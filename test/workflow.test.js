import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
import { commands, invoke, markers, quiet } from '../src/engine.js';
import { seedDemo } from '../src/demo.js';
import { checkWatch, sync, githubItems, jiraItems } from '../src/sources.js';
import { startServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

function fixture(t, demo = false) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kancha-test-'));
  const s = openStore({ directory, demo });
  t.after(() => {
    s.db.close();
    rmSync(directory, { force: true, recursive: true });
  });
  return s;
}
const action = {
  title: 'Review contract',
  project: 'API',
  kind: 'review',
  why: 'Unblocks an agreed release.',
};
const watch = () => ({
  question: 'Is tax ID optional?',
  owner: 'nora',
  checkAt: new Date(Date.now() + 3600000).toISOString(),
});
test('two clients share an accepted focus and checkpoint across restart', (t) => {
  const s = fixture(t),
    a = s.put(action),
    b = s.put({ ...action, title: 'Other action' });
  s.update(a.id, 'focus');
  s.update(a.id, 'checkpoint', 'Open fixture B');
  const other = openStore({ directory: s.base });
  try {
    assert.equal(other.board().agenda[0], a.id);
    other.update(b.id, 'focus');
    assert.equal(s.get(a.id).stage, 'open');
    assert.equal(s.get(a.id).checkpoint, 'Open fixture B');
    assert.equal(s.board().agenda[0], b.id);
  } finally {
    other.db.close();
  }
});
test('explicit host import is idempotent and revocation drops excerpts', async (t) => {
  const s = fixture(t),
    m = commands(s),
    data = {
      ...action,
      externalKey: 'JIRA/42',
      evidence: [{ label: 'Reference', detail: 'Evidence A' }],
    };
  const a = await invoke(m, 'capture_work', data);
  await invoke(m, 'capture_work', { ...data, title: 'Updated' });
  assert.equal(s.all().length, 1);
  await invoke(m, 'forget_source', { id: a.id });
  assert.equal(s.board().items.length, 0);
  assert.deepEqual(s.get(a.id).evidence, []);
  await assert.rejects(invoke(m, 'prepare_action', { id: a.id }), /scope/);
});
test('new reply needs confirmation, repeated replies deduplicate and handoff clears alert', async (t) => {
  const s = fixture(t),
    i = s.put(action);
  s.watch(i.id, watch());
  const future = new Date(Date.now() + 5000).toISOString();
  const comments = async () => [
    { id: '1', owner: 'other', body: 'Wait', when: future },
    { id: '2', owner: 'nora', body: 'Optional for legacy accounts', when: future },
  ];
  await checkWatch(s, s.get(i.id), comments);
  assert.equal(s.get(i.id).watch.status, 'reply');
  assert.equal(s.get(i.id).stage, 'waiting');
  const count = s.board().activity.length;
  await checkWatch(s, s.get(i.id), comments);
  assert.equal(s.board().activity.length, count);
  s.update(i.id, 'snooze', new Date(Date.now() + 7200000).toISOString());
  assert.equal(markers(s.board()).length, 0);
  s.update(i.id, 'wake');
  assert.equal(markers(s.board()).length, 1);
  s.update(i.id, 'answer', 'Optional for legacy accounts');
  assert.equal(s.board().agenda[0], i.id);
  s.update(i.id, 'focus');
  assert.equal(s.get(i.id).watch.status, 'closed');
  assert.deepEqual(markers(s.board()), []);
});
test('ambiguous replies stay dismissed and never become a confirmed answer', async (t) => {
  const s = fixture(t),
    i = s.put(action);
  s.watch(i.id, watch());
  const at = new Date(Date.now() + 1000).toISOString();
  const comments = async () => [{ id: '1', owner: 'nora', body: 'I will check', when: at }];
  await checkWatch(s, s.get(i.id), comments);
  s.update(i.id, 'dismiss_reply');
  await checkWatch(s, s.get(i.id), comments);
  assert.equal(s.get(i.id).watch.status, 'waiting');
  assert.equal(s.get(i.id).watch.answer, '');
});
test('native source sync keeps private evidence, reconciles scope and retains freshness on outage', async (t) => {
  const s = fixture(t);
  s.configure({ ...s.settings(), repos: ['team/api'] });
  const row = {
    id: 'gh:team/api#1',
    fields: { ...action, project: 'team/api', priority: 'high' },
    extra: { ref: '1' },
  };
  const dependencies = { gitUser: async () => ({ login: 'dev' }), github: async () => [row] };
  await sync(s, dependencies);
  await invoke(commands(s), 'attach_evidence', {
    id: row.id,
    label: 'Document',
    detail: 'Acceptance criterion B',
  });
  await sync(s, dependencies);
  assert.equal(s.get(row.id).evidence[0].detail, 'Acceptance criterion B');
  const success = s.board().sync['github:team/api'].lastSuccess;
  await sync(s, {
    ...dependencies,
    github: async () => {
      throw Error('Offline');
    },
  });
  assert.equal(s.board().sync['github:team/api'].lastSuccess, success);
  assert.equal(s.board().items.length, 1);
  s.update(row.id, 'checkpoint', 'Fixture B');
  s.configure({ ...s.settings(), repos: [] });
  assert.equal(s.board().items.length, 0);
  assert.deepEqual(s.get(row.id).evidence, []);
  assert.equal(s.get(row.id).checkpoint, 'Fixture B');
});
test('GitHub reader paginates and returns only personal assignments and review requests', async () => {
  const requested = {
    number: 3,
    title: 'Check me',
    html_url: 'https://github.com/t/r/pull/3',
    user: { login: 'author' },
    requested_reviewers: [{ login: 'ME' }],
  };
  const others = Array.from({ length: 100 }, (_, i) => ({
    ...requested,
    number: 10 + i,
    requested_reviewers: [],
  }));
  const calls = [];
  const rows = await githubItems('t/r', 'me', async (route) => {
    calls.push(route);
    if (route.includes('/issues?')) return [];
    return route.endsWith('page=1') ? others : [requested];
  });
  assert.equal(calls.length, 3);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'gh:t/r#3');
});
test('Jira reader uses currentUser and follows next-page tokens', async () => {
  const calls = [];
  const rows = await jiraItems('https://team.atlassian.net', 'API', async (route, body) => {
    calls.push(body);
    return body.nextPageToken
      ? { issues: [] }
      : {
          issues: [
            {
              key: 'API-1',
              fields: {
                summary: 'Review contract',
                duedate: '2027-01-20',
                description: { type: 'doc', content: [{ type: 'text', text: 'Text' }] },
              },
            },
          ],
          nextPageToken: 'next',
        };
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].jql, /assignee = currentUser/);
  assert.equal(rows[0].extra.ref, 'API-1');
  assert.equal(rows[0].fields.evidence[0].detail, 'Text');
});
test('local server enforces origin, session, and separates sample from live writes', async (t) => {
  const s = fixture(t);
  const server = await startServer(s, { port: 0, background: false });
  try {
    const url = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(url + '/api/board')).status, 403);
    const page = await fetch(url + '/');
    const cookie = page.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, 'x-kancha': '1', 'content-type': 'application/json' };
    assert.equal(
      (
        await fetch(url + '/api/action', {
          method: 'POST',
          headers: { ...headers, origin: 'https://example.com' },
          body: '{}',
        })
      ).status,
      403,
    );
    const r = await fetch(url + '/sample/api/board', { headers });
    assert.equal((await r.json()).demo, true);
    await fetch(url + '/sample/api/action', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'capture_work', args: action }),
    });
    const live = await (await fetch(url + '/api/board', { headers })).json();
    assert.deepEqual(live.items, []);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test('MCP SDK connects over stdio, tools survive a new process', async (t) => {
  const s = fixture(t),
    file = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  for (const phase of ['write', 'read']) {
    const client = new Client({ name: 'kancha-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [file, 'mcp'],
      env: { ...process.env, KANCHA_HOME: s.base },
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(tools.tools.some((x) => x.name === 'watch_for'));
      if (phase === 'write')
        assert.ok(!(await client.callTool({ name: 'capture_work', arguments: action })).isError);
      const b = await client.callTool({ name: 'get_my_focus', arguments: {} });
      assert.equal(JSON.parse(b.content[0].text).items[0].title, action.title);
    } finally {
      await client.close();
    }
  }
});
test('sample data stays isolated and seed is repeatable', (t) => {
  const s = fixture(t, true);
  seedDemo(s);
  seedDemo(s);
  assert.equal(s.all().length, 5);
  assert.equal(s.board().agenda[0], 'checkout');
});
test('quiet hours work across midnight and when disabled', () => {
  const at = (h) => new Date(2026, 0, 1, h, 0);
  assert.ok(quiet({ quietStart: 19, quietEnd: 8 }, at(5)));
  assert.ok(!quiet({ quietStart: 19, quietEnd: 8 }, at(8)));
  assert.ok(!quiet({ quietStart: 9, quietEnd: 9 }, at(9)));
});
