import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { text, link, itemInput, settingsInput, now } from './store.js';
import { postQuestion, sync } from './sources.js';
import { checkGithubCli, hostProbeFields, saveCheck } from './connections.js';
import { day } from './analysis.js';
import { pluginRead } from './plugins.js';
import { teamAction } from './team.js';
import { waitingChat, replyChat } from './chat.js';
import {
  catalog,
  projectIndex,
  boardInput,
  followBoard,
  observeBoard,
  registerCheckout,
  readCheckout,
  setAssociation,
  modelFields,
  pull,
  jiraIssue,
  followRepo,
  repoInput,
} from './projects.js';

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
async function checkoutContext(dir) {
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
      'read_plugin',
      'List available read tools or read GitHub or Slack using the dashboard plugin connection.',
      {
        provider: z.enum(['github', 'slack']),
        tool: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
      },
      (a) => pluginRead(store, a.provider, a.tool, a.input),
    ),
    arg(
      'read_team_tickets',
      'Read sites, projects or a page of shared Jira tickets through the developer’s authorized plugin.',
      {
        action: z.enum(['sites', 'projects', 'tickets', 'details', 'people']),
        owner: z.string().optional(),
        query: z.string().optional(),
        site: z.string().optional(),
        project: z.string().optional(),
        key: z.string().optional(),
        next: z.string().optional(),
      },
      (a) => teamAction(store, a),
    ),
    arg(
      'set_personal_priority',
      'Override or restore the priority on this personal desk.',
      { id, priority: z.enum(['normal', 'high', 'urgent', 'source']) },
      (a) =>
        store.edit(a.id, (i) => {
          if (!i.visible) throw Error('Item is outside the current scope');
          i.personalPriority = a.priority === 'source' ? null : a.priority;
          store.history(
            i.id,
            i.personalPriority
              ? 'Set personal priority to ' + i.personalPriority
              : 'Restored source priority',
          );
        }),
    ),
    arg(
      'read_browser_chat',
      'Read a question explicitly addressed to the open coding session, with personal PM context.',
      {},
      () => waitingChat(store),
    ),
    arg(
      'reply_browser_chat',
      'Deliver a text answer to the waiting question in the developer’s own browser.',
      { id: z.string().uuid(), answer: text(20000) },
      (a) => replyChat(store, a.id, a.answer),
    ),
    arg(
      'project_scope',
      'Inspect this developer’s followed boards, repository hints and verified checkout origins before discovering work.',
      {},
      () => catalog(store),
    ),
    arg(
      'follow_repo',
      'Follow one GitHub repository through the existing host connector. Keeps the other repos and boards.',
      { repo: repoInput },
      (a) => followRepo(store, a.repo),
    ),
    arg(
      'unfollow_scope',
      'Remove one selected local board, repo or checkout from discovery. Personal work and the other sources remain available.',
      { type: z.enum(['board', 'repository', 'checkout']), key: text(2000), confirmed: z.literal(true) },
      (a) =>
        store.tx(() => {
          if (a.type === 'board') {
            store.db.prepare('DELETE FROM membership WHERE board=?').run(a.key);
            store.db.prepare('DELETE FROM boards WHERE id=?').run(a.key);
          }
          if (a.type === 'repository')
            store.db.prepare('DELETE FROM followed_repos WHERE repo=?').run(a.key.toLowerCase());
          if (a.type === 'checkout') store.db.prepare('DELETE FROM checkouts WHERE path=?').run(a.key);
          return catalog(store);
        }),
    ),
    arg(
      'record_connector_check',
      'Record a real read-only connection probe from this coding host. This records availability without storing credentials.',
      hostProbeFields,
      (a) => saveCheck(store, a),
    ),
    arg(
      'check_github_cli',
      'Check the worker’s existing gh login and list organizations with at least one visible repository.',
      {},
      () => checkGithubCli(store),
    ),
    arg(
      'follow_board',
      'Add or edit one Jira board and its optional GitHub repo hints. Other boards and checkouts stay independent.',
      boardInput,
      (a) => followBoard(store, a),
    ),
    arg(
      'observe_board',
      'Record actual Jira board membership from an authorized board or its saved filter. Partial pages add. Complete replaces only this board’s previous membership.',
      { boardUrl: link, issues: z.array(link).max(10000), complete: z.boolean().default(false) },
      (a) => observeBoard(store, a),
    ),
    arg(
      'register_checkout',
      'Add a local checkout. Read its Git origin to identify the matching GitHub repository.',
      { path: text(1500) },
      (a) => registerCheckout(store, a.path),
    ),
    arg(
      'confirm_pr_issue',
      'Record or remove the developer’s explicit confirmation of a PR-to-Jira relationship. Requires both source URLs.',
      { prUrl: link, issueUrl: link, enabled: z.boolean().default(true) },
      (a) => setAssociation(store, a.prUrl, a.issueUrl, a.enabled),
    ),
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
          scope: { repos: b.settings.repos, projects: b.settings.projects, ...b.catalog },
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
      async (a) => {
        const i = allowedItem(store, a.id),
          mapping = projectIndex(
            store,
            store.all().filter((i) => i.visible),
          ).describe(i);
        const projects = new Set(
          mapping.repo ? [mapping.repo] : mapping.relatedPRs.map((url) => pull(url).repo),
        );
        const checked = await Promise.all(
          mapping.checkouts.map(async (p) => {
            try {
              const actual = await readCheckout(p);
              return projects.has(actual.repo) ? p : null;
            } catch {
              return null;
            }
          }),
        );
        mapping.checkouts = checked.filter(Boolean);
        const legacy = store.settings().checkout;
        let checkout = null;
        if (mapping.checkouts.length === 1) checkout = await checkoutContext(mapping.checkouts[0]);
        else if (!mapping.checkouts.length && legacy && !mapping.repo && !jiraIssue(i.url))
          checkout = await checkoutContext(legacy);
        return { item: { ...i, mapping }, checkout, checkoutOptions: mapping.checkouts };
      },
    ),
    arg(
      'capture_work',
      'Save a personal action or import evidence from connected host tools. Reuse the same external key to update existing work.',
      {
        ...itemInput.shape,
        externalKey: text(500).optional(),
        ...modelFields,
      },
      (a) => {
        const key = pull(a.url)?.url || jiraIssue(a.url)?.url || a.externalKey || a.url;
        const stable = key ? 'host:' + createHash('sha256').update(key).digest('hex') : undefined;
        return store.put(a, key ? 'host' : 'local', stable, {
          ...(a.branch !== undefined ? { branch: a.branch } : {}),
          ...(a.linkedIssues !== undefined ? { linkedIssues: a.linkedIssues } : {}),
        });
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
      const source = board.sync[i.source + ':' + i.project];
      if (
        ['github', 'jira'].includes(i.source) &&
        (!source ||
          source.status !== 'connected' ||
          t - Date.parse(source.lastSuccess) > Math.max(30, board.settings.interval * 3) * 60000)
      )
        return [];
      const results = [];
      const deadline = Date.parse(i.due);
      if (deadline < t.getTime() + day) {
        const late = deadline <= t.getTime();
        results.push({
          id: i.id,
          key: [i.id, i.due, late ? 'late' : 'soon', i.snooze || ''].join('/'),
          label: late ? 'Overdue' : 'Deadline approaching',
          title: i.title,
          when: i.due,
        });
      }
      const due = w?.status === 'waiting' && Date.parse(w.checkAt) <= t.getTime();
      if (!due && !['ready', 'reply'].includes(w?.status)) return results;
      results.push({
        id: i.id,
        key: [w.key, w.status, w.lastReplyAt || '', i.snooze || ''].join('/'),
        label: due ? 'Follow-up due' : w.status === 'reply' ? 'Reply to review' : 'Ready to resume',
        title: i.title,
        owner: w.owner,
        when: w.lastReplyAt || w.checkAt,
      });
      return results;
    });
}
export function quiet(settings, t = new Date()) {
  const h = t.getHours();
  const a = settings.quietStart,
    b = settings.quietEnd;
  return a === b ? false : a > b ? h >= a || h < b : h >= a && h < b;
}
