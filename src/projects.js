import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { z } from 'zod';

const run = promisify(execFile);
const issuePattern = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;
const repoPattern = /^[\w.-]+\/[\w.-]+$/;
function parsed(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}
export function jiraIssue(raw) {
  const u = parsed(raw);
  if (!u) return null;
  const key = u.pathname.match(/^\/browse\/([^/]+)\/?$/)?.[1];
  return key && issuePattern.test(key)
    ? { key, url: u.origin + '/browse/' + key, site: u.origin }
    : null;
}
export function pull(raw) {
  const u = parsed(raw);
  if (!u || u.hostname !== 'github.com') return null;
  const m = u.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)(?:\/.*)?$/);
  if (!m) return null;
  const repo = m[1].toLowerCase();
  return { repo, number: m[2], url: 'https://github.com/' + repo + '/pull/' + m[2] };
}
function boardIdentity(raw) {
  const u = parsed(raw);
  if (!u) throw Error('Enter an HTTPS Jira board URL.');
  const id =
    u.pathname.match(/\/boards\/(\d+)(?:\/|$)/)?.[1] ||
    (u.pathname.endsWith('/RapidBoard.jspa') ? u.searchParams.get('rapidView') : null);
  if (!id || !/^\d+$/.test(id)) throw Error('Use a Jira board URL containing its numeric board ID.');
  return {
    id: u.origin + '#' + id,
    site: u.origin,
    url: u.origin + '/secure/RapidBoard.jspa?rapidView=' + id,
  };
}
export function projectTables(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS boards(id TEXT PRIMARY KEY,site TEXT,url TEXT,name TEXT,repos TEXT,checked TEXT);
 CREATE TABLE IF NOT EXISTS membership(board TEXT,issue TEXT,PRIMARY KEY(board,issue));
 CREATE TABLE IF NOT EXISTS checkouts(path TEXT PRIMARY KEY,repo TEXT);
 CREATE TABLE IF NOT EXISTS followed_repos(repo TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS associations(pr TEXT,issue TEXT,PRIMARY KEY(pr,issue));`);
}
export function catalog(store) {
  return {
    boards: store.db
      .prepare('SELECT * FROM boards ORDER BY name,id')
      .all()
      .map((b) => ({ ...b, repos: JSON.parse(b.repos) })),
    checkouts: store.db.prepare('SELECT * FROM checkouts ORDER BY repo,path').all(),
    repositories: store.db
      .prepare('SELECT repo FROM followed_repos ORDER BY repo')
      .all()
      .map((r) => r.repo),
  };
}
export const repoInput = z.string().regex(repoPattern);
export function followRepo(store, repo) {
  const normalized = repoInput.parse(repo).toLowerCase();
  store.db.prepare('INSERT OR IGNORE INTO followed_repos VALUES(?)').run(normalized);
  return { repo: normalized };
}
export const boardInput = {
  url: z.string().max(2000),
  name: z.string().trim().min(1).max(140),
  repos: z.array(z.string().regex(repoPattern)).default([]),
};
export function followBoard(store, { url, name, repos }) {
  const b = boardIdentity(url),
    names = JSON.stringify([...new Set(repos.map((r) => r.toLowerCase()))]);
  store.db
    .prepare(
      'INSERT INTO boards(id,site,url,name,repos) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,repos=excluded.repos',
    )
    .run(b.id, b.site, b.url, name, names);
  return b;
}
export function observeBoard(store, { boardUrl, issues, complete }) {
  const b = boardIdentity(boardUrl);
  if (!store.db.prepare('SELECT id FROM boards WHERE id=?').get(b.id))
    throw Error('Follow this board first.');
  const urls = issues.map((raw) => {
    const j = jiraIssue(raw);
    if (!j || j.site !== b.site) throw Error('Issue must belong to the same Jira site as the board.');
    return j.url;
  });
  return store.tx(() => {
    if (complete) store.db.prepare('DELETE FROM membership WHERE board=?').run(b.id);
    const add = store.db.prepare('INSERT OR IGNORE INTO membership VALUES(?,?)');
    for (const url of urls) add.run(b.id, url);
    store.db.prepare('UPDATE boards SET checked=? WHERE id=?').run(new Date().toISOString(), b.id);
    return { board: b.id, observed: urls.length };
  });
}
function githubRemote(raw) {
  const m = raw
    .trim()
    .match(/^(?:https:\/\/github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+\/[\w.-]+?)\/?$/i);
  return m?.[1].replace(/\.git$/i, '').toLowerCase();
}
export async function readCheckout(dir) {
  if (!path.isAbsolute(dir)) throw Error('Choose an absolute local project directory.');
  const git = async (args) =>
    (await run('git', ['-C', dir, ...args], { timeout: 5000, windowsHide: true })).stdout.trim();
  let root, repo;
  try {
    root = path.normalize(await git(['rev-parse', '--show-toplevel']));
    repo = githubRemote(await git(['remote', 'get-url', 'origin']));
  } catch {
    throw Error('Cannot read the checkout and its origin on this worker.');
  }
  if (!repo) throw Error('This checkout needs a recognized github.com origin.');
  return { path: root, repo };
}
export async function registerCheckout(store, dir) {
  const { path: root, repo } = await readCheckout(dir);
  store.db
    .prepare('INSERT INTO checkouts VALUES(?,?) ON CONFLICT(path) DO UPDATE SET repo=excluded.repo')
    .run(root, repo);
  return { path: root, repo };
}
export const modelFields = {
  branch: z.string().max(300).optional(),
  linkedIssues: z
    .array(
      z
        .string()
        .max(2000)
        .refine((v) => !!jiraIssue(v), 'Use a full Jira issue URL'),
    )
    .max(100)
    .optional(),
};
export function setAssociation(store, prUrl, issueUrl, enabled) {
  const p = pull(prUrl),
    i = jiraIssue(issueUrl);
  if (!p || !i) throw Error('Select a GitHub PR and full Jira issue URL.');
  if (enabled) store.db.prepare('INSERT OR IGNORE INTO associations VALUES(?,?)').run(p.url, i.url);
  else store.db.prepare('DELETE FROM associations WHERE pr=? AND issue=?').run(p.url, i.url);
  return { pr: p.url, issue: i.url, confirmed: enabled };
}
export function projectIndex(store, visible = []) {
  const cfg = catalog(store),
    members = store.db.prepare('SELECT * FROM membership ORDER BY issue,board').all(),
    links = store.db.prepare('SELECT * FROM associations').all();
  const byIssue = new Map(),
    byKey = new Map(),
    boards = new Map(cfg.boards.map((b) => [b.id, b]));
  for (const m of members) {
    if (!byIssue.has(m.issue)) byIssue.set(m.issue, []);
    byIssue.get(m.issue).push(m.board);
    const key = jiraIssue(m.issue).key;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(m.issue);
  }
  const byPR = new Map();
  for (const l of links) {
    if (!byPR.has(l.pr)) byPR.set(l.pr, []);
    byPR.get(l.pr).push(l.issue);
  }
  const pullsForIssue = new Map();
  for (const item of visible) {
    const p = pull(item.url);
    if (!p) continue;
    for (const raw of [...(item.linkedIssues || []), ...(byPR.get(p.url) || [])]) {
      const issue = jiraIssue(raw);
      if (!issue) continue;
      if (!pullsForIssue.has(issue.url)) pullsForIssue.set(issue.url, new Set());
      pullsForIssue.get(issue.url).add(p.url);
    }
  }
  function describe(item) {
    const p = pull(item.url),
      j = jiraIssue(item.url),
      related = new Map(),
      suggested = new Set();
    if (j) related.set(j.url, 'Jira issue');
    if (p) {
      for (const raw of item.linkedIssues || []) {
        const i = jiraIssue(raw);
        if (i) related.set(i.url, 'Source link');
      }
      for (const raw of byPR.get(p.url) || []) related.set(raw, 'Developer confirmed');
      const keys = (item.title + ' ' + (item.branch || '')).match(/\b[A-Z][A-Z0-9_]*-[1-9]\d*\b/g) || [];
      for (const key of keys)
        for (const url of byKey.get(key) || []) {
          if (related.has(url)) continue;
          const candidates = byIssue.get(url).map((id) => boards.get(id));
          if (candidates.some((b) => !b.repos.length || b.repos.includes(p.repo))) suggested.add(url);
        }
    }
    const ids = new Set();
    for (const raw of related.keys()) for (const id of byIssue.get(raw) || []) ids.add(id);
    const relatedPRs = j ? [...(pullsForIssue.get(j.url) || [])] : [];
    const repos = new Set(p ? [p.repo] : relatedPRs.map((url) => pull(url).repo));
    return {
      repo: p?.repo || null,
      boards: [...ids],
      links: [...related].map(([url, reason]) => ({ url, reason })),
      relatedPRs,
      candidates: [...suggested],
      checkouts: cfg.checkouts.filter((c) => repos.has(c.repo)).map((c) => c.path),
    };
  }
  return { cfg, describe };
}
