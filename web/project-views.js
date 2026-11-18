export function projectViews({ board, header, panel, action, esc, empty, tile }) {
  const cfg = board.catalog,
    counts = new Map(cfg.boards.map((b) => [b.id, []]));
  for (const i of board.items) for (const id of i.mapping.boards) counts.get(id)?.push(i);
  const boardName = (b) =>
    esc(b.name) + ' · ' + esc(new URL(b.url).host) + ' #' + esc(b.id.split('#').at(-1));
  function projects() {
    const mapped = cfg.boards.map((b) => {
      const rows = counts.get(b.id);
      return panel(
        b.name,
        '<p class="footnote">' +
          boardName(b) +
          ' · ' +
          (b.checked
            ? 'Membership checked ' + esc(new Date(b.checked).toLocaleString())
            : 'Waiting for a board read from your agent') +
          '</p><p class="footnote">Repository hints · ' +
          (b.repos.map(esc).join(', ') || 'Any repository') +
          '</p>' +
          (rows.length
            ? rows.map((i) => tile(i)).join('')
            : empty('No personal work has a verified link to this board yet.')),
      );
    });
    const pending = board.items.filter((i) => i.mapping.repo && !i.mapping.boards.length);
    return (
      header(
        'Projects',
        'One desk across your followed boards and local checkouts.',
        action('board-form', 'Follow a board', 'primary', 'plus'),
      ) +
      '<div class="stack">' +
      (mapped.join('') ||
        panel(
          'Followed boards',
          empty('Ask your coding agent to discover your Jira boards, or add a board URL here.'),
        )) +
      panel(
        'GitHub repositories',
        cfg.repositories.map((r) => '<div class="historyrow"><b>' + esc(r) + '</b></div>').join('') ||
          empty('Select the repositories to follow through your existing coding agent.'),
        action('repo-form', 'Follow repository', 'subtle', 'plus'),
      ) +
      panel(
        'Local checkouts',
        cfg.checkouts
          .map(
            (c) =>
              '<div class="historyrow"><div><b>' +
              esc(c.repo) +
              '</b><small>' +
              esc(c.path) +
              '</small></div></div>',
          )
          .join('') || empty('Register a checkout to read its Git origin on this worker.'),
        action('checkout-form', 'Add checkout', 'subtle', 'plus'),
      ) +
      panel(
        'PRs without a verified board',
        pending.map((i) => tile(i)).join('') || empty('No unmatched PRs in your desk.'),
      ) +
      '</div>'
    );
  }
  function chart(rows) {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return (
      '<div class="bars">' +
      rows
        .map(
          ([label, v]) =>
            '<div class="bar"><span>' +
            esc(label) +
            '</span><meter aria-label="' +
            esc(label) +
            '" min="0" max="' +
            max +
            '" value="' +
            v +
            '">' +
            v +
            '</meter><b>' +
            v +
            '</b></div>',
        )
        .join('') +
      '</div>'
    );
  }
  function signals() {
    const items = board.items,
      open = items.filter((i) => i.stage !== 'done'),
      labels = {
        open: 'Available',
        focus: 'In focus',
        waiting: 'Waiting',
        ready: 'Ready to resume',
        done: 'Complete',
      };
    return (
      header('Signals', 'Current workload and actionable alerts across your projects.') +
      '<div class="stack">' +
      panel(
        'Alerts',
        board.markers
          .map(
            (m) =>
              '<div class="historyrow"><div><b>' +
              esc(m.label) +
              '</b><small>' +
              esc(m.owner) +
              '</small></div>' +
              action('brief', m.title, 'subtle', 'arrow-up-right', m.id) +
              '</div>',
          )
          .join('') || empty('No follow-ups need attention right now.'),
      ) +
      panel(
        'Personal work by state',
        chart(Object.entries(labels).map(([k, l]) => [l, items.filter((i) => i.stage === k).length])),
        '<span class="count">' + items.length + ' unique</span>',
      ) +
      panel(
        'Open work by board',
        cfg.boards.length
          ? chart(
              cfg.boards.map((b) => [
                b.name + ' · ' + b.id,
                counts.get(b.id).filter((i) => i.stage !== 'done').length,
              ]),
            ) +
              '<p class="footnote">An item can appear on several boards. Your personal queue counts it once.</p>'
          : empty('Follow a board and import its issue membership to see the distribution.'),
        '<span class="count">' + open.length + ' open overall</span>',
      ) +
      '</div>'
    );
  }
  return { projects, signals };
}
