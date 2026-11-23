export function workspaceView({ board, esc, action, panel, header, state, mode }) {
  const w = board.workspace,
    sites = w.sites,
    boards = sites.flatMap((s) => s.boards),
    all = sites.flatMap((s) => s.tickets),
    group = boards.find((b) => b.id === state.board);
  const groupSite = sites.find((s) => s.boards.includes(group)),
    keys = new Set(group?.keys || []);
  const rows = group ? all.filter((t) => t.site === groupSite?.id && keys.has(t.key)) : all;
  const stages = [
    ['new', 'To do'],
    ['indeterminate', 'In progress'],
    ['done', 'Done'],
    ['unknown', 'Other'],
  ];
  const count = (k) => rows.filter((t) => t.category === k).length;
  const id = (t) => JSON.stringify([t.site, t.project, t.key]);
  const date = (v) =>
    v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const category = (k) => (stages.some(([v]) => v === k) ? k : 'unknown');
  const last = rows.toSorted((a, b) => (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0));
  const trace = (t) => {
    const site = sites.find((s) => s.id === t.site),
      url = new URL('/browse/' + t.key, site.url).href;
    const prs = w.pulls.filter((p) => p.linkedIssues.includes(url));
    return (
      '<button class="trace-row" data-action="team-handoff" data-value="' +
      esc(id(t)) +
      '"><span class="trace-dot ' +
      category(t.category) +
      '"></span><span class="trace-copy"><small>' +
      esc(t.key) +
      ' · ' +
      esc(t.owner || 'Unassigned') +
      '</small><strong>' +
      esc(t.title) +
      '</strong></span><span class="trace-tags">' +
      (prs.length ? '<b>' + prs.length + ' PR</b>' : '') +
      '<span>' +
      esc(t.status) +
      '</span></span><time>' +
      esc(date(t.updated)) +
      '</time><img class="icon" src="/icons/chevron-right.svg" alt=""></button>'
    );
  };
  const traces = (limit) =>
    last.slice(0, limit).map(trace).join('') || '<p class="empty">No visible tickets in this view.</p>';
  let position = 0;
  const segments = stages
    .map(([k]) => {
      const width = (100 * count(k)) / Math.max(1, rows.length),
        x = position;
      position += width;
      return '<rect class="' + k + '" x="' + x + '" width="' + width + '" height="8"/>';
    })
    .join('');
  const statusChart =
    '<svg class="status-strip" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="Ticket distribution by Jira status">' +
    segments +
    '</svg><div class="stage-grid">' +
    stages
      .filter(([k]) => k !== 'unknown' || count(k))
      .map(
        ([k, label]) =>
          '<div><small><i class="trace-dot ' +
          k +
          '"></i>' +
          label +
          '</small><strong>' +
          count(k) +
          '</strong></div>',
      )
      .join('') +
    '</div>';
  const boardControl =
    '<label class="board-select">Board<select id="workspace-scope"><option value="">All boards</option>' +
    sites
      .map(
        (s) =>
          '<optgroup label="' +
          esc(new URL(s.url).hostname) +
          '">' +
          s.boards
            .map(
              (b) =>
                '<option value="' +
                esc(b.id) +
                '" ' +
                (state.board === b.id ? 'selected' : '') +
                '>' +
                esc(b.name) +
                '</option>',
            )
            .join('') +
          '</optgroup>',
      )
      .join('') +
    '</select></label>';
  const partial = sites.some((s) => s.partial) || w.jiraError;
  const freshness = partial
    ? 'Partial Jira data'
    : w.checked
      ? 'Synced ' + date(w.checked)
      : board.discovering
        ? 'Discovering boards…'
        : 'Waiting for a Jira check';
  if (mode === 'desk')
    return panel(
      'Recent ticket activity',
      traces(5),
      action('projects', 'All boards', 'subtle', 'panels-top-left'),
    );
  if (mode === 'analytics')
    return (
      panel(
        'Board workload',
        boardControl + statusChart,
        '<span class="count">' + rows.length + ' tickets</span>',
      ) + panel('Latest ticket updates', traces(6))
    );
  const repositories = w.repos;
  const repoList =
    '<details class="panel source-drawer" id="repo-drawer"><summary>Repositories <span>' +
    w.repos.length +
    '</span></summary><small>' +
    esc(
      w.githubVia === 'agent'
        ? 'From your coding agent'
        : w.githubVia === 'plugin'
          ? 'From your GitHub connection'
          : w.githubVia === 'cli'
            ? 'From GitHub CLI'
            : 'GitHub discovery unavailable',
    ) +
    (w.githubChecked ? ' · ' + esc(date(w.githubChecked)) : '') +
    (w.githubPartial ? ' · Partial results' : '') +
    '</small><label class="formrow">Find repository<input id="ws-repo-search" placeholder="Name or organization"></label><div id="ws-repo-list">' +
    repositories.map((r) => action('ws-repo', r, 'repo-chip', 'git-fork', r)).join('') +
    '</div></details>';
  return (
    header(
      'Projects',
      sites.map((s) => new URL(s.url).hostname).join(' · '),
      action('sync', 'Refresh workspace', '', 'refresh-cw'),
    ) +
    '<div class="workspace-overview"><div class="workspace-total"><span>Connected boards</span><strong>' +
    boards.length +
    '</strong><small>' +
    esc(freshness) +
    '</small></div><div class="workspace-summary"><div class="sectionhead"><h2>Delivery status</h2>' +
    boardControl +
    '</div>' +
    statusChart +
    '</div></div>' +
    '<div class="workspace-split">' +
    panel(
      'Ticket activity',
      traces(state.limit) +
        (last.length > state.limit
          ? action('ws-more', 'Show more updates', 'subtle', 'chevron-down')
          : ''),
      '<span class="count">' + rows.length + '</span>',
    ) +
    panel(
      'Boards',
      sites
        .map((s) =>
          s.boards
            .map(
              (b) =>
                '<button class="board-pick" data-action="ws-board" data-value="' +
                esc(b.id) +
                '" aria-pressed="' +
                (state.board === b.id) +
                '"><img class="icon" src="/icons/panels-top-left.svg" alt=""><span><strong>' +
                esc(b.name) +
                '</strong><small>' +
                esc(b.project || new URL(s.url).hostname) +
                '</small></span><b>' +
                b.keys.length +
                (b.partial ? '*' : '') +
                '</b></button>',
            )
            .join(''),
        )
        .join('') || '<p class="empty">No boards returned.</p>',
    ) +
    '</div>' +
    repoList
  );
}
