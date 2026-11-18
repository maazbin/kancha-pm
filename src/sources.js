import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { now } from './store.js';

const run = promisify(execFile);
const clean = (v, n = 3000) =>
  String(v || '')
    .trim()
    .slice(0, n);
function sourceError(name, status) {
  const e = Error(
    name +
      (status ? ' returned HTTP ' + status : ' is unavailable') +
      '. Check authentication, scope, and connection.',
  );
  e.status = Number(status);
  return e;
}
export async function gh(endpoint, payload) {
  const args = ['api', '--hostname', 'github.com'];
  if (payload) args.push('--method', 'POST', '--raw-field', 'body=' + payload);
  args.push(endpoint);
  try {
    const r = await run('gh', args, {
      windowsHide: true,
      timeout: 25000,
      maxBuffer: 12e6,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
    return JSON.parse(r.stdout);
  } catch (e) {
    const message = String(e.stderr);
    const error = sourceError(
      'GitHub',
      /rate limit/i.test(message) ? 429 : message.match(/HTTP (\d{3})/)?.[1],
    );
    error.code = e.code;
    throw error;
  }
}
async function ghPages(route, call = gh) {
  const values = [];
  for (let page = 1; ; page++) {
    const chunk = await call(route + (route.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
    values.push(...chunk);
    if (chunk.length < 100) return values;
  }
}
function jiraApi(site) {
  const user = process.env.KANCHA_JIRA_EMAIL,
    token = process.env.KANCHA_JIRA_TOKEN;
  if (!user || !token)
    throw Error('Set KANCHA_JIRA_EMAIL and KANCHA_JIRA_TOKEN for Jira background access.');
  return async (route, body) => {
    const r = await fetch(site + '/rest/api/3/' + route, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
      headers: {
        Authorization: 'Basic ' + Buffer.from(user + ':' + token).toString('base64'),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw sourceError('Jira', r.status);
    return r.json();
  };
}
function plain(doc) {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  if (doc.text) return doc.text;
  return (doc.content || []).map(plain).join(doc.type === 'paragraph' ? '' : '\n');
}
const evidence = (label, detail, url) => (detail ? [{ label, detail: clean(detail), url }] : []);
export async function githubItems(repo, me, call = gh) {
  const root = 'repos/' + repo;
  const [issues, pulls] = await Promise.all([
    ghPages(root + '/issues?state=open&assignee=' + encodeURIComponent(me), call),
    ghPages(root + '/pulls?state=open', call),
  ]);
  const mapped = new Map();
  function put(r, kind, why) {
    mapped.set(r.number, {
      id: 'gh:' + repo + '#' + r.number,
      fields: {
        title: clean(r.title, 240),
        project: repo,
        kind,
        why,
        url: r.html_url,
        priority: kind === 'review' ? 'high' : 'normal',
        evidence: evidence('GitHub description', r.body, r.html_url),
      },
      extra: {
        ref: String(r.number),
        sourceKey: '#' + r.number,
        branch: r.head?.ref,
        linkedIssues: [
          ...new Set(
            (r.body || '').match(/https:\/\/[a-zA-Z0-9.-]+\/browse\/[A-Z][A-Z0-9_]*-[1-9]\d*\b/g) || [],
          ),
        ],
      },
    });
  }
  for (const r of issues) put(r, 'task', 'Assigned to you on GitHub.');
  for (const r of pulls) {
    if ((r.requested_reviewers || []).some((u) => u.login.toLowerCase() === me.toLowerCase()))
      put(r, 'review', 'Your review was requested by ' + r.user.login + '.');
  }
  return [...mapped.values()];
}
export async function jiraItems(site, project, api = jiraApi(site)) {
  let next;
  const items = [];
  do {
    const data = await api('search/jql', {
      jql:
        'project = "' +
        project +
        '" AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
      fields: ['summary', 'description', 'priority', 'duedate'],
      maxResults: 100,
      ...(next ? { nextPageToken: next } : {}),
    });
    for (const r of data.issues) {
      const f = r.fields,
        url = site + '/browse/' + r.key;
      items.push({
        id: 'jira:' + site + '/' + r.key,
        fields: {
          title: clean(f.summary, 240),
          project,
          kind: 'task',
          url,
          why: 'Assigned to you in ' + project + '.',
          priority: /highest|blocker/i.test(f.priority?.name)
            ? 'urgent'
            : /high/i.test(f.priority?.name)
              ? 'high'
              : 'normal',
          ...(f.duedate ? { due: new Date(f.duedate + 'T23:59:59').toISOString() } : {}),
          evidence: evidence('Jira description', plain(f.description), url),
        },
        extra: { ref: r.key, site, sourceKey: r.key },
      });
    }
    next = data.nextPageToken;
  } while (next);
  return items;
}
export async function threadComments(item) {
  if (item.source === 'github') {
    const list = await ghPages('repos/' + item.project + '/issues/' + item.ref + '/comments');
    return list.map((c) => ({
      id: String(c.id),
      owner: c.user.login,
      body: c.body || '',
      when: c.created_at,
      url: c.html_url,
    }));
  }
  if (item.source === 'jira') {
    const api = jiraApi(item.site),
      list = [];
    let start = 0;
    for (;;) {
      const r = await api(
        'issue/' + encodeURIComponent(item.ref) + '/comment?startAt=' + start + '&maxResults=100',
      );
      list.push(
        ...r.comments.map((c) => ({
          id: c.id,
          owner: c.author.accountId,
          display: c.author.displayName,
          body: plain(c.body),
          when: c.created,
          url: item.url + '?focusedCommentId=' + c.id,
        })),
      );
      start += r.comments.length;
      if (start >= r.total || !r.comments.length) return list;
    }
  }
  throw Error('Use the existing agent connector to follow this source.');
}
export function findReply(watch, comments) {
  const owner = watch.owner.replace(/^@/, '').toLowerCase();
  return comments
    .filter(
      (c) =>
        c.body.trim() &&
        !c.body.includes('[Kancha follow-up ') &&
        Date.parse(c.when) > Date.parse(watch.started) &&
        [c.owner, c.display].some((v) => v?.toLowerCase() === owner) &&
        (!watch.lastReplyAt || Date.parse(c.when) > Date.parse(watch.lastReplyAt)),
    )
    .sort((a, b) => Date.parse(b.when) - Date.parse(a.when))[0];
}
export async function checkWatch(store, item, read = threadComments) {
  const candidate = findReply(item.watch, await read(item));
  if (!candidate) return;
  store.edit(item.id, (fresh) => {
    const w = fresh.watch;
    if (
      w?.key !== item.watch.key ||
      !['waiting', 'reply'].includes(w.status) ||
      (w.lastReplyAt && Date.parse(w.lastReplyAt) >= Date.parse(candidate.when))
    )
      return;
    w.status = 'reply';
    w.lastReplyAt = candidate.when;
    w.candidate = { ...candidate, body: clean(candidate.body, 3200) };
    fresh.snooze = null;
    store.history(fresh.id, 'Reply received from ' + (candidate.display || candidate.owner));
  });
}
export async function postQuestion(store, id) {
  const key = 'post:' + id,
    lease = store.acquire(key);
  if (!lease) throw Error('A post is already being checked.');
  try {
    const i = store.get(id),
      w = i.watch;
    if (!i.visible || !w || w.status !== 'waiting') throw Error('Open a follow-up first');
    if (w.posted) return i;
    const marker = '[Kancha follow-up ' + w.key + ']',
      body = w.question + '\n\n' + marker;
    if (store.demo)
      return store.edit(id, (f) => {
        f.watch.posted = true;
        f.watch.delivery = 'demo thread';
      });
    const old = (await threadComments(i)).find((c) => c.body.includes(marker));
    if (!old && w.delivery === 'unconfirmed')
      throw Error('Delivery is uncertain. Check the source thread before creating another question.');
    if (!old) {
      store.edit(id, (f) => {
        f.watch.delivery = 'unconfirmed';
      });
      try {
        if (i.source === 'github')
          await gh('repos/' + i.project + '/issues/' + i.ref + '/comments', body);
        else if (i.source === 'jira')
          await jiraApi(i.site)('issue/' + encodeURIComponent(i.ref) + '/comment', {
            body: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
            },
          });
        else throw Error('This item uses a host connector.');
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 408)
          store.edit(id, (f) => {
            f.watch.delivery = 'local';
          });
        throw e;
      }
    }
    return store.edit(id, (f) => {
      if (f.watch?.key === w.key) {
        f.watch.posted = true;
        f.watch.delivery = 'source thread';
        store.history(id, 'Question posted in the shared thread');
      }
    });
  } finally {
    store.release(key, lease);
  }
}
async function stillOpen(item) {
  if (item.source === 'github') {
    const r = await gh('repos/' + item.project + '/issues/' + item.ref);
    return r.state === 'open';
  }
  const r = await jiraApi(item.site)('issue/' + encodeURIComponent(item.ref) + '?fields=status');
  return r.fields.status.statusCategory.key !== 'done';
}
export async function sync(
  store,
  {
    gitUser = () => gh('user'),
    github = githubItems,
    jira = jiraItems,
    read = threadComments,
    open = stillOpen,
  } = {},
) {
  if (store.demo) return store.board();
  const lock = store.acquire('sync', 30 * 60 * 1000);
  if (!lock) return store.board();
  try {
    const cfg = store.settings();
    async function group(source, project, load) {
      const key = source + ':' + project,
        prev = store.config('sync', {})[key] || {};
      let record;
      try {
        const incoming = await load();
        const activeCfg = store.settings();
        if (
          (source === 'jira' &&
            (activeCfg.jiraSite !== cfg.jiraSite || !activeCfg.projects.includes(project))) ||
          (source === 'github' && !activeCfg.repos.includes(project))
        )
          return;
        const current = new Set();
        for (const row of incoming) current.add(store.put(row.fields, source, row.id, row.extra).id);
        for (const item of store.all().filter((i) => i.source === source && i.project === project)) {
          try {
            if (!current.has(item.id)) {
              // Explicit handoffs remain relevant after reassignment while the source is open.
              const followed = item.watch && item.watch.status !== 'closed';
              const keep = followed && (await open(item));
              store.edit(item.id, (f) => {
                f.visible = Boolean(keep);
              });
              if (!keep) continue;
            }
            if (item.watch && ['waiting', 'reply'].includes(item.watch.status))
              await checkWatch(store, item, read);
          } catch (e) {
            if ([403, 404].includes(e.status)) {
              store.tx(() => store.forget(item));
              continue;
            }
            throw e;
          }
        }
        record = { status: 'connected', lastSuccess: now(), count: incoming.length };
      } catch (err) {
        const denied = [401, 403, 404].includes(err.status);
        if (denied)
          store.tx(() => {
            for (const i of store.all().filter((i) => i.source === source && i.project === project))
              store.forget(i);
          });
        record = { ...prev, status: denied ? 'access denied' : 'check connection', error: err.message };
      }
      store.tx(() =>
        store.set('sync', { ...store.config('sync', {}), [key]: { ...record, attempt: now() } }),
      );
    }
    if (cfg.repos.length) {
      const identity = await gitUser().then(
        (v) => ({ value: v.login }),
        (e) => ({ error: e }),
      );
      for (const repo of cfg.repos)
        await group('github', repo, () => {
          if (identity.error) throw identity.error;
          return github(repo, identity.value);
        });
    }
    for (const project of cfg.projects) await group('jira', project, () => jira(cfg.jiraSite, project));
    return store.board();
  } finally {
    store.release('sync', lock);
  }
}
