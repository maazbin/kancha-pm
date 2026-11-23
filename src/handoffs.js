import { randomUUID } from 'node:crypto';
import { callTool, pluginStates, withPlugin } from './plugins.js';
import { commentBody } from './ticket-history.js';

const stateKey = (s) => 'handoffs.' + s.config('plugin.version.jira', s.demo ? 'sample' : '');
const initial = (s) =>
  s.demo
    ? [
        {
          site: 'sample',
          project: 'APP',
          token: 'sample',
          checked: '2026-01-01T09:25:00Z',
          alerts: [{ id: 'APP-24:7', key: 'APP-24', comment: '7' }],
          seen: [],
        },
      ]
    : [];
function scopes(s) {
  return s.config(stateKey(s), initial(s));
}
function edit(s, fn) {
  return s.tx(() => {
    const rows = scopes(s);
    fn(rows);
    s.set(stateKey(s), rows);
  });
}
export function handoffDesk(s) {
  const plugin = pluginStates(s).jira;
  return scopes(s)
    .filter((r) => s.demo || (plugin.connected && plugin.sites?.some((x) => x.id === r.site)))
    .map((r) => ({
      site: r.site,
      project: r.project,
      checked: r.checked || null,
      note: r.note || '',
      failed: !!r.failed,
      recent: r.failed ? [] : r.recent || [],
      unread: r.failed ? [] : (r.alerts || []).filter((a) => !r.seen?.includes(a.id)),
    }));
}
export function setFollow(s, site, project, enabled) {
  const k = stateKey(s) + '.muted',
    id = JSON.stringify([site, project]);
  const muted = new Set(s.config(k, []));
  if (enabled) muted.delete(id);
  else muted.add(id);
  s.set(k, [...muted]);
  edit(s, (rows) => {
    const i = rows.findIndex((x) => x.site === site && x.project === project);
    if (enabled && i < 0) rows.push({ site, project, token: randomUUID(), alerts: [], seen: [] });
    if (!enabled && i >= 0) rows.splice(i, 1);
  });
}
export function ensureFollow(s, site, project) {
  if (
    !s.config(stateKey(s) + '.muted', []).includes(JSON.stringify([site, project])) &&
    !scopes(s).some((r) => r.site === site && r.project === project)
  )
    setFollow(s, site, project, true);
}
export function acknowledge(s, site, project, id) {
  edit(s, (rows) => {
    const scope = rows.find((x) => x.site === site && x.project === project);
    if (scope?.alerts.some((x) => x.id === id) && !scope.seen.includes(id)) scope.seen.push(id);
  });
}
export async function scanComments(read, site, project, previous = {}, started = Date.now()) {
  const me = await read('executeRead', { name: 'getJiraCurrentUser', cloudId: site, inputs: {} });
  if (!me.accountId) throw Error('Could not verify the Jira account.');
  const twoDaysAgo = started - 48 * 3600000;
  const since =
    previous.account === me.accountId && Number.isFinite(previous.cursor)
      ? Math.min(started, previous.cursor) - 300000
      : twoDaysAgo;
  const minutes = Math.max(1, Math.ceil((started - since) / 60000));
  const alerts = [],
    recent = [],
    visited = new Set(),
    tokens = new Set();
  let partial = false,
    token;
  async function scanIssue(issue) {
    if (visited.has(issue.key)) return;
    visited.add(issue.key);
    if (Date.parse(issue.fields?.created) >= twoDaysAgo)
      recent.push({ key: issue.key, at: issue.fields.created });
    if (commentBody(issue.fields?.description).mentions.some((m) => m.id === me.accountId))
      alerts.push({ id: issue.key + ':description', key: issue.key });
    let startAt = 0;
    while (true) {
      const data = await read('listJiraIssueComments', {
        cloudId: site,
        issueIdOrKey: issue.key,
        view: 'full',
        orderBy: '-created',
        responseContentFormat: 'html',
        startAt,
        maxResults: 20,
      });
      if (!Array.isArray(data.comments)) throw Error();
      for (const c of data.comments) {
        if (Date.parse(c.created) < since) return;
        if (c.id && commentBody(c.body).mentions.some((m) => m.id === me.accountId))
          alerts.push({ id: issue.key + ':' + c.id, key: issue.key, comment: String(c.id) });
      }
      startAt += data.comments.length;
      if (data.isLast === true || startAt >= data.total) return;
      if (!data.comments.length || !Number.isInteger(data.total)) {
        partial = true;
        return;
      }
    }
  }
  do {
    const data = await read('searchJiraIssuesUsingJql', {
      cloudId: site,
      jql:
        'project = "' + project + '" AND updated >= "-' + minutes + 'm" ORDER BY updated DESC, key ASC',
      fields: ['updated', 'created', 'description'],
      responseContentFormat: 'html',
      view: 'full',
      maxResults: 25,
      ...(token ? { nextPageToken: token } : {}),
    });
    if (!Array.isArray(data.issues)) throw Error('Could not read recent Jira tickets.');
    for (let i = 0; i < data.issues.length; i += 4) {
      const results = await Promise.allSettled(data.issues.slice(i, i + 4).map(scanIssue));
      if (results.some((r) => r.status === 'rejected')) partial = true;
    }
    token = data.isLast === true ? null : data.nextPageToken;
    if (data.isLast === false && !token) partial = true;
    if (token && tokens.has(token)) {
      partial = true;
      break;
    }
    if (token) tokens.add(token);
  } while (token);
  return { alerts, recent, partial, account: me.accountId, cursor: partial ? since + 300000 : started };
}
export async function scanHandoffs(s, only) {
  const generation = stateKey(s);
  for (const r of scopes(s)) {
    if (only && (r.site !== only.site || r.project !== only.project)) continue;
    const leaseKey = 'scan:' + generation + ':' + r.token;
    const lease = s.acquire(leaseKey, 20 * 60000);
    if (!lease) continue;
    try {
      let outcome;
      try {
        outcome = s.demo
          ? {
              alerts: r.project === 'APP' ? [{ id: 'APP-24:7', key: 'APP-24', comment: '7' }] : [],
              account: 'maz',
            }
          : await withPlugin(s, 'jira', (c) =>
              scanComments((n, a) => callTool(c, n, a), r.site, r.project, r),
            );
      } catch {
        outcome = null;
      }
      if (generation !== stateKey(s)) continue;
      edit(s, (rows) => {
        const x = rows.find((i) => i.token === r.token);
        if (!x) return;
        x.failed = !outcome;
        if (!outcome) {
          x.note = 'Check Jira access and try again.';
          return;
        }
        if (x.account && x.account !== outcome.account) {
          x.alerts = [];
          x.seen = [];
          x.recent = [];
        }
        x.account = outcome.account;
        x.cursor = outcome.cursor;
        x.recent = [
          ...new Map(
            [...(x.recent || []), ...(outcome.recent || [])]
              .filter((v) => Date.parse(v.at) >= Date.now() - 48 * 3600000)
              .map((v) => [v.key, v]),
          ).values(),
        ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        x.checked = new Date().toISOString();
        x.note = outcome.partial ? 'Coverage is partial. Open Jira for additional activity.' : '';
        // Persist only private reminders with source identifiers, never colleagues’ comment text.
        const saved = new Map(
          (x.alerts || []).filter((a) => !x.seen.includes(a.id)).map((a) => [a.id, a]),
        );
        for (const a of outcome.alerts) saved.set(a.id, a);
        x.alerts = [...saved.values()];
      });
    } finally {
      s.release(leaseKey, lease);
    }
  }
}
