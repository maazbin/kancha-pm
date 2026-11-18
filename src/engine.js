import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { text, link, itemInput, settingsInput, now } from './store.js';
import { postQuestion, sync } from './sources.js';

const exec = promisify(execFile);
const id = text(2000);
const arg = (name, description, shape, fn) => ({
  name,
  description,
  schema: z.object(shape).strict(),
  fn,
});
const allowedItem = (store, id) => {
  const i = store.get(id);
  if (!i.visible) throw Error('Item is outside the current scope');
  return i;
};
async function checkoutContext(store) {
  const dir = store.settings().checkout;
  if (!dir) return null;
  if (!isAbsolute(dir)) throw Error('Choose an absolute checkout path.');
  const git = async (args) =>
    (await exec('git', ['-C', dir, ...args], { timeout: 5000, windowsHide: true })).stdout.trim();
  try {
    return {
      path: dir,
      branch: await git(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: await git(['rev-parse', '--short', 'HEAD']),
    };
  } catch {
    return { path: dir, status: 'Checkout unavailable' };
  }
}
export function commands(store) {
  const map = [
    arg(
      'get_my_focus',
      'Read the personal queue, waiting items, source freshness, and current focus.',
      {},
      () => {
        const b = store.board(),
          ids = b.agenda.slice(0, 3);
        const waiting = b.items.filter(
          (i) => i.watch && i.watch.status !== 'closed' && !(Date.parse(i.snooze) > Date.now()),
        );
        waiting.sort(
          (a, b) =>
            Number(b.watch.status === 'reply') - Number(a.watch.status === 'reply') ||
            Date.parse(a.watch.checkAt) - Date.parse(b.watch.checkAt),
        );
        return {
          agenda: ids,
          availableCount: b.agenda.length,
          items: ids.map((k) => {
            const { id, title, why, project, kind, stage, url } = store.get(k);
            return { id, title, why, project, kind, stage, url };
          }),
          followUps: waiting.slice(0, 10).map((i) => ({
            id: i.id,
            owner: i.watch.owner,
            question: i.watch.question,
            status: i.watch.status,
            checkAt: i.watch.checkAt,
          })),
          followUpCount: waiting.length,
          scope: { repos: b.settings.repos, projects: b.settings.projects },
          sync: b.sync,
          time: b.time,
        };
      },
    ),
    arg(
      'find_work',
      'Find visible work by title, project, source key or expected owner.',
      { query: text(240), offset: z.number().int().min(0).default(0) },
      (a) => {
        const needle = a.query.toLowerCase(),
          rows = store
            .board()
            .items.filter((i) =>
              [i.id, i.sourceKey, i.title, i.project, i.watch?.owner]
                .join(' ')
                .toLowerCase()
                .includes(needle),
            );
        return {
          total: rows.length,
          items: rows
            .slice(a.offset, a.offset + 25)
            .map(({ id, title, project, stage }) => ({ id, title, project, stage })),
        };
      },
    ),
    arg(
      'prepare_action',
      'Get source evidence, decision, private checkpoint, and selected local checkout.',
      { id },
      async (a) => ({ item: allowedItem(store, a.id), checkout: await checkoutContext(store) }),
    ),
    arg(
      'capture_work',
      'Save a personal action or import evidence from connected host tools. Reuse the same external key to update existing work.',
      {
        ...itemInput.shape,
        externalKey: text(500).optional(),
      },
      (a) => {
        const key = a.externalKey || a.url;
        const stable = key ? 'host:' + createHash('sha256').update(key).digest('hex') : undefined;
        return store.put(a, key ? 'host' : 'local', stable);
      },
    ),
    arg(
      'attach_evidence',
      'Attach a document passage, message, complaint, or reported alert to an existing item.',
      { id, label: text(160), detail: text(3200), url: link.optional() },
      (a) =>
        store.edit(a.id, (i) => {
          if (!i.visible) throw Error('Work item unavailable');
          const prior = i.evidence.find((e) => e.label === a.label && e.url === a.url);
          if (prior) prior.detail = a.detail;
          else {
            if (i.evidence.length >= 20) throw Error('This brief already has 20 evidence entries');
            i.evidence.push({ label: a.label, detail: a.detail, url: a.url });
          }
          i.personalEvidence = (i.personalEvidence || []).filter(
            (e) => e.label !== a.label || e.url !== a.url,
          );
          i.personalEvidence.push({ label: a.label, detail: a.detail, url: a.url });
          store.history(i.id, 'Attached ' + a.label);
        }),
    ),
    arg(
      'watch_for',
      'Record a blocker, its decision owner, exact question, and follow-up time. Local until shared explicitly.',
      {
        id,
        question: text(1600),
        owner: text(160),
        checkAt: z.string().datetime({ offset: true }),
      },
      (a) => {
        if (Date.parse(a.checkAt) <= Date.now()) throw Error('Choose a future follow-up time');
        return store.watch(a.id, a);
      },
    ),
    arg(
      'respond_to_action',
      'Focus, snooze, wake, save a checkpoint, confirm an answer, dismiss an ambiguous reply, complete, or reopen.',
      {
        id,
        action: z.enum([
          'focus',
          'checkpoint',
          'snooze',
          'wake',
          'answer',
          'dismiss_reply',
          'done',
          'reopen',
        ]),
        value: z.string().max(4000).optional(),
      },
      (a) => store.update(a.id, a.action, a.value),
    ),
    arg(
      'sync_sources',
      'Refresh configured native GitHub and Jira sources and check watched issue conversations.',
      {},
      () => sync(store),
    ),
    arg(
      'forget_source',
      'Hide an inaccessible host import and remove its cached source content, preserving the private checkpoint.',
      { id },
      (a) => {
        const i = store.get(a.id);
        if (i.source !== 'host') throw Error('Only host imports use this operation');
        store.tx(() => store.forget(i));
        return { hidden: true };
      },
    ),
    arg(
      'save_workspace',
      'Change local workspace identity, source scope, checkout, working hours, or refresh interval.',
      settingsInput.shape,
      (a) => {
        if (a.projects.length && !a.jiraSite)
          throw Error('Enter the Jira Cloud site for the selected projects');
        if (a.checkout && !isAbsolute(a.checkout)) throw Error('Choose an absolute checkout path');
        return store.configure(a);
      },
    ),
    arg(
      'send_question',
      'Post the current follow-up to its existing GitHub or Jira thread. Call only after the user approves this exact question and destination.',
      { id, confirmed: z.literal(true), watchKey: text(80) },
      (a) => {
        const i = allowedItem(store, a.id);
        if (i.watch?.key !== a.watchKey) throw Error('Follow-up changed. Review the current question.');
        return postQuestion(store, a.id);
      },
    ),
    arg(
      'record_reply',
      'Save a reply observed through an authorized host connector for human confirmation.',
      {
        id,
        author: text(160),
        body: text(3200),
        url: link,
        when: z.string().datetime({ offset: true }),
      },
      (a) =>
        store.edit(a.id, (i) => {
          const w = i.watch;
          if (!i.visible || !w || !['waiting', 'reply'].includes(w.status))
            throw Error('No open follow-up');
          if (w.owner.replace(/^@/, '').toLowerCase() !== a.author.replace(/^@/, '').toLowerCase())
            throw Error('Reply author differs from the expected owner');
          if (Date.parse(a.when) <= Date.parse(w.started)) throw Error('Reply predates the follow-up');
          if (w.lastReplyAt && Date.parse(a.when) <= Date.parse(w.lastReplyAt)) return;
          w.candidate = { display: a.author, body: a.body, url: a.url, when: a.when };
          w.status = 'reply';
          w.lastReplyAt = a.when;
          i.snooze = null;
          store.history(i.id, 'Source reply received');
        }),
    ),
  ];
  if (store.demo)
    map.push(
      arg('sample_reply', 'Deliver a fictional owner reply in the sample workspace.', { id }, (a) =>
        store.edit(a.id, (i) => {
          if (i.watch?.status !== 'waiting') throw Error('Start a follow-up first');
          i.watch.status = 'reply';
          i.watch.candidate = {
            display: i.watch.owner,
            body: 'Existing accounts may omit the tax ID. Keep validation for new accounts.',
            when: now(),
          };
          store.history(i.id, 'Sample reply received');
        }),
      ),
    );
  return Object.fromEntries(map.map((d) => [d.name, d]));
}
export async function invoke(map, name, data) {
  if (!Object.hasOwn(map, name)) throw Error('Unknown operation');
  const d = map[name];
  return d.fn(d.schema.parse(data));
}
export function markers(board, t = new Date()) {
  return board.items
    .filter((i) => i.stage !== 'done' && !(Date.parse(i.snooze) > t.getTime()))
    .flatMap((i) => {
      const w = i.watch;
      if (!w) return [];
      const due = w.status === 'waiting' && Date.parse(w.checkAt) <= t.getTime();
      if (!due && !['ready', 'reply'].includes(w.status)) return [];
      const source = board.sync[i.source + ':' + i.project];
      if (
        ['github', 'jira'].includes(i.source) &&
        (!source ||
          source.status !== 'connected' ||
          t - Date.parse(source.lastSuccess) > Math.max(30, board.settings.interval * 3) * 60000)
      )
        return [];
      const label = due ? 'Follow-up due' : w.status === 'reply' ? 'Reply to review' : 'Ready to resume';
      return [
        {
          id: i.id,
          key: [w.key, w.status, w.lastReplyAt || '', i.snooze || ''].join('/'),
          label,
          title: i.title,
          owner: w.owner,
        },
      ];
    });
}
export function quiet(settings, t = new Date()) {
  const h = t.getHours();
  const a = settings.quietStart,
    b = settings.quietEnd;
  return a === b ? false : a > b ? h >= a || h < b : h >= a && h < b;
}
