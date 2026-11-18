import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { realpathSync } from 'node:fs';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStore } from '../src/store.js';
import { commands, invoke } from '../src/engine.js';
import { startServer } from '../src/server.js';

const a = 'https://red.atlassian.net',
  b = 'https://blue.atlassian.net',
  pr = 'https://github.com/acme/api/pull/3',
  issue = (s) => s + '/browse/API-12',
  board = (s, id) => s + '/jira/software/c/projects/API/boards/' + id;
function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kancha-maps-'));
  const store = openStore({ directory });
  t.after(() => {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const m = commands(store);
  return { store, call: (name, args) => invoke(m, name, args) };
}
const work = {
  title: 'API-12: refine checkout',
  project: 'acme/api',
  kind: 'review',
  why: 'Reviewer requested',
  url: pr,
};
test('overlapping boards and colliding keys remain independent across sites', async (t) => {
  const { call, store } = setup(t);
  for (const [site, id] of [
    [a, 1],
    [a, 2],
    [b, 1],
  ]) {
    const url = board(site, id);
    await call('follow_board', { url, name: 'Delivery', repos: ['acme/api'] });
    await call('observe_board', { boardUrl: url, issues: [issue(site)], complete: true });
  }
  const p = await call('capture_work', work);
  await call('capture_work', { ...work, externalKey: 'another reader', url: pr + '?ref=review' });
  assert.equal(store.board().items.length, 1);
  let brief = await call('prepare_action', { id: p.id });
  assert.deepEqual(brief.item.mapping.candidates.sort(), [issue(a), issue(b)].sort());
  assert.equal(brief.item.mapping.boards.length, 0);
  await call('confirm_pr_issue', { prUrl: pr, issueUrl: issue(a), enabled: true });
  await call('observe_board', { boardUrl: board(a, 1), issues: [], complete: false });
  assert.equal((await call('prepare_action', { id: p.id })).item.mapping.boards.length, 2);
  await call('observe_board', { boardUrl: board(a, 1), issues: [], complete: true });
  assert.deepEqual((await call('prepare_action', { id: p.id })).item.mapping.boards, [a + '#2']);
  await assert.rejects(
    call('observe_board', { boardUrl: board(a, 2), issues: [issue(b)], complete: true }),
    /same Jira site/,
  );
  assert.equal((await call('project_scope', {})).boards.length, 3);
});
test('one PR joins two tickets and multiple worktrees only by matching origin', async (t) => {
  const { call, store } = setup(t);
  const roots = [];
  for (const [folder, origin] of [
    ['client-a', 'git@github.com:Acme/api.git'],
    ['client-b', 'https://github.com/acme/api.git'],
    ['other', 'https://github.com/acme/other'],
  ]) {
    const dir = path.join(store.base, folder);
    mkdirSync(dir);
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', origin]);
    await call('register_checkout', { path: dir });
    roots.push(dir);
  }
  await call('follow_repo', { repo: 'acme/api' });
  await call('follow_repo', { repo: 'acme/other' });
  const p = await call('capture_work', { ...work, linkedIssues: [issue(a), issue(b)] });
  const ticket = await call('capture_work', { ...work, url: issue(b), kind: 'task' });
  const h = await call('prepare_action', { id: p.id }),
    j = await call('prepare_action', { id: ticket.id });
  assert.deepEqual(
    h.checkoutOptions.map((p) => realpathSync.native(p)).sort(),
    roots
      .slice(0, 2)
      .map((p) => realpathSync.native(p))
      .sort(),
  );
  assert.equal(h.checkout, null);
  assert.deepEqual(j.item.mapping.relatedPRs, [pr]);
  assert.equal(h.item.mapping.links.length, 2);
  assert.equal((await call('project_scope', {})).repositories.length, 2);
});
test('localhost and numeric loopback are accepted while foreign origins remain rejected', async (t) => {
  const { store } = setup(t);
  const s = await startServer(store, { port: 0, background: false });
  try {
    const port = s.address().port,
      url = 'http://127.0.0.1:' + port;
    const status = (host) =>
      new Promise((resolve, reject) =>
        http
          .get(url + '/health', { headers: { host } }, (r) => {
            r.resume();
            resolve(r.statusCode);
          })
          .on('error', reject),
      );
    assert.equal(await status('localhost:' + port), 200);
    assert.equal(await status('other.example:' + port), 403);
  } finally {
    s.closeAllConnections();
    await new Promise((done) => s.close(done));
  }
});
