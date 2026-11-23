import { callTool, pluginStates, withPlugin, githubAccountRead } from './plugins.js';
import { gh } from './sources.js';
import { ensureFollow } from './handoffs.js';
import { pull } from './projects.js';
const stamp = () => new Date().toISOString();
const readFields = [
  'summary',
  'assignee',
  'project',
  'status',
  'priority',
  'updated',
  'created',
  'resolutiondate',
  'duedate',
];
const readOp = (read, name, cloudId, inputs) =>
  read('executeRead', { name, cloudId, inputs, view: 'full' });
async function listAll(fetch, property) {
  const rows = [];
  for (let startAt = 0; ;) {
    const page = await fetch(startAt);
    if (!Array.isArray(page[property])) throw Error('Unexpected discovery response');
    rows.push(...page[property]);
    startAt += page[property].length;
    if (page.isLast || startAt >= page.total || !page[property].length) return rows;
  }
}
async function issues(fetch) {
  const rows = [],
    tokens = new Set();
  let next;
  do {
    const data = await fetch(next ? { nextPageToken: next } : {});
    if (!Array.isArray(data.issues)) throw Error('Issue listing unavailable');
    rows.push(...data.issues);
    next = data.isLast ? null : data.nextPageToken;
    if ((!next && data.isLast === false) || (next && tokens.has(next)))
      throw Error('Incomplete issue listing');
    tokens.add(next);
  } while (next);
  return rows;
}
function ticket(raw, site, me) {
  const f = raw.fields || {};
  return {
    key: raw.key,
    project: f.project?.key || raw.key.split('-')[0],
    site: site.id,
    title: f.summary || raw.key,
    owner: f.assignee?.displayName || '',
    account: f.assignee?.accountId || '',
    mine: !!me && me === f.assignee?.accountId,
    status: f.status?.name || 'Unknown',
    category: f.status?.statusCategory?.key || 'unknown',
    updated: f.updated,
    created: f.created,
    resolved: f.resolutiondate || null,
    due: f.duedate || null,
    priority: f.priority?.name || '',
  };
}
export async function discoverSite(read, site) {
  const [boards, projects, identity] = await Promise.all([
    listAll(
      (startAt) =>
        readOp(read, 'listJiraBoards', site.id, { startAt, maxResults: 50, includePrivate: true }),
      'values',
    ).catch(() => null),
    listAll(
      (startAt) =>
        readOp(read, 'listJiraProjects', site.id, { startAt, maxResults: 100, action: 'browse' }),
      'values',
    ).catch(() => null),
    readOp(read, 'getJiraCurrentUser', site.id, {}).catch(() => ({})),
  ]);
  const rows = new Map(),
    groups = [];
  let partial = !boards || !projects || !identity.accountId;
  for (const b of boards || []) {
    const group = {
      id: new URL(site.url).origin + '#' + b.id,
      number: b.id,
      name: b.name,
      project: b.location?.projectKey || '',
      keys: [],
      url: new URL('/secure/RapidBoard.jspa?rapidView=' + b.id, site.url).href,
    };
    try {
      const found = await issues((cursor) =>
        readOp(read, 'getJiraBoardIssueData', site.id, {
          boardId: b.id,
          dataset: 'all',
          fields: readFields,
          maxResults: 35,
          ...cursor,
        }),
      );
      for (const r of found) {
        rows.set(r.key, ticket(r, site, identity.accountId));
        group.keys.push(r.key);
      }
    } catch {
      group.partial = true;
      partial = true;
    }
    groups.push(group);
  }
  try {
    const mine = await issues((cursor) =>
      read('searchJiraIssuesUsingJql', {
        cloudId: site.id,
        jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
        fields: readFields,
        maxResults: 100,
        view: 'full',
        ...cursor,
      }),
    );
    for (const r of mine) rows.set(r.key, { ...ticket(r, site, identity.accountId), mine: true });
  } catch {
    partial = true;
  }
  return {
    ...site,
    boards: groups,
    projects: (projects || []).map((p) => ({ key: p.key, name: p.name })),
    tickets: [...rows.values()],
    partial,
  };
}
export async function discoverJira(store) {
  const plugin = pluginStates(store).jira;
  if (!plugin.connected) return;
  const version = store.config('plugin.version.jira', '');
  let sites = [],
    error = '';
  try {
    sites = await withPlugin(store, 'jira', async (client) => {
      const collected = [];
      for (const site of plugin.sites)
        collected.push(await discoverSite((n, a) => callTool(client, n, a), site));
      return collected;
    });
  } catch {
    error = 'Jira discovery could not finish.';
  }
  if (store.config('plugin.version.jira', '') !== version || !pluginStates(store).jira.connected) return;
  store.set('workspace.jira', { version, sites, error, checked: stamp() });
  const prior = store.all(),
    seen = new Set(),
    existing = new Map(prior.filter((i) => i.visible && i.url).map((i) => [i.url, i]));
  for (const s of sites)
    for (const t of s.tickets) {
      if (!t.mine || t.category === 'done') continue;
      const url = new URL('/browse/' + t.key, s.url).href;
      seen.add(url);
      if (existing.has(url) && existing.get(url).source !== 'jira-plugin') continue;
      store.put(
        {
          title: t.title.slice(0, 240),
          project: t.project,
          kind: 'task',
          why: 'Assigned to you in ' + t.project + '.',
          priority: /highest|blocker/i.test(t.priority)
            ? 'urgent'
            : /high/i.test(t.priority)
              ? 'high'
              : 'normal',
          url,
          ...(t.due && /^\d{4}-\d{2}-\d{2}$/.test(t.due)
            ? { due: new Date(t.due + 'T23:59:59').toISOString() }
            : {}),
        },
        'jira-plugin',
        'jira-mcp:' + s.id + ':' + t.key,
        { sourceKey: t.key, ref: t.key, site: s.url },
      );
    }
  for (const i of prior)
    if (i.visible && i.source === 'jira-plugin' && !seen.has(i.url)) store.forget(i);
  for (const site of sites)
    for (const key of new Set([
      ...site.projects.map((p) => p.key),
      ...site.tickets.map((t) => t.project),
    ]))
      ensureFollow(store, site.id, key);
}
export async function discoverGithub(store) {
  const plugin = pluginStates(store).github;
  const version = store.config('plugin.version.github', ''),
    route = plugin.connected ? 'plugin' : 'cli';
  const read = plugin.connected ? (p) => githubAccountRead(store, p) : gh;
  const repos = [],
    pulls = [];
  let partial = false,
    error = false;
  try {
    for (let page = 1; ; page++) {
      const values = await read(
        'user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&page=' +
          page,
      );
      repos.push(...values.map((v) => v.full_name).filter(Boolean));
      if (values.length < 100) break;
    }
    for (let page = 1; page <= 10; page++) {
      const data = await read(
        'search/issues?q=' +
          encodeURIComponent('is:pr is:open involves:@me') +
          '&per_page=100&page=' +
          page,
      );
      if (data.incomplete_results || data.total_count > 1000) partial = true;
      for (const p of data.items || []) {
        if (!pull(p.html_url)) continue;
        pulls.push({
          url: p.html_url,
          title: p.title,
          updated: p.updated_at,
          linkedIssues: [
            ...new Set(
              (p.body || '').match(/https:\/\/[\w.-]+\/browse\/[A-Z][A-Z0-9_]*-[1-9]\d*\b/g) || [],
            ),
          ],
        });
      }
      if ((data.items || []).length < 100) break;
    }
  } catch {
    if (repos.length) partial = true;
    else error = true;
  }
  if (store.config('plugin.version.github', '') === version)
    store.set('workspace.github', { repos, pulls, partial, error, route, version, checked: stamp() });
}
