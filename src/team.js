import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callTool, pluginStates, withPlugin } from './plugins.js';
import { sampleHistory, ticketHistory } from './ticket-history.js';
import { setFollow, handoffDesk, acknowledge, scanHandoffs } from './handoffs.js';

const fields = ['summary', 'assignee', 'status', 'priority', 'updated', 'duedate'];
const staged = new WeakMap();
const projectKey = z.string().regex(/^[A-Z][A-Z0-9_]{0,50}$/);
const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9]\d*$/);
const editInput = z.object({
  field: z.enum(['summary', 'assignee', 'status', 'priority', 'duedate', 'comment', 'create']),
  value: z.string().trim().max(3000),
  type: z.string().trim().min(1).max(80).optional(),
  updated: z.string().optional(),
});
const exampleSite = { id: 'sample', url: 'https://example.atlassian.net' };
const seed = [
  ['APP-17', 'Confirm the checkout retry rule', 'Nadia', 'In progress', 'High'],
  ['APP-19', 'Review the receipt copy', 'Maz', 'In review', 'Medium'],
  ['APP-22', 'Prepare the release checklist', '', 'To do', 'Medium'],
  ['APP-24', 'Bring up the sandbox testing environment', 'Iman', 'In progress', 'High'],
].map(([key, summary, owner, status, priority]) => ({
  key,
  summary,
  owner,
  account: owner.toLowerCase(),
  status,
  priority,
  updated: '2026-01-01T00:00:00Z',
  due: null,
}));
function issue(raw) {
  const f = raw.fields || {};
  return {
    key: raw.key,
    summary: f.summary || raw.key,
    owner: f.assignee?.displayName || '',
    account: f.assignee?.accountId || '',
    status: f.status?.name || '',
    done: f.status?.statusCategory?.key === 'done',
    priority: f.priority?.name || '',
    updated: f.updated || '',
    due: f.duedate || null,
  };
}
const sampleOptions = {
  status: [
    { id: 'To do', name: 'To do' },
    { id: 'In progress', name: 'In progress' },
    { id: 'Done', name: 'Done' },
  ],
  assignee: [
    { id: 'nadia', name: 'Nadia' },
    { id: 'maz', name: 'Maz' },
  ],
  priority: ['Low', 'Medium', 'High'].map((x) => ({ id: x, name: x })),
};
function validateEdit(data, options) {
  const { field, value } = data;
  if (!value && !['duedate', 'assignee'].includes(field)) throw Error('Enter a value for the change.');
  if (
    field === 'duedate' &&
    value &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value)
  )
    throw Error('Choose a valid due date.');
  if (['create', 'summary'].includes(field) && value.length > 255)
    throw Error('Keep the title within 255 characters.');
  if (['status', 'assignee'].includes(field) && value && !options[field].some((x) => x.id === value))
    throw Error('Choose an available Jira option.');
}
function sample(store) {
  const rows = store.config('team.demo', structuredClone(seed));
  if (!rows.some((r) => r.key === 'APP-24')) rows.push({ ...seed[3] });
  return rows;
}
async function access(store, fn) {
  return withPlugin(store, 'jira', (c) => fn((name, args) => callTool(c, name, args)));
}
const readOp = (read, name, cloudId, inputs) => read('executeRead', { name, cloudId, inputs });
async function optionsFor(read, site, key) {
  const [trans, users] = await Promise.allSettled([
    readOp(read, 'listJiraIssueTransitions', site, { issueIdOrKey: key }),
    readOp(read, 'listJiraIssueAssignableUsers', site, { issueKey: key }),
  ]);
  const t = trans.value?.transitions || [],
    u = users.value;
  return {
    status: t
      .filter((x) => x.isAvailable !== false)
      .map((x) => ({ id: String(x.id), name: x.to?.name || x.name })),
    assignee: (Array.isArray(u) ? u : u?.users || u?.values || [])
      .map((x) => ({ id: x.accountId, name: x.displayName }))
      .filter((x) => x.id),
    priority: [],
  };
}
function previewMap(store) {
  if (!staged.has(store)) staged.set(store, new Map());
  return staged.get(store);
}
export async function teamAction(store, p) {
  if (p.action === 'inbox') return { scopes: handoffDesk(store) };
  const sites = store.demo ? [exampleSite] : pluginStates(store).jira.sites || [];
  if (p.action === 'sites')
    return { sites: store.demo || pluginStates(store).jira.connected ? sites : [] };
  const site = sites.find((s) => s.id === p.site);
  if (!site || (!store.demo && !pluginStates(store).jira.connected))
    throw Error('Connect Jira and choose a site you can access.');
  if (p.action === 'projects') {
    if (store.demo) return { projects: [{ key: 'APP', name: 'Checkout delivery' }] };
    return access(store, async (read) => {
      const projects = [];
      let startAt = 0;
      do {
        const data = await readOp(read, 'listJiraProjects', site.id, {
          action: 'browse',
          startAt,
          maxResults: 100,
        });
        const rows = data.values || [];
        projects.push(...rows.map((x) => ({ key: x.key, name: x.name })));
        startAt += rows.length;
        if (data.isLast === true || !rows.length || startAt >= data.total) break;
      } while (true);
      return { projects };
    });
  }
  const project = projectKey.parse(p.project);
  if (store.demo && project !== 'APP') throw Error('Choose the sample project.');
  if (p.action === 'follow' || p.action === 'check' || p.action === 'acknowledge') {
    if (p.action === 'follow') setFollow(store, site.id, project, z.boolean().parse(p.enabled));
    if (p.action === 'acknowledge')
      acknowledge(store, site.id, project, z.string().max(200).parse(p.id));
    if (p.action === 'check' || (p.action === 'follow' && p.enabled))
      await scanHandoffs(store, { site: site.id, project });
    return { scopes: handoffDesk(store) };
  }
  if (p.action === 'timeline') {
    const key = issueKey.parse(p.key);
    if (!key.startsWith(project + '-')) throw Error('Choose a ticket from this project.');
    if (!store.demo) return access(store, (read) => ticketHistory(read, site, key));
    const row = sample(store).find((r) => r.key === key);
    if (!row) throw Error('Ticket unavailable.');
    return sampleHistory(row);
  }
  if (p.action === 'search') {
    const query = z.string().trim().min(2).max(150).parse(p.query);
    const terms = [
      ...new Set((query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 1)),
    ].slice(0, 6);
    if (!terms.length) throw Error('Enter a word from the work or a ticket key.');
    if (store.demo)
      return {
        items: sample(store).filter(
          (r) =>
            r.key.toLowerCase() === query.toLowerCase() ||
            terms.some((t) => r.summary.toLowerCase().includes(t)),
        ),
        partial: false,
      };
    const match = issueKey.safeParse(query.toUpperCase()).success
      ? 'key = "' + query.toUpperCase() + '"'
      : terms.map((t) => 'text ~ "' + t + '"').join(' OR ');
    return access(store, async (read) => {
      const data = await read('searchJiraIssuesUsingJql', {
        cloudId: site.id,
        jql: 'project = "' + project + '" AND (' + match + ') ORDER BY updated DESC',
        fields,
        view: 'full',
        maxResults: 40,
      });
      return {
        items: (data.issues || []).map(issue),
        partial: !!data.nextPageToken || data.isLast === false,
      };
    });
  }
  if (p.action === 'people') {
    const query = z.string().trim().min(1).max(100).parse(p.query);
    if (store.demo)
      return {
        people: sampleOptions.assignee.filter((u) => u.name.toLowerCase().includes(query.toLowerCase())),
      };
    return access(store, async (read) => {
      const data = await readOp(read, 'listJiraIssueAssignableUsers', site.id, { project, query });
      return {
        people: (Array.isArray(data) ? data : data.users || data.values || [])
          .filter((u) => u.accountId)
          .map((u) => ({ id: u.accountId, name: u.displayName })),
      };
    });
  }
  if (p.action === 'tickets') {
    const owner =
      p.owner === undefined
        ? '*'
        : z
            .string()
            .max(150)
            .regex(/^(?:\*|[\w:.@-]*)$/)
            .parse(p.owner);
    const clause =
      owner === '*' ? '' : owner ? ' AND assignee = "' + owner + '"' : ' AND assignee IS EMPTY';
    if (store.demo)
      return { items: sample(store).filter((r) => owner === '*' || r.account === owner), next: null };
    return access(store, async (read) => {
      const data = await read('searchJiraIssuesUsingJql', {
        cloudId: site.id,
        jql: 'project = "' + project + '"' + clause + ' ORDER BY updated DESC',
        fields,
        view: 'full',
        maxResults: 100,
        ...(p.next ? { nextPageToken: z.string().max(12000).parse(p.next) } : {}),
      });
      return {
        items: (data.issues || []).map(issue),
        next: data.isLast === true ? null : data.nextPageToken || null,
      };
    });
  }
  const map = previewMap(store);
  for (const [k, v] of map) if (v.expires < Date.now()) map.delete(k);
  if (p.action === 'commit') {
    const plan = map.get(p.review);
    if (!plan || plan.site !== site.id || plan.project !== project)
      throw Error('This review has expired or was already used. Refresh the ticket.');
    map.delete(p.review);
    if (plan.version !== store.config('plugin.version.jira', ''))
      throw Error('The Jira connection changed. Review this change again.');
    const { key, edit } = plan;
    if (store.demo) {
      return store.tx(() => {
        const rows = sample(store),
          row = rows.find((i) => i.key === key);
        if (row && row.updated !== plan.before.updated)
          throw Error('This ticket changed. Refresh and review again.');
        if (edit.field === 'create')
          rows.push({
            ...seed[2],
            key: 'APP-' + (Math.max(...rows.map((i) => Number(i.key.split('-')[1]))) + 1),
            summary: edit.value,
            created: new Date().toISOString(),
            creator: 'Maz',
            updated: new Date().toISOString(),
          });
        else {
          if (!row) throw Error('Ticket unavailable.');
          if (edit.field === 'assignee') {
            row.owner = plan.after;
            row.account = edit.value;
          } else if (edit.field === 'comment') {
            row.comments = [...(row.comments || []), edit.value];
          } else row[{ duedate: 'due' }[edit.field] || edit.field] = edit.value;
          if (edit.field === 'status') row.done = edit.value === 'Done';
          row.updated = new Date().toISOString();
          row.events = [
            ...(row.events || []),
            {
              id: randomUUID(),
              kind: edit.field === 'comment' ? 'comment' : 'change',
              actor: 'Maz',
              at: row.updated,
              title: edit.field === 'comment' ? 'Commented' : 'Changed ' + edit.field,
              body: edit.field === 'comment' ? edit.value : plan.after,
            },
          ];
        }
        store.set('team.demo', rows);
        return { saved: true };
      });
    }
    return access(store, async (read) => {
      if (key) {
        const current = issue(
          await read('getJiraIssue', { cloudId: site.id, issueIdOrKey: key, fields, view: 'full' }),
        );
        if (!current.updated || current.updated !== plan.before.updated)
          throw Error('This ticket changed. Refresh and review again.');
      }
      const args = { cloudId: site.id, issueIdOrKey: key };
      if (edit.field === 'create')
        await read('createJiraIssue', {
          cloudId: site.id,
          projectKey: project,
          issueType: edit.type || 'Task',
          summary: edit.value,
        });
      else if (edit.field === 'status')
        await read('transitionJiraIssue', { ...args, transitionId: edit.value });
      else if (edit.field === 'comment')
        await read('addOrEditJiraIssueComment', { ...args, commentBody: edit.value });
      else {
        const value =
          edit.field === 'assignee'
            ? edit.value
              ? { accountId: edit.value }
              : null
            : edit.field === 'priority'
              ? { name: edit.value }
              : edit.value || null;
        await read('editJiraIssue', { ...args, fields: { [edit.field]: value } });
      }
      return { saved: true };
    });
  }
  if (!['details', 'preview'].includes(p.action)) throw Error('Unknown team action.');
  const edit = p.action === 'preview' ? editInput.parse(p.edit) : null;
  const key = edit?.field === 'create' ? null : issueKey.parse(p.key);
  if (key && !key.startsWith(project + '-')) throw Error('Choose a ticket from this project.');
  const detail = key
    ? store.demo
      ? { ticket: sample(store).find((i) => i.key === key), options: sampleOptions }
      : await access(store, async (read) => {
          const ticket = issue(
            await read('getJiraIssue', { cloudId: site.id, issueIdOrKey: key, fields, view: 'full' }),
          );
          const options = await optionsFor(read, site.id, key);
          return { ticket, options };
        })
    : { ticket: null, options: {} };
  if (key && !detail.ticket) throw Error('This ticket is unavailable.');
  if (!edit) return detail;
  if (key && (!detail.ticket.updated || detail.ticket.updated !== edit.updated))
    throw Error('This ticket changed. Refresh and review again.');
  validateEdit(edit, detail.options);
  const review = randomUUID(),
    after =
      detail.options[edit.field]?.find((x) => x.id === edit.value)?.name || edit.value || 'Unassigned';
  map.set(review, {
    site: site.id,
    project,
    key,
    edit,
    before: detail.ticket,
    after,
    version: store.config('plugin.version.jira', ''),
    expires: Date.now() + 300000,
  });
  const oldField = { assignee: 'owner', duedate: 'due' }[edit.field] || edit.field;
  return {
    review,
    before: detail.ticket?.[oldField] || '',
    after: edit.field === 'duedate' && !edit.value ? 'No due date' : after,
    key: key || project,
  };
}
