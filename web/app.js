const $ = (q) => document.querySelector(q);
const main = $('#main'),
  dialog = $('#dialog'),
  body = $('#dialogBody');
const prefix = location.pathname.startsWith('/sample') ? '/sample' : '';
const navs = {
  desk: ['Focus desk', 'layout-dashboard'],
  queue: ['Work queue', 'layers'],
  watches: ['Follow-ups', 'bell-ring'],
  history: ['Activity', 'history'],
  settings: ['Workspace', 'settings-2'],
};
const icons = {
  review: 'git-pull-request',
  decision: 'signpost',
  task: 'list-checks',
  incident: 'activity',
};
let board,
  page = Object.hasOwn(navs, location.hash.slice(1)) ? location.hash.slice(1) : 'desk',
  filter = 'active',
  view = '',
  selected = '',
  timer,
  revision = 0,
  saving = false,
  oldMarkers = null;
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const icon = (n) => `<img class="icon" alt="" src="/icons/${n}.svg">`;
const action = (id, title, style = '', glyph = '', value = '') =>
  `<button type="button" data-action="${id}" data-value="${esc(value)}" class="btn ${style}">${glyph ? icon(glyph) : ''}${esc(title)}</button>`;
const badge = (v, c = '') => `<span class="pill ${c}">${esc(v)}</span>`;
const empty = (t) => `<p class="empty">${esc(t)}</p>`;
const link = (url, label) => {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    return `<a href="${esc(u.href)}" rel="noopener noreferrer" target="_blank">${esc(label)} ↗</a>`;
  } catch {
    return '';
  }
};
const date = (v, opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) =>
  v ? new Date(v).toLocaleString(undefined, opts) : '';
const fmtLabel = (t) => `<span class="label">${esc(t)}</span>`;
const item = (id) => board.items.find((i) => i.id === id);
const tag = (i) =>
  i.sourceKey || { local: 'Private action', host: 'Agent import', demo: 'Sample' }[i.source] || i.source;
const watched = () => board.items.filter((i) => i.watch && i.watch.status !== 'closed');
const snoozed = (i) => Date.parse(i.snooze) > Date.now();
const status = (i) =>
  snoozed(i)
    ? 'Snoozed'
    : i.watch?.status === 'reply'
      ? 'Reply received'
      : {
          focus: 'In focus',
          waiting: 'Waiting',
          open: 'Available',
          ready: 'Ready to resume',
          done: 'Complete',
        }[i.stage];
function notice(t) {
  $('#toast').textContent = t;
  clearTimeout(timer);
  timer = setTimeout(() => ($('#toast').textContent = ''), 4500);
}
async function api(route, data) {
  const r = await fetch(prefix + '/api/' + route, {
    method: data ? 'POST' : 'GET',
    headers: { 'X-Kancha': '1', ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw Error(j.error || 'Request failed');
  return j;
}
async function refresh(paint = true) {
  const version = ++revision,
    fresh = await api('board');
  if (version !== revision) return;
  const keys = new Set(fresh.markers.map((m) => m.key));
  if (oldMarkers && !fresh.quiet) {
    const m = fresh.markers.find((m) => !oldMarkers.has(m.key));
    if (m) notice(m.label + ' · ' + m.title);
  }
  oldMarkers = keys;
  board = fresh;
  if (paint) render();
}
async function op(name, args, feedback) {
  const result = await api('action', { name, args });
  await refresh();
  if (feedback) notice(feedback);
  return result;
}
function header(title, desc, right = '') {
  return `<div class="head"><div><div class="eyebrow">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))} ${board.demo ? ' · Sample desk' : ''}</div><h1>${esc(title)}</h1><p class="desc">${esc(desc)}</p></div>${right}</div>`;
}
function tile(i, showStatus = true) {
  return `<button class="tile" data-action="brief" data-value="${esc(i.id)}"><span class="glyph">${icon(icons[i.kind])}</span><span class="grow"><strong>${esc(i.title)}</strong><small>${esc(i.project)} · ${esc(tag(i))}</small></span>${showStatus ? badge(status(i), i.watch?.status || i.stage) : ''}${icon('chevron-right')}</button>`;
}
const panel = (title, contents, side = '') =>
  `<section class="panel"><div class="sectionhead"><h2>${esc(title)}</h2>${side}</div>${contents}</section>`;
function desk() {
  const focus = item(board.agenda[0]),
    others = board.agenda.slice(1, 4).map(item),
    watches = watched().sort((a, b) => (b.watch.status === 'reply') - (a.watch.status === 'reply'));
  const src = Object.values(board.sync)
    .filter((v) => v.lastSuccess)
    .map((v) => v.lastSuccess)
    .sort()
    .at(-1);
  const issues = Object.values(board.sync).filter((s) => s.status !== 'connected');
  return (
    header(
      'Focus desk',
      `Your next move${board.settings.name === 'Developer' ? '' : ', ' + board.settings.name}.`,
      action('capture', 'Capture work', '', 'plus'),
    ) +
    (issues.length
      ? `<div class="bulletin">${icon('circle-alert')}<span>${issues.length} source connection${issues.length === 1 ? ' needs' : 's need'} attention.</span>${action('settings', 'Inspect', 'subtle')}</div>`
      : '') +
    `<section class="hero"><div class="art" aria-hidden="true"><div class="orb"></div><div class="orbit"></div><div class="orbit o2"></div></div><div class="label"><i class="live-dot"></i>${focus ? esc(status(focus) + ' / ' + tag(focus)) : 'Workspace ready'}</div><h2>${esc(focus?.title || (watches.length ? 'Your next move is a follow-up.' : 'Bring your work into focus.'))}</h2><p>${esc(focus?.why || (watches.length ? 'Check the outstanding questions or capture your next action.' : 'Connect your repos and boards, or capture one action you want to move today.'))}</p><div class="actions">${focus ? action('brief', 'Open work brief', 'lime', 'arrow-up-right', focus.id) : action(watches.length ? 'watches' : 'settings', watches.length ? 'Open follow-ups' : 'Connect sources', 'lime', 'arrow-up-right')}</div></section>` +
    `<div class="columns">${panel('Up next', others.length ? others.map((i) => tile(i, false)).join('') : empty('Your next available actions will appear here.'), action('queue', 'View queue', 'subtle'))}${panel(
      'Follow-ups',
      watches.length
        ? watches
            .slice(0, 3)
            .map((i) => tile(i))
            .join('')
        : empty('Start a watch from a work brief to track a decision.'),
      `<span class="count">${watches.length}</span>`,
    )}</div>` +
    `<div class="mini"><span>${board.demo ? 'Fictional workspace · changes stay in the sample desk' : src ? 'Last successful source check · ' + date(src) : 'Local workspace · source checks appear after connection'}</span>${board.demo ? (board.standaloneDemo ? '' : `<a href="/">Return to my workspace</a>`) : `<a href="/sample/">Explore the sample desk ↗</a>`}</div>`
  );
}
function queue() {
  const groups = {
    active: (i) => i.stage !== 'done' && !snoozed(i),
    snoozed,
    complete: (i) => i.stage === 'done',
    all: () => true,
  };
  const shown = board.items.filter(groups[filter] || groups.active);
  return (
    header(
      'Work queue',
      'Your actions across selected projects.',
      action('capture', 'Capture work', 'primary', 'plus'),
    ) +
    `<div class="filters">${Object.keys(groups)
      .map(
        (k) =>
          `<button class="filter" aria-pressed="${k === filter}" data-action="filter" data-value="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`,
      )
      .join('')}</div>` +
    panel(
      'Work items',
      shown.length ? shown.map((i) => tile(i)).join('') : empty('No items match this view.'),
      `<span class="count">${shown.length}</span>`,
    )
  );
}
function watches() {
  const rows = watched();
  return (
    header('Follow-ups', 'Decisions, replies, and the people who can unblock you.') +
    `<div class="stack">${['reply', 'ready', 'waiting']
      .map((k) => {
        const items = rows.filter((i) => i.watch.status === k);
        return panel(
          { reply: 'Replies to review', ready: 'Ready to resume', waiting: 'Waiting on someone' }[k],
          items.length
            ? items
                .map(
                  (i) =>
                    `<button data-action="brief" data-value="${esc(i.id)}" class="tile"><span class="glyph">${icon(k === 'waiting' ? 'clock-3' : 'message-circle')}</span><span class="grow"><strong>${esc(i.watch.question)}</strong><small>${esc(i.watch.owner)} · ${esc(i.title)} · ${esc(snoozed(i) ? 'Snoozed until ' + date(i.snooze) : 'Check ' + date(i.watch.checkAt))}</small></span>${icon('chevron-right')}</button>`,
                )
                .join('')
            : empty('Nothing here right now.'),
          `<span class="count">${items.length}</span>`,
        );
      })
      .join('')}</div>`
  );
}
function historyPage() {
  return (
    header('Activity', 'Recent changes in your personal workspace.') +
    panel(
      'Recent activity',
      board.activity.length
        ? board.activity
            .map(
              (h) =>
                `<div class="historyrow"><time>${esc(date(h.at))}</time><div><strong>${esc(h.message)}</strong><small>${esc(item(h.item)?.title)}</small></div></div>`,
            )
            .join('')
        : empty('Activity appears when you capture work or take an action.'),
    )
  );
}
const field = (label, name, value = '', opts = {}) =>
  `<label class="formrow ${opts.wide ? 'wide' : ''}">${esc(label)}${opts.area ? `<textarea name="${name}" rows="${opts.rows || 3}" ${opts.required ? 'required' : ''} maxlength="${opts.max || 4000}">${esc(value)}</textarea>` : `<input name="${name}" type="${opts.type || 'text'}" value="${esc(value)}" ${opts.required ? 'required' : ''} ${opts.min !== undefined ? `min="${opts.min}"` : ''} ${opts.max !== undefined && opts.type === 'number' ? `max="${opts.max}"` : ''} ${opts.max && opts.type !== 'number' ? `maxlength="${opts.max}"` : ''}>`}${opts.hint ? `<small>${esc(opts.hint)}</small>` : ''}</label>`;
const select = (label, name, vals, current) =>
  `<label class="formrow">${esc(label)}<select name="${name}">${vals.map((v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
const submit = (t) => `<button type="submit" class="btn primary">${esc(t)}</button>`;
function settings() {
  const s = board.settings;
  const syncs = Object.entries(board.sync).filter(([k]) =>
    [...s.repos.map((v) => 'github:' + v), ...s.projects.map((v) => 'jira:' + v)].includes(k),
  );
  return (
    header('Workspace', 'Choose what your PM follows on this device.') +
    `<form data-form="settings" class="stack">${panel('Personal desk', `<div class="settingsgrid">${field('Your name', 'name', s.name, { required: true, max: 80 })}${field('Local checkout', 'checkout', s.checkout, { hint: 'Absolute path to the repo used for handoffs.' })}</div>`)}${panel('Connected sources', `<div class="settingsgrid">${field('GitHub repositories', 'repos', s.repos.join(', '), { wide: true, hint: 'Comma-separated owner/repository pairs. Uses your gh login.' })}${field('Jira Cloud site', 'jiraSite', s.jiraSite, { hint: 'Example: https://team.atlassian.net' })}${field('Jira project keys', 'projects', s.projects.join(', '), { hint: 'Comma-separated keys. The helper uses KANCHA_JIRA_EMAIL and KANCHA_JIRA_TOKEN.' })}</div><div class="sourcelist">${syncs.map(([k, v]) => `<div class="historyrow"><div><b>${esc(k)}</b><small>${esc(v.status)} · ${v.lastSuccess ? 'Last success ' + date(v.lastSuccess) : 'No successful check yet'}${v.error ? ' · ' + esc(v.error) : ''}</small></div></div>`).join('')}</div>`)}${panel('Reminders', `<div class="settingsgrid">${field('Quiet from (local hour)', 'quietStart', s.quietStart, { type: 'number', min: 0, max: 23, required: true })}${field('Quiet until (local hour)', 'quietEnd', s.quietEnd, { type: 'number', min: 0, max: 23, required: true })}${field('Check interval in minutes', 'interval', s.interval, { type: 'number', min: 2, max: 120, required: true })}</div>`)}<div class="actions">${submit('Save workspace')}${action('sync', 'Check sources now', '', 'refresh-cw')}</div></form>`
  );
}
function render() {
  if (!board) return;
  $('#nav').innerHTML = Object.entries(navs)
    .map(
      ([k, [t, n]]) =>
        `<button class="nav ${k === 'settings' ? 'navdivider' : ''}" ${page === k ? 'aria-current="page"' : ''} data-action="${k}">${icon(n)}${t}</button>`,
    )
    .join('');
  $('#crumb').textContent = navs[page][0];
  $('#profile').innerHTML =
    `<div class="person"><span class="avatar">${esc((board.settings.name || 'K').slice(0, 1).toUpperCase())}</span><div>${esc(board.settings.name)}<small>${board.demo ? 'Sample desk' : 'Personal desk'}</small></div></div>`;
  main.innerHTML = { desk, queue, watches, history: historyPage, settings }[page]();
  document.title = navs[page][0] + ' · Kancha';
}
function navigate(p) {
  revision++;
  page = p;
  location.hash = p;
  render();
  main.focus();
}
window.addEventListener('hashchange', () => {
  const k = location.hash.slice(1);
  if (Object.hasOwn(navs, k) && page !== k) {
    page = k;
    render();
  }
});
function modal(title, sub, html) {
  body.innerHTML = `<header class="dialoghead"><div>${fmtLabel(sub)}<h2 id="dialogTitle">${esc(title)}</h2></div>${action('close', 'Close', 'ghost')}</header>${html}<div id="dialogError" class="error" role="alert"></div>`;
  dialog.setAttribute('aria-labelledby', 'dialogTitle');
  if (!dialog.open) dialog.showModal();
}
function openBrief(i, context) {
  if (!i) return;
  view = 'brief';
  selected = i.id;
  const w = i.watch;
  const evidence = i.evidence.length
    ? i.evidence
        .map(
          (e) =>
            `<div class="block"><b>${esc(e.label)}</b><p>${esc(e.detail)}</p>${link(e.url, 'Open evidence')}</div>`,
        )
        .join('')
    : empty('Attach a source to prepare this action.');
  const hasWatch = w && w.status !== 'closed';
  const follow = hasWatch
    ? `<hr class="hr"><h3>${esc({ waiting: 'Waiting on ' + w.owner, reply: 'Review the reply', ready: 'Ready to resume' }[w.status])}</h3><div class="block">${esc(w.question)}<p>${esc(w.owner)} · ${esc(date(w.checkAt))} · ${esc(w.delivery)}</p></div>${w.candidate && w.status === 'reply' ? `<div class="block"><b>${esc(w.candidate.display || w.candidate.owner)}</b><p>${esc(w.candidate.body)}</p>${link(w.candidate.url, 'Open reply')}</div>` : ''}${w.answer ? `<div class="block">${esc(w.answer)}</div>` : ''}<div class="actions">${w.status === 'reply' ? action('confirmReply', 'Use this answer', 'primary') + action('dismissReply', 'Keep watching') : ''}${w.status === 'waiting' ? action('answer', 'Record an answer') + (!w.posted && ['github', 'jira', 'demo'].includes(i.source) ? action('postpreview', 'Review & post question') : '') + (board.demo ? action('simulate', 'Simulate owner reply') : '') : ''}</div>`
    : '';
  const opts =
    i.stage === 'done'
      ? action('reopen', 'Reopen')
      : (i.stage !== 'waiting'
          ? action(
              'focus',
              i.stage === 'focus' ? 'Copy handoff' : i.stage === 'ready' ? 'Resume work' : 'Take focus',
              'primary',
              'crosshair',
            )
          : '') +
        (!hasWatch ? action('watch', 'Ask / watch', '', 'bell-plus') : '') +
        (snoozed(i) ? action('wake', 'Unsnooze') : action('snooze', 'Remind me later')) +
        action('done', 'Complete');
  modal(
    i.title,
    tag(i) + ' / ' + i.project,
    `<div class="metarow">${badge(status(i), w?.status || i.stage)}${badge(i.priority)}${link(i.url, 'Open source')}</div><p>${esc(i.why)}</p>${i.due ? `<p>Due ${esc(date(i.due))}</p>` : ''}${context?.branch ? `<p class="footnote">Checkout · ${esc(context.branch)} @ ${esc(context.commit)}</p>` : ''}<div class="actions">${opts}</div>${follow}<hr class="hr"><div class="sectionhead"><h3>Evidence</h3>${action('attach', 'Attach', 'subtle', 'paperclip')}</div>${evidence}<div class="sectionhead"><h3>Private checkpoint</h3>${action('checkpoint', 'Edit', 'subtle', 'pencil')}</div><p>${esc(i.checkpoint || 'Save the exact place to pick up next time.')}</p>`,
  );
}
const localDT = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function formModal(which) {
  view = which;
  const i = item(selected);
  let title, inputs, button;
  if (which === 'capture') {
    title = 'Capture work';
    button = 'Save action';
    inputs =
      field('Next action', 'title', '', { required: true, max: 240 }) +
      field('Why does it matter?', 'why', '', { required: true, area: true }) +
      field('Project', 'project', 'Personal', { required: true, max: 100 }) +
      select('Action type', 'kind', ['task', 'review', 'decision', 'incident'], 'task') +
      select('Priority', 'priority', ['normal', 'high', 'urgent'], 'normal') +
      field('Source URL (optional)', 'url', '', { type: 'url' });
  }
  if (which === 'watch') {
    title = 'Watch a decision';
    button = 'Start local watch';
    inputs =
      field('Exact question', 'question', '', { required: true, area: true, max: 1600 }) +
      field('Who can answer?', 'owner', '', {
        required: true,
        hint: 'GitHub login or Jira account ID / display name.',
      }) +
      field('Check back at', 'checkAt', localDT(new Date(Date.now() + 3600000)), {
        type: 'datetime-local',
        required: true,
      });
  }
  if (which === 'attach') {
    title = 'Attach evidence';
    button = 'Attach to brief';
    inputs =
      field('Source or document', 'label', '', { required: true, max: 160 }) +
      field('Relevant passage or observation', 'detail', '', { area: true, required: true, max: 3200 }) +
      field('Source URL (optional)', 'url', '', { type: 'url' });
  }
  if (which === 'checkpoint') {
    title = 'Leave a checkpoint';
    button = 'Save checkpoint';
    inputs = field('Where should your next session begin?', 'value', i.checkpoint, { area: true });
  }
  if (which === 'answer') {
    title = 'Record the decision';
    button = 'Mark ready to resume';
    inputs = field('Confirmed answer', 'value', '', { area: true, required: true });
  }
  if (which === 'snooze') {
    title = 'Remind me later';
    button = 'Snooze action';
    inputs = field('Bring this back at', 'until', localDT(new Date(Date.now() + 3600000)), {
      type: 'datetime-local',
      required: true,
    });
  }
  modal(
    title,
    which === 'capture' ? 'Personal desk' : tag(i),
    `<form data-form="${which}" class="inlineform">${inputs}<div class="actions">${submit(button)}${which !== 'capture' ? action('back', 'Back') : ''}</div></form>`,
  );
}
function search() {
  view = 'search';
  modal(
    'Search work',
    'Personal workspace',
    `<label class="formrow">Title, project, ID, or owner<input id="find" type="search" autocomplete="off"></label><div id="results"></div>`,
  );
  searchRows('');
  $('#find').focus();
}
function searchRows(term) {
  const list = board.items.filter((i) =>
    [i.title, i.project, i.sourceKey, i.watch?.owner]
      .join(' ')
      .toLowerCase()
      .includes(term.toLowerCase()),
  );
  $('#results').innerHTML = list.length
    ? list
        .slice(0, 40)
        .map((i) => tile(i))
        .join('')
    : empty('No matching work.');
}
function handoff(i) {
  return [
    i.title,
    i.project + ' · ' + tag(i),
    i.url,
    i.why,
    i.watch?.answer ? 'Decision: ' + i.watch.answer : '',
    i.checkpoint ? 'Resume: ' + i.checkpoint : '',
    ...i.evidence.map((e) => [e.label, e.detail, e.url].filter(Boolean).join(' · ')),
  ]
    .filter(Boolean)
    .join('\n\n');
}
async function show(id) {
  const b = await api('action', { name: 'prepare_action', args: { id } });
  openBrief(b.item, b.checkout);
}
async function handle(a, v) {
  if (Object.hasOwn(navs, a)) {
    navigate(a);
    return;
  }
  const i = item(selected);
  if (a === 'close') {
    dialog.close();
    return;
  }
  if (a === 'brief' || a === 'back') {
    await show(v || selected);
    return;
  }
  if (a === 'filter') {
    filter = v;
    render();
    return;
  }
  if (a === 'sync') {
    const b = await op('sync_sources', {});
    const bad = Object.values(b.sync).some((s) => s.status !== 'connected');
    notice(
      board.demo
        ? 'Sample desk refreshed.'
        : bad
          ? 'Check the connection status in Workspace.'
          : 'Source check finished.',
    );
    return;
  }
  if (['capture', 'watch', 'checkpoint', 'answer', 'snooze', 'attach'].includes(a)) {
    formModal(a);
    return;
  }
  if (a === 'postpreview') {
    view = 'postpreview';
    modal(
      'Post this question?',
      i.project + ' / ' + tag(i),
      `<p>This question will be visible to participants in the source thread.</p><div class="block">${esc(i.watch.question)}</div>${link(i.url, 'Review destination')}<div class="actions">${action('post', 'Post question', 'primary')}${action('back', 'Back')}</div>`,
    );
    return;
  }
  if (a === 'post')
    await op('send_question', { id: i.id, confirmed: true, watchKey: i.watch.key }, 'Question posted.');
  else if (a === 'simulate')
    await op('sample_reply', { id: i.id }, 'Owner reply received in this sample desk.');
  else if (a === 'focus' && i.stage === 'focus') {
    const content = handoff(i);
    try {
      await navigator.clipboard.writeText(content);
      notice('Handoff copied for your coding agent.');
    } catch {
      modal('Agent handoff', tag(i), `<textarea rows="9" readonly>${esc(content)}</textarea>`);
    }
    return;
  } else {
    const state = {
      confirmReply: 'answer',
      dismissReply: 'dismiss_reply',
      focus: 'focus',
      done: 'done',
      reopen: 'reopen',
      wake: 'wake',
    }[a];
    if (!state) return;
    await op(
      'respond_to_action',
      { id: i.id, action: state, ...(a === 'confirmReply' ? { value: i.watch.candidate.body } : {}) },
      'Workspace updated.',
    );
  }
  await show(i.id);
}
function report(e) {
  const msg = e.message || String(e);
  if (dialog.open && $('#dialogError')) $('#dialogError').textContent = msg;
  else notice(msg);
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b || saving) return;
  b.disabled = true;
  try {
    await handle(b.dataset.action, b.dataset.value);
  } catch (err) {
    report(err);
  } finally {
    b.disabled = false;
  }
});
document.addEventListener('submit', async (e) => {
  if (!e.target.dataset.form) return;
  e.preventDefault();
  if (saving) return;
  saving = true;
  const form = e.target,
    k = form.dataset.form,
    data = Object.fromEntries(new FormData(form));
  const sb = form.querySelector('[type=submit]');
  sb.disabled = true;
  try {
    if (k === 'settings') {
      const list = (v) => [
        ...new Set(
          v
            .split(/[,\n]/)
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ];
      await op(
        'save_workspace',
        {
          ...data,
          repos: list(data.repos),
          projects: list(data.projects.toUpperCase()),
          jiraSite: data.jiraSite.trim().replace(/\/$/, ''),
          quietStart: +data.quietStart,
          quietEnd: +data.quietEnd,
          interval: +data.interval,
        },
        'Workspace saved.',
      );
      return;
    }
    if (!data.url) delete data.url;
    if (k === 'capture') {
      const i = await op('capture_work', data, 'Action captured.');
      await show(i.id);
      return;
    }
    if (k === 'watch')
      await op(
        'watch_for',
        { ...data, id: selected, checkAt: new Date(data.checkAt).toISOString() },
        'Watching locally.',
      );
    if (k === 'attach') await op('attach_evidence', { id: selected, ...data }, 'Evidence attached.');
    if (['checkpoint', 'answer', 'snooze'].includes(k))
      await op(
        'respond_to_action',
        {
          id: selected,
          action: k,
          value: k === 'snooze' ? new Date(data.until).toISOString() : data.value,
        },
        'Saved on this device.',
      );
    await show(selected);
  } catch (err) {
    report(err);
  } finally {
    saving = false;
    sb.disabled = false;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'find') searchRows(e.target.value);
});
$('#searchButton').onclick = () => board && search();
$('#syncButton').onclick = async (e) => {
  e.currentTarget.disabled = true;
  try {
    await handle('sync');
  } catch (err) {
    report(err);
  } finally {
    $('#syncButton').disabled = false;
  }
};
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && board) {
    e.preventDefault();
    search();
  }
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  }
});
async function tick() {
  if (document.hidden || dialog.open || page === 'settings' || saving) return;
  try {
    await refresh();
  } catch {
    notice('Local service unavailable. Reconnecting…');
  }
}
refresh().catch((e) => {
  main.textContent = 'Could not open the workspace. ' + e.message;
});
setInterval(tick, 15000);
window.addEventListener('focus', tick);
