import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../src/store.js';
import { pluginAction, pluginStates, finishPlugin, pluginRead } from '../src/plugins.js';
import { teamAction } from '../src/team.js';
const origin = 'http://127.0.0.1:4317';
test('OAuth consent binds the browser and verifier; a later 401 refreshes access', async (t) => {
  const store = desk(t);
  const issuer = 'https://auth.atlassian.com',
    resource = 'https://mcp.atlassian.com/v2/mcp';
  let refreshes = 0,
    expired = false;
  t.mock.method(globalThis, 'fetch', async (url, opt = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('oauth-protected-resource'))
      return response({ resource, authorization_servers: [issuer] });
    if (u.pathname.includes('well-known'))
      return response({
        issuer,
        authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token',
        registration_endpoint: issuer + '/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    if (u.pathname === '/register')
      return response({ ...JSON.parse(opt.body), client_id: 'fixture' }, 201);
    if (u.pathname === '/token') {
      const form = new URLSearchParams(opt.body);
      if (form.get('grant_type') === 'refresh_token') {
        refreshes++;
        assert.equal(form.get('refresh_token'), 'refresh');
      } else {
        assert.ok(form.get('code_verifier'));
        assert.equal(form.get('code'), 'returned');
      }
      return response({
        access_token: refreshes ? 'renewed' : 'initial',
        token_type: 'Bearer',
        refresh_token: 'refresh',
      });
    }
    if (opt.method !== 'POST') return response(null, 405);
    const hdr = new Headers(opt.headers).get('authorization');
    if (!hdr || (expired && hdr === 'Bearer initial'))
      return response(null, 401, {
        'www-authenticate':
          'Bearer resource_metadata="https://mcp.atlassian.com/.well-known/oauth-protected-resource"',
      });
    const req = JSON.parse(opt.body);
    if (req.method.startsWith('notifications/')) return response(null, 202);
    const result =
      req.method === 'initialize'
        ? {
            protocolVersion: req.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'test', version: '1' },
          }
        : {
            content: [
              {
                type: 'text',
                text: JSON.stringify([{ id: 'test', url: 'https://example.atlassian.net' }]),
              },
            ],
          };
    return response({ jsonrpc: '2.0', id: req.id, result });
  });
  const flow = await pluginAction(store, { id: 'jira', action: 'signin' }, origin);
  const redirect = new URL(flow.authorize);
  assert.equal(redirect.searchParams.get('state'), flow.state);
  assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
  const query = new URLSearchParams({ state: flow.state, code: 'returned' });
  await assert.rejects(finishPlugin(store, 'jira', query, '', origin), /expired/);
  await finishPlugin(store, 'jira', query, 'kancha_oauth=' + flow.state, origin);
  assert.equal(pluginStates(store).jira.connected, true);
  expired = true;
  await pluginAction(store, { id: 'jira', action: 'check' }, origin);
  assert.equal(refreshes, 1);
  await assert.rejects(
    finishPlugin(store, 'jira', query, 'kancha_oauth=' + flow.state, origin),
    /expired/,
  );
});
function desk(t, demo = false) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kancha-plugin-')),
    store = openStore({ directory, demo });
  t.after(() => {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}
function response(data, status = 200, headers = {}) {
  return new Response(data == null ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
function provider(t, credential) {
  let changes = 0,
    title = 'Review A',
    stamp = '2026-11-01T12:00:00Z';
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const u = new URL(url);
    if (u.hostname !== 'mcp.atlassian.com') throw Error('Unexpected origin');
    const headers = new Headers(opts.headers);
    if (headers.get('authorization') !== credential) return response({}, 403);
    if (opts.method !== 'POST') return response(null, 405);
    const body = JSON.parse(opts.body);
    if (body.method?.startsWith('notifications/')) return response(null, 202);
    const rpc = (result) => response({ jsonrpc: '2.0', id: body.id, result });
    if (body.method === 'initialize')
      return rpc({
        protocolVersion: body.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      });
    const { name, arguments: a } = body.params;
    const ticket = {
      key: 'QA-1',
      fields: {
        summary: title,
        updated: stamp,
        status: { name: 'To do' },
        assignee: { accountId: 'maz', displayName: 'Maz' },
      },
    };
    let data;
    if (name === 'getAccessibleAtlassianResources')
      data = {
        resources: [
          { cloudId: 'site1', url: 'https://example.atlassian.net', products: [{ id: 'jira' }] },
        ],
      };
    else if (name === 'executeRead')
      data =
        a.name === 'listJiraProjects'
          ? { values: [{ key: 'QA', name: 'Quality' }], isLast: true }
          : a.name === 'listJiraIssueTransitions'
            ? { transitions: [] }
            : [];
    else if (name === 'searchJiraIssuesUsingJql') {
      assert.equal(a.jql, 'project = "QA" ORDER BY updated DESC');
      data = { issues: [ticket], isLast: true };
    } else if (name === 'getJiraIssue') data = ticket;
    else if (name === 'editJiraIssue') {
      changes++;
      title = a.fields.summary;
      stamp = new Date().toISOString();
      data = ticket;
    } else throw Error('Unexpected operation ' + name);
    return rpc({ content: [{ type: 'text', text: JSON.stringify({ data }) }] });
  });
  return () => changes;
}
test('token verification, encrypted storage, colleague reads, reviewed write and disconnect', async (t) => {
  const store = desk(t),
    token = 'fixture-secret',
    email = 'dev@example.org';
  const changed = provider(t, 'Basic ' + Buffer.from(email + ':' + token).toString('base64'));
  await pluginAction(store, { id: 'jira', action: 'token', email, token }, origin);
  assert.equal(pluginStates(store).jira.connected, true);
  assert.ok(!JSON.stringify(store.config('plugin.secret.jira')).includes(token));
  const call = (action, extra = {}) =>
    teamAction(store, { action, site: 'site1', project: 'QA', ...extra });
  assert.equal((await call('projects')).projects[0].key, 'QA');
  const row = (await call('tickets')).items[0];
  assert.equal(row.owner, 'Maz');
  const edit = { field: 'summary', value: 'Updated title', updated: row.updated };
  const a = await call('preview', { key: row.key, edit }),
    b = await call('preview', { key: row.key, edit });
  assert.equal(changed(), 0);
  await call('commit', { review: a.review });
  await assert.rejects(call('commit', { review: a.review }), /expired/);
  await assert.rejects(call('commit', { review: b.review }), /changed/);
  assert.equal(changed(), 1);
  await pluginAction(store, { id: 'jira', action: 'disconnect' }, origin);
  assert.equal(store.config('plugin.secret.jira'), null);
  await assert.rejects(call('tickets'), /Connect Jira/);
  await assert.rejects(
    finishPlugin(store, 'jira', new URLSearchParams('state=wrong&code=bad'), '', origin),
    /expired/,
  );
  await assert.rejects(pluginRead(store, 'jira', 'editJiraIssue'), /Choose GitHub or Slack/);
});
