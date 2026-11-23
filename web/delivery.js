const DAY = 86400000;
const dateKey = (d) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
function shift(d, days) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}
const fmt = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const stamp = (v) => Date.parse(v);
const age = (at, v) => Math.max(0, Math.floor((at - stamp(v)) / DAY));
const open = (t) => t.category !== 'done';
const ownerId = (t) => JSON.stringify([t.site, t.account || t.owner]);
export function signals(t, at) {
  if (!open(t)) return [];
  const tags = [];
  if (/\b(blocked|on hold|paused|impeded)\b/i.test(t.status)) tags.push('blocked');
  if (t.due && t.due < dateKey(new Date(at))) tags.push('overdue');
  if (!t.owner) tags.push('unassigned');
  if (/\breview\b/i.test(t.status)) tags.push('review');
  if (age(at, t.updated) >= 14) tags.push('quiet');
  return tags;
}
const labels = {
  all: 'All open',
  mentioned: 'Mentioned me',
  mine: 'Assigned to me',
  blocked: 'Blocked or paused',
  overdue: 'Past due',
  unassigned: 'Needs an owner',
  review: 'In review',
  quiet: 'No update in 14 days',
  done: 'Completed',
};
export function flowData(rows, at, days) {
  const end = shift(new Date(at), 1);
  end.setHours(0, 0, 0, 0);
  const start = shift(end, -days),
    previous = shift(start, -days);
  const count = Math.min(7, days),
    buckets = [];
  const during = (v, a, b) => stamp(v) >= +a && stamp(v) < +b && stamp(v) <= at;
  const resolved = (t) => t.category === 'done' && t.resolved;
  for (let i = 0; i < count; i++) {
    const a = shift(start, Math.floor((days * i) / count)),
      b = shift(start, Math.floor((days * (i + 1)) / count));
    buckets.push({
      label: fmt(a) + (days > 7 ? '–' + fmt(shift(b, -1)) : ''),
      opened: rows.filter((t) => during(t.created, a, b)),
      resolved: rows.filter((t) => during(resolved(t), a, b)),
    });
  }
  const opened = buckets.flatMap((b) => b.opened),
    closed = buckets.flatMap((b) => b.resolved);
  const times = closed
    .map((t) => (stamp(t.resolved) - stamp(t.created)) / DAY)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const quantile = (p) => (times.length ? times[Math.ceil(times.length * p) - 1] : null);
  return {
    buckets,
    opened,
    closed,
    priorOpened: rows.filter((t) => during(t.created, previous, start)).length,
    priorClosed: rows.filter((t) => during(resolved(t), previous, start)).length,
    median: times.length
      ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2
      : null,
    p85: quantile(0.85),
    measured: times.length,
    missing: rows.filter((t) => !open(t) && !Number.isFinite(stamp(t.resolved))).length,
  };
}
export function deliveryView({ board, state, esc, action, header, panel, mode }) {
  const w = board.workspace,
    sites = w.sites,
    at = Date.parse(board.time) || Date.now(),
    team = mode === 'team';
  const allBoards = sites.flatMap((s) => s.boards.map((b) => ({ ...b, site: s.id }))),
    scope = allBoards.find((b) => b.id === state.board);
  const keys = new Set(scope?.keys),
    rows = sites
      .flatMap((s) => s.tickets)
      .filter((t) => !scope || (t.site === scope.site && keys.has(t.key)));
  const active = rows.filter(open);
  const scopeText = scope ? scope.name : 'All boards';
  const select = (id, label, value, choices) =>
    '<label>' +
    esc(label) +
    '<select id="' +
    id +
    '" aria-label="' +
    esc(label) +
    '">' +
    choices
      .map(
        ([v, name]) =>
          '<option value="' +
          esc(v) +
          '" ' +
          (v === value ? 'selected' : '') +
          '>' +
          esc(name) +
          '</option>',
      )
      .join('') +
    '</select></label>';
  const boardSwitch = select('workspace-scope', 'Board', scope?.id || '', [
    ['', 'All boards'],
    ...allBoards.map((b) => [
      b.id,
      b.name + (sites.length > 1 ? ' · ' + new URL(b.url || b.id).hostname : ''),
    ]),
  ]);
  const freshness =
    (w.jiraError || sites.some((s) => s.partial) ? 'Partial Jira coverage' : 'Jira') +
    (w.checked ? ' · ' + fmt(w.checked) : '');
  const ticketRow = (t) => {
    const tags = signals(t, at),
      id = JSON.stringify([t.site, t.project, t.key]);
    const mention =
      state.lane === 'mentioned' && team
        ? board.handoffs
            ?.find((s) => s.site === t.site && s.project === t.project)
            ?.unread.find((a) => a.key === t.key)
        : null;
    return (
      '<article class="delivery-row"><button class="delivery-ticket" data-action="team-handoff" data-value="' +
      esc(mention ? JSON.stringify([t.site, t.project, t.key, mention.id, mention.comment]) : id) +
      '"><span class="ticket-key">' +
      esc(t.key) +
      '</span><span class="delivery-name"><strong>' +
      esc(t.title) +
      '</strong><small>' +
      esc(t.owner || 'Unassigned') +
      ' · ' +
      esc(t.status) +
      '</small></span><span class="row-meta">' +
      esc(tags.length ? labels[tags[0]] : t.updated ? fmt(t.updated) : '') +
      '</span></button>' +
      (team ? action('team-scope-edit', 'Edit', 'subtle', 'pencil', id) : '') +
      '</article>'
    );
  };
  const list = (data) =>
    data.length
      ? data.slice(0, state.detailLimit).map(ticketRow).join('') +
        (data.length > state.detailLimit
          ? action('delivery-more', 'Show more tickets', 'subtle', 'chevron-down')
          : '')
      : '<p class="empty">No tickets match this view.</p>';
  const note = '<small class="source-stamp">' + esc(freshness) + '</small>';
  const btn = (name, value, label, body, active = false) =>
    '<button class="delivery-card" data-action="' +
    name +
    '" data-value="' +
    esc(value) +
    '" aria-pressed="' +
    active +
    '"><span>' +
    esc(label) +
    '</span>' +
    body +
    '</button>';
  if (team) {
    const people = new Map(rows.filter((t) => t.owner).map((t) => [ownerId(t), t.owner]));
    const owner = people.has(state.owner) ? state.owner : '';
    const personal = rows.filter((t) => !owner || ownerId(t) === owner);
    const personNames = [...people]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => [
        id,
        name +
          (sites.length > 1
            ? ' · ' + new URL(sites.find((s) => s.id === JSON.parse(id)[0]).url).hostname
            : ''),
      ]);
    const mentions = new Set(
      (board.handoffs || []).flatMap((s) => s.unread.map((a) => JSON.stringify([s.site, a.key]))),
    );
    const inLane = (t, l) => {
      if (l === 'mentioned') return mentions.has(JSON.stringify([t.site, t.key]));
      if (l === 'mine') return open(t) && t.mine;
      return l === 'all' ? open(t) : l === 'done' ? !open(t) : signals(t, at).includes(l);
    };
    const lane = state.lane || 'all',
      q = (state.teamQuery || '').trim().toLowerCase();
    const rank = (t) => {
      const sig = signals(t, at);
      return sig.length ? Object.keys(labels).indexOf(sig[0]) : 99;
    };
    const shown = personal
      .filter(
        (t) =>
          inLane(t, lane) &&
          (!q || [t.key, t.title, t.owner, t.status].join(' ').toLowerCase().includes(q)),
      )
      .sort((a, b) => rank(a) - rank(b) || (stamp(b.updated) || 0) - (stamp(a.updated) || 0));
    return (
      header('Team', '', action('delivery-tools', 'Project tools', '', 'settings-2')) +
      '<div class="delivery-tools">' +
      boardSwitch +
      select('delivery-owner', 'Person', owner, [['', 'Everyone'], ...personNames]) +
      note +
      '</div>' +
      '<div class="handoff-layout"><aside class="handoff-rail"><h2>Handoffs</h2>' +
      Object.entries(labels)
        .map(([id, name]) =>
          btn(
            'delivery-lane',
            id,
            name,
            '<b>' + personal.filter((t) => inLane(t, id)).length + '</b>',
            lane === id,
          ),
        )
        .join('') +
      '</aside>' +
      panel(
        labels[lane],
        '<label class="ticket-search">Find a ticket<input id="delivery-search" type="search" maxlength="150" placeholder="Ticket key, title or owner" value="' +
          esc(state.teamQuery || '') +
          '"></label><div class="ticket-results">' +
          list(shown) +
          '</div>',
        '<span class="count">' + shown.length + '</span>',
      ) +
      '</div>'
    );
  }
  const days = state.days || 30,
    f = flowData(rows, at, days),
    max = Math.max(1, ...f.buckets.flatMap((b) => [b.opened.length, b.resolved.length]));
  const delta = (n, prev) => {
    const v = n - prev;
    return (v > 0 ? '+' : '') + v + ' vs previous ' + days + ' days';
  };
  const dayValue = (n) =>
    n === null ? '—' : n < 1 ? Math.round(n * 24) + 'h' : Number(n.toFixed(1)) + 'd';
  const card = (id, name, n, sub) =>
    btn(
      'delivery-drill',
      id,
      name,
      '<strong>' + esc(n) + '</strong><small>' + esc(sub) + '</small>',
      state.drill === id,
    );
  const graphs = f.buckets
    .map((b, i) => {
      const h = (n) => Math.round((64 * n) / max);
      return (
        '<button class="flow-bucket" data-action="delivery-drill" data-value="bucket-' +
        i +
        '" aria-label="' +
        esc(b.label + ': ' + b.opened.length + ' opened, ' + b.resolved.length + ' resolved') +
        '"><svg aria-hidden="true" viewBox="0 0 52 74"><line x1="0" x2="52" y1="70" y2="70"/><rect class="intake" x="7" y="' +
        (70 - h(b.opened.length)) +
        '" width="17" height="' +
        h(b.opened.length) +
        '"/><rect class="resolved" x="28" y="' +
        (70 - h(b.resolved.length)) +
        '" width="17" height="' +
        h(b.resolved.length) +
        '"/></svg><b>' +
        b.opened.length +
        ' / ' +
        b.resolved.length +
        '</b><small>' +
        esc(b.label) +
        '</small></button>'
      );
    })
    .join('');
  const bins = [
    [0, 7],
    [7, 30],
    [30, 90],
    [90, Infinity],
  ].map(([low, high]) => ({
    name: high === Infinity ? '90+ days' : low + '–' + (high - 1) + ' days',
    tickets: active.filter((t) => age(at, t.created) >= low && age(at, t.created) < high),
  }));
  const drills = {
    opened: ['Opened in period', f.opened],
    resolved: ['Resolved in period', f.closed],
    duration: [
      'Resolved tickets by turnaround',
      f.closed
        .filter((t) => Number.isFinite(stamp(t.created)) && stamp(t.resolved) >= stamp(t.created))
        .sort((a, b) => stamp(b.resolved) - stamp(b.created) - (stamp(a.resolved) - stamp(a.created))),
    ],
    quiet: [
      labels.quiet,
      active
        .filter((t) => signals(t, at).includes('quiet'))
        .sort((a, b) => stamp(a.updated) - stamp(b.updated)),
    ],
    overdue: [
      labels.overdue,
      active
        .filter((t) => signals(t, at).includes('overdue'))
        .sort((a, b) => a.due.localeCompare(b.due)),
    ],
  };
  bins.forEach((b, i) => {
    drills['age-' + i] = [
      b.name + ' open',
      b.tickets.sort((a, c) => stamp(a.created) - stamp(c.created)),
    ];
  });
  f.buckets.forEach((b, i) => {
    drills['bucket-' + i] = [
      b.label + ' · opened or resolved',
      [...new Set([...b.opened, ...b.resolved])],
    ];
  });
  const comparisons = (scope ? [scope] : allBoards)
    .map((b) => {
      const membership = new Set(b.keys);
      const group = active.filter((t) => t.site === b.site && membership.has(t.key));
      const holds = group.filter((t) => signals(t, at).includes('blocked')),
        reviews = group.filter((t) => signals(t, at).includes('review'));
      const detail = [...new Set([...holds, ...reviews])].sort(
        (a, c) => stamp(a.updated) - stamp(c.updated),
      );
      drills['risk-' + b.id] = [b.name + ' · blocked or in review', detail];
      return { b, holds: holds.length, reviews: reviews.length, total: group.length, detail };
    })
    .sort((a, b) => b.detail.length - a.detail.length);
  const current = drills[state.drill] || drills.overdue;
  const [name, tickets] = current;
  const comparison = panel(
    'Handoffs by board',
    '<div class="board-grid"><div class="board-grid-head"><b>Board</b><b>Open</b><b>Blocked</b><b>Review</b></div>' +
      comparisons
        .map(
          ({ b, holds, reviews, total }) =>
            '<button class="board-grid-row" data-action="delivery-drill" data-value="' +
            esc('risk-' + b.id) +
            '"><strong>' +
            esc(b.name) +
            '</strong><span>' +
            total +
            '</span><span>' +
            holds +
            '</span><span>' +
            reviews +
            '</span></button>',
        )
        .join('') +
      '</div>',
  );
  return (
    '<div class="delivery-tools">' +
    boardSwitch +
    select(
      'delivery-days',
      'Period',
      String(days),
      [7, 30, 90].map((n) => [String(n), 'Last ' + n + ' days']),
    ) +
    note +
    '</div>' +
    '<div class="delivery-metrics">' +
    card('opened', 'Opened', f.opened.length, delta(f.opened.length, f.priorOpened)) +
    card('resolved', 'Resolved', f.closed.length, delta(f.closed.length, f.priorClosed)) +
    card('duration', 'Median turnaround', dayValue(f.median), '85th percentile · ' + dayValue(f.p85)) +
    card('overdue', 'Past due', drills.overdue[1].length, 'Open past the Jira due date') +
    card('quiet', 'Quiet open tickets', drills.quiet[1].length, 'No Jira update in 14 days') +
    '</div>' +
    '<div class="flow-layout">' +
    panel(
      'Intake and resolution',
      '<div class="flow-legend"><span>Opened</span><span>Resolved</span></div><div class="flow-buckets">' +
        graphs +
        '</div><small class="source-stamp">' +
        esc(scopeText) +
        ' · ' +
        f.measured +
        ' resolved tickets with measured turnaround' +
        (f.missing ? ' · ' + f.missing + ' done without resolution dates' : '') +
        '</small>',
    ) +
    panel(
      'Age of open work',
      bins
        .map(
          (b, i) =>
            '<button class="age-row" data-action="delivery-drill" data-value="age-' +
            i +
            '"><span>' +
            b.name +
            '</span><meter min="0" max="' +
            Math.max(1, ...bins.map((x) => x.tickets.length)) +
            '" value="' +
            b.tickets.length +
            '"></meter><strong>' +
            b.tickets.length +
            '</strong></button>',
        )
        .join(''),
      '<span class="count">' + active.length + ' open</span>',
    ) +
    '</div>' +
    comparison +
    '<div id="delivery-detail">' +
    panel(name, list(tickets), '<span class="count">' + tickets.length + '</span>') +
    '</div>' +
    '<details class="panel source-drawer"><summary>Measurement details</summary><p>Counts use the current board membership and Jira creation and resolution dates. Reopened tickets count as open. Turnaround runs from creation to the current resolution. Quiet measures time since the last recorded update. The period includes today.</p></details>'
  );
}
