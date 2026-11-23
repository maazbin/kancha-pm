export function workViews({ board, header, panel, action, esc, date, empty, tile, scope }) {
  const at = Date.parse(board.time);
  const byId = new Map(board.items.map((i) => [i.id, i]));
  const open = board.items.filter((i) => i.stage !== 'done');
  const snoozed = (i) => Date.parse(i.snooze) > at;
  const metric = (label, n) => '<div><strong>' + n + '</strong><small>' + esc(label) + '</small></div>';
  const metrics = (...rows) => '<div class="desk-metrics">' + rows.join('') + '</div>';
  function priority() {
    const matches = (i) => !scope || i.mapping.boards.includes(scope);
    const agenda = board.agenda.map((id) => byId.get(id)).filter(matches);
    const filtered = open.filter(matches);
    const options = board.catalog.boards
      .map(
        (b) =>
          '<option value="' +
          esc(b.id) +
          '" ' +
          (scope === b.id ? 'selected' : '') +
          '>' +
          esc(b.name) +
          '</option>',
      )
      .join('');
    const ranking = agenda
      .map(
        (i, n) =>
          '<div class="rank-row"><span class="rank">' +
          (n + 1) +
          '</span><div><strong>' +
          esc(i.title) +
          '</strong><small>' +
          esc(i.project) +
          ' · ' +
          esc(i.factors.map(([reason]) => reason).join(' · ') || 'Oldest available first') +
          '</small><p>' +
          esc(i.why) +
          '</p></div>' +
          '<div class="actions">' +
          action('brief', 'Open brief', 'subtle', 'arrow-up-right', i.id) +
          action('priority-edit', 'Set priority', 'subtle', 'list-ordered', i.id) +
          '</div>' +
          '</div>',
      )
      .join('');
    return (
      header('Priority', 'Which action comes first, and what puts it there.') +
      '<label class="scope-label">Board <select id="priority-scope" aria-label="Board"><option value="">All boards and unlinked work</option>' +
      options +
      '</select></label>' +
      metrics(
        metric('Ready to act', agenda.length),
        metric('Waiting on others', filtered.filter((i) => i.stage === 'waiting').length),
        metric(
          'Urgent and open',
          filtered.filter((i) => (i.personalPriority || i.priority) === 'urgent').length,
        ),
      ) +
      panel('Recommended order', ranking || empty('No available actions in this scope.')) +
      panel(
        'Waiting on a decision',
        filtered
          .filter((i) => i.stage === 'waiting')
          .map((i) => tile(i))
          .join('') || empty('No decisions are holding up this scope.'),
      )
    );
  }
  function alarms() {
    const next = open
      .flatMap((i) => {
        if (snoozed(i)) return [{ i, due: i.snooze, label: 'Snooze ends' }];
        const times = [];
        if (i.watch?.status === 'waiting' && Date.parse(i.watch.checkAt) > at)
          times.push({ i, due: i.watch.checkAt, label: 'Check with ' + i.watch.owner });
        if (Date.parse(i.due) > at) times.push({ i, due: i.due, label: 'Work due' });
        return times;
      })
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
    const row = (i, label, when) =>
      '<div class="alarm-row"><div><b>' +
      esc(label) +
      '</b><strong>' +
      esc(i.title) +
      '</strong><small>' +
      esc([i.project, date(when)].filter(Boolean).join(' · ')) +
      '</small></div>' +
      action('brief', 'Review', 'subtle', 'arrow-up-right', i.id) +
      '</div>';
    return (
      header('Alarms', 'Deadline warnings, owner replies and scheduled reminders.') +
      metrics(
        metric('Active alarms', board.markers.length),
        metric('Upcoming reminders', next.length),
        metric('Snoozed actions', open.filter(snoozed).length),
      ) +
      panel(
        'Needs attention',
        board.markers.map((m) => row(byId.get(m.id), m.label, m.when)).join('') ||
          empty('All clear. No active alarms.'),
        '<span class="count">' +
          (board.quiet ? 'Quiet hours' : 'Notifications active during working hours') +
          '</span>',
      ) +
      panel(
        'Scheduled',
        next.map((n) => row(n.i, n.label, n.due)).join('') ||
          empty('Schedule a follow-up or snooze an action from its brief.'),
      )
    );
  }
  function analytics() {
    const flow = board.flow,
      peak = Math.max(1, ...flow.flatMap((f) => [f.added, f.completed]));
    const bar = (name, n) =>
      '<meter aria-label="' +
      esc(name) +
      '" value="' +
      n +
      '" max="' +
      peak +
      '">' +
      n +
      '</meter><b>' +
      n +
      '</b>';
    const stalled = open
      .filter((i) => i.stage === 'waiting')
      .sort((a, b) => Date.parse(a.watch?.started) - Date.parse(b.watch?.started));
    const intake = flow.reduce((n, d) => n + d.added, 0),
      finished = flow.reduce((n, d) => n + d.completed, 0);
    const flowText =
      !intake && !finished
        ? 'No intake or completions were recorded in the last seven days.'
        : intake === finished
          ? 'Intake and completions were even this week.'
          : intake > finished
            ? 'New actions outpaced completions by ' + (intake - finished) + ' this week.'
            : 'Completions outpaced new actions by ' + (finished - intake) + ' this week.';
    return (
      header('Analytics', 'Seven days of personal activity and the work waiting longest.') +
      '<div class="insight-band"><strong>' +
      esc(flowText) +
      '</strong>' +
      (stalled.length
        ? '<p>The longest wait is ' +
          esc(stalled[0].title) +
          '. ' +
          esc(stalled[0].watch?.owner || 'The decision owner') +
          ' has the next response.</p>' +
          action('brief', 'Review this wait', 'subtle', 'arrow-up-right', stalled[0].id)
        : '') +
      '</div>' +
      metrics(
        metric(
          'Added in 7 days',
          flow.reduce((s, d) => s + d.added, 0),
        ),
        metric(
          'Completions in 7 days',
          flow.reduce((s, d) => s + d.completed, 0),
        ),
        metric('Open actions', open.length),
      ) +
      panel(
        'Intake and completions',
        '<div class="flow-head"><span>Day</span><b>Added</b><b>Completed</b></div>' +
          flow
            .map((f) => {
              const label = f.label;
              return (
                '<div class="flow-line"><span>' +
                esc(label) +
                '</span><div>' +
                bar(label + ' added', f.added) +
                '</div><div>' +
                bar(label + ' completed', f.completed) +
                '</div></div>'
              );
            })
            .join('') +
          '<p class="footnote">Counts use recorded events for currently visible work, grouped by day on the worker. Completing a reopened action adds another completion.</p>',
      ) +
      panel(
        'Longest waits',
        stalled
          .map(
            (i) =>
              '<div class="alarm-row"><div><strong>' +
              esc(i.title) +
              '</strong><small>' +
              esc(i.watch?.owner) +
              ' · waiting since ' +
              esc(date(i.watch?.started)) +
              '</small></div>' +
              action('brief', 'Open brief', 'subtle', 'arrow-up-right', i.id) +
              '</div>',
          )
          .join('') || empty('No work is waiting on a decision.'),
      )
    );
  }
  return { priority, alarms, analytics };
}

export function chatView({ header, panel }) {
  return (
    header('PM chat', 'Ask your coding agent about the work on this desk.') +
    panel('Conversation', '<div id="chat-history" aria-live="polite">Loading conversation…</div>') +
    '<form class="panel stack" id="chat-form"><label class="formrow">Answer with<select name="engine"><option value="session">Open coding session (MCP)</option><option value="claude">Claude Code CLI</option><option value="codex">Codex CLI</option></select></label><p id="chat-engine-help" class="footnote"></p><label class="formrow">Your question<textarea rows="3" name="question" required maxlength="3000" placeholder="Which review should I take first, and why?"></textarea></label><button type="submit" class="btn primary">Send question</button><p id="chat-error" role="alert"></p></form>'
  );
}

export function chatController({ api, esc, action, date }) {
  let question = '',
    engine = 'session',
    loading = false;
  const names = { session: 'Open coding session', claude: 'Claude Code', codex: 'Codex' };
  async function poll() {
    const target = document.querySelector('#chat-history');
    if (!target || loading) return;
    loading = true;
    try {
      const rows = await api('chat');
      if (!target.isConnected) return;
      const pending = rows.some((r) => ['waiting', 'running'].includes(r.status));
      document.querySelector('#chat-form button[type=submit]').disabled = pending;
      const transcript =
        rows
          .map((r) => {
            const text =
              r.status === 'waiting'
                ? 'Waiting for your coding session. Tell your agent “Answer my pending Kancha browser chat” to deliver the reply here.'
                : r.status === 'running'
                  ? 'Waiting for the local CLI to answer…'
                  : r.status === 'cancelled'
                    ? 'Question cancelled.'
                    : r.answer;
            return (
              '<article class="chat-turn"><small>You · ' +
              esc(date(r.created)) +
              '</small><p>' +
              esc(r.question) +
              '</p><b>' +
              esc(names[r.engine]) +
              '</b><p>' +
              esc(text) +
              '</p>' +
              (r.status === 'waiting'
                ? action('cancel-chat', 'Cancel waiting question', 'subtle', 'x', r.id)
                : '') +
              '</article>'
            );
          })
          .join('') || '<p class="empty">Your first question and its reply will appear here.</p>';
      if (target.innerHTML !== transcript) {
        const nearEnd = target.scrollHeight - target.scrollTop - target.clientHeight < 40;
        target.innerHTML = transcript;
        if (nearEnd) target.scrollTop = target.scrollHeight;
      }
    } catch (err) {
      if (target.isConnected) target.textContent = err.message;
    } finally {
      loading = false;
    }
  }
  function bind() {
    const form = document.querySelector('#chat-form');
    form.engine.value = engine;
    form.question.value = question;
    const hint = () => {
      document.querySelector('#chat-engine-help').textContent =
        engine === 'session'
          ? 'Your open agent can pick up the question through Kancha MCP. Ask it to answer your pending browser chat.'
          : 'Send starts the selected CLI under its existing login. It receives this question, up to 25 open actions and the last four answered turns with this engine. It can advise on the desk.';
    };
    hint();
    form.engine.onchange = () => {
      engine = form.engine.value;
      hint();
    };
    form.question.oninput = () => {
      question = form.question.value;
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('button[type=submit]'),
        error = form.querySelector('#chat-error');
      button.disabled = true;
      try {
        await api('chat', { id: crypto.randomUUID(), engine, question });
        question = '';
        form.question.value = '';
        error.textContent = '';
      } catch (err) {
        error.textContent = err.message;
      }
      await poll();
    };
    void poll();
  }
  return { poll, bind };
}
