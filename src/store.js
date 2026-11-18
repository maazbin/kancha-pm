import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jiraIssue, pull, projectTables, projectIndex } from './projects.js';
import { priorityFactors, weeklyFlow } from './analysis.js';

export const now = () => new Date().toISOString();
export const text = (max = 240) => z.string().trim().min(1).max(max);
export const link = z
  .string()
  .url()
  .max(2000)
  .refine((v) => {
    const u = new URL(v);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
  }, 'Use a web URL without credentials');
export const itemInput = z.object({
  title: text(),
  why: text(4000),
  project: text(100),
  kind: z.enum(['task', 'review', 'decision', 'incident']),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  url: link.optional(),
  due: z.string().datetime({ offset: true }).optional(),
  evidence: z
    .array(z.object({ label: text(160), detail: text(3200), url: link.optional() }))
    .max(20)
    .default([]),
});
export const settingsInput = z.object({
  name: text(80),
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(100),
  jiraSite: z.union([z.literal(''), z.string().regex(/^https:\/\/[a-z0-9-]+\.atlassian\.net$/i)]),
  projects: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(100),
  quietStart: z.number().int().min(0).max(23),
  quietEnd: z.number().int().min(0).max(23),
  interval: z.number().int().min(2).max(120),
  checkout: z.string().max(1500).default(''),
});
const defaults = {
  name: 'Developer',
  repos: [],
  jiraSite: '',
  projects: [],
  quietStart: 19,
  quietEnd: 8,
  interval: 10,
  checkout: '',
};

function installDataDirectory() {
  try {
    const value = JSON.parse(
      readFileSync(new URL('../kancha.local.json', import.meta.url), 'utf8'),
    ).dataDirectory;
    if (typeof value !== 'string' || !path.isAbsolute(value))
      throw Error('kancha.local.json requires an absolute dataDirectory.');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function openStore({ directory, demo = false } = {}) {
  const systemDir =
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'KanchaPM')
      : path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'), 'kancha-pm');
  const base = directory || process.env.KANCHA_HOME || installDataDirectory() || systemDir;
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(base, demo ? 'demo.sqlite' : 'workspace.sqlite'));
  db.exec(`PRAGMA busy_timeout=8000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history(seq INTEGER PRIMARY KEY, at TEXT, item TEXT, message TEXT);
    CREATE INDEX IF NOT EXISTS history_at ON history(at);
    CREATE TABLE IF NOT EXISTS chat(id TEXT PRIMARY KEY,engine TEXT NOT NULL,question TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,answer TEXT);
    CREATE TABLE IF NOT EXISTS locks(k TEXT PRIMARY KEY, token TEXT, expires INTEGER);`);
  const all = () =>
    db
      .prepare('SELECT data FROM work ORDER BY id')
      .all()
      .map((x) => JSON.parse(x.data));
  projectTables(db);
  db.exec("CREATE INDEX IF NOT EXISTS work_identity ON work(json_extract(data,'$.identity'))");
  function get(id) {
    const row = db.prepare('SELECT data FROM work WHERE id=?').get(id);
    if (!row) throw Error('Work item is unavailable');
    return JSON.parse(row.data);
  }
  const save = (i) => {
    db.prepare('INSERT OR REPLACE INTO work VALUES(?,?)').run(i.id, JSON.stringify(i));
    return i;
  };
  const config = (key, fallback) => {
    const row = db.prepare('SELECT v FROM settings WHERE k=?').get(key);
    return row ? JSON.parse(row.v) : fallback;
  };
  const set = (key, v) =>
    db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key, JSON.stringify(v));
  const history = (id, msg) =>
    db.prepare('INSERT INTO history(at,item,message) VALUES(?,?,?)').run(now(), id, msg);
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  function edit(id, fn) {
    return tx(() => {
      const item = get(id);
      fn(item);
      return save(item);
    });
  }
  function put(fields, source = 'local', id = randomUUID(), extra = {}) {
    const parsed = itemInput.parse(fields);
    return tx(() => {
      let item;
      const identity = pull(parsed.url)?.url || jiraIssue(parsed.url)?.url;
      if (identity) {
        const existing = db
          .prepare(
            "SELECT id FROM work WHERE json_extract(data,'$.identity')=? OR json_extract(data,'$.url')=? ORDER BY id LIMIT 1",
          )
          .get(identity, identity);
        if (existing) id = existing.id;
      }
      if (db.prepare('SELECT id FROM work WHERE id=?').get(id)) item = get(id);
      else {
        item = { id, source, stage: 'open', checkpoint: '', snooze: null, created: now() };
        history(id, 'Added to your workspace');
      }
      const combined = [...parsed.evidence, ...(item.personalEvidence || [])];
      // A confirmed host import keeps its own access/scope lifecycle when native polling overlaps.
      if (item.hostManaged && source !== 'host') return item;
      return save({
        ...item,
        ...parsed,
        due: parsed.due,
        url: parsed.url,
        ...extra,
        identity,
        source: source === 'host' ? 'host' : item.source,
        hostManaged: source === 'host',
        evidence: combined,
        seen: now(),
        visible: true,
      });
    });
  }
  function focus(id) {
    return tx(() => {
      const item = get(id);
      if (!item.visible || ['done', 'waiting'].includes(item.stage))
        throw Error('This item is not ready for focus');
      for (const other of all())
        if (other.stage === 'focus' && other.id !== id) {
          other.stage = 'open';
          save(other);
        }
      item.stage = 'focus';
      item.snooze = null;
      if (item.watch?.status === 'ready') item.watch.status = 'closed';
      history(id, 'Accepted as current focus');
      return save(item);
    });
  }
  function watch(id, { question, owner, checkAt }) {
    return edit(id, (i) => {
      if (!i.visible || i.stage === 'done') throw Error('This item is unavailable');
      if (i.watch && ['waiting', 'reply', 'ready'].includes(i.watch.status))
        throw Error('Resolve the current follow-up first');
      i.watch = {
        key: randomUUID(),
        question,
        owner,
        checkAt,
        started: now(),
        status: 'waiting',
        answer: '',
        posted: false,
        delivery: 'local',
        candidate: null,
      };
      i.stage = 'waiting';
      i.snooze = null;
      history(id, 'Waiting on ' + owner);
    });
  }
  function answer(id, value) {
    return edit(id, (i) => {
      if (!i.visible || !i.watch || !['waiting', 'reply'].includes(i.watch.status))
        throw Error('No open follow-up');
      i.watch.answer = value;
      i.watch.status = 'ready';
      i.stage = 'ready';
      i.snooze = null;
      history(id, 'Decision recorded. Ready to resume');
    });
  }
  function update(id, action, value) {
    if (action === 'focus') return focus(id);
    if (action === 'answer') return answer(id, text(4000).parse(value));
    return edit(id, (i) => {
      if (!i.visible) throw Error('This item is unavailable');
      switch (action) {
        case 'checkpoint':
          i.checkpoint = z.string().trim().max(4000).parse(value);
          break;
        case 'snooze':
          i.snooze = z.string().datetime({ offset: true }).parse(value);
          if (Date.parse(i.snooze) <= Date.now()) throw Error('Choose a future time');
          break;
        case 'wake':
          i.snooze = null;
          break;
        case 'dismiss_reply':
          if (i.watch?.status !== 'reply') throw Error('No reply to dismiss');
          i.watch.status = 'waiting';
          i.watch.candidate = null;
          break;
        case 'done':
          if (i.stage === 'done') return;
          i.stage = 'done';
          i.snooze = null;
          if (i.watch) i.watch.status = 'closed';
          break;
        case 'reopen':
          if (i.stage !== 'done') throw Error('Only completed items can be reopened');
          i.stage = 'open';
          break;
        default:
          throw Error('Unknown action');
      }
      history(
        id,
        {
          checkpoint: 'Saved private checkpoint',
          snooze: 'Snoozed reminder',
          wake: 'Removed snooze',
          done: 'Marked personal action complete',
          reopen: 'Reopened personal action',
          dismiss_reply: 'Kept watching for a decision',
        }[action],
      );
    });
  }
  const settings = () => ({ ...defaults, ...config('workspace', {}) });
  function configure(input) {
    const valid = settingsInput.parse(input);
    return tx(() => {
      const old = settings();
      for (const i of all()) {
        if (
          (i.source === 'github' && !valid.repos.includes(i.project)) ||
          (i.source === 'jira' &&
            (old.jiraSite !== valid.jiraSite || !valid.projects.includes(i.project)))
        )
          forget(i);
      }
      set('workspace', valid);
      return valid;
    });
  }
  function forget(i) {
    // Preserve the developer's own checkpoint across a scope change. Drop source excerpts.
    save({
      id: i.id,
      source: i.source,
      project: i.project,
      ref: i.ref,
      site: i.site,
      visible: false,
      stage: i.stage === 'done' ? 'done' : 'open',
      checkpoint: i.checkpoint,
      created: i.created,
      title: 'Source unavailable',
      why: '',
      evidence: [],
      personalEvidence: [],
      watch: null,
      snooze: null,
    });
  }
  function board() {
    const visible = all().filter((i) => i.visible),
      projectMap = projectIndex({ db }, visible);
    const clock = Date.now(),
      items = visible.map((i) => ({
        ...i,
        mapping: projectMap.describe(i),
        factors: priorityFactors(i, clock),
      }));
    const available = items.filter(
      (i) => !['waiting', 'done'].includes(i.stage) && !(Date.parse(i.snooze) > clock),
    );
    const score = (i) => i.factors.reduce((sum, [, weight]) => sum + weight, 0);
    available.sort(
      (a, b) => score(b) - score(a) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
    );
    const activity = db
      .prepare(
        "SELECT h.* FROM history h JOIN work w ON w.id=h.item WHERE json_extract(w.data,'$.visible')=1 ORDER BY seq DESC LIMIT 30",
      )
      .all();
    return {
      demo,
      settings: settings(),
      catalog: projectMap.cfg,
      hostChecks: config('hostChecks', {}),
      items,
      agenda: available.map((i) => i.id),
      flow: weeklyFlow(db, clock),
      activity,
      sync: config('sync', {}),
      time: now(),
    };
  }
  // Process leases keep the dashboard, worker and agent from duplicating external operations.
  function acquire(k, ms = 600000) {
    const token = randomUUID();
    const res = db
      .prepare(
        'INSERT INTO locks VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET token=excluded.token, expires=excluded.expires WHERE locks.expires < ?',
      )
      .run(k, token, Date.now() + ms, Date.now());
    return res.changes ? token : null;
  }
  const release = (k, token) => db.prepare('DELETE FROM locks WHERE k=? AND token=?').run(k, token);
  return {
    db,
    demo,
    base,
    all,
    get,
    save,
    config,
    set,
    tx,
    edit,
    put,
    history,
    watch,
    update,
    board,
    settings,
    configure,
    forget,
    acquire,
    release,
  };
}
