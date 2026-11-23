const labels = {
  summary: 'Title',
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  duedate: 'Due date',
  comment: 'Comment',
  create: 'New ticket',
};
export function teamView({ api, esc, action, header, panel, modal, notice, link, desk, refresh }) {
  let site = '',
    project = '',
    owner = '*',
    sites = [],
    projects = [],
    rows = [],
    next = null,
    version = 0,
    loaded = false;
  const box = () => document.querySelector('#team-content');
  const people = new Map();
  const read = (operation, extra = {}) => api('team', { action: operation, site, project, ...extra });
  const options = (values, selected) =>
    values
      .map(
        (x) =>
          '<option value="' +
          esc(x.id) +
          '" ' +
          (x.id === selected ? 'selected' : '') +
          '>' +
          esc(x.name) +
          '</option>',
      )
      .join('');
  const select = (label, id, values, current) =>
    '<label class="formrow">' +
    label +
    '<select id="' +
    id +
    '" aria-label="' +
    label +
    '">' +
    options(values, current) +
    '</select></label>';
  function clear() {
    people.clear();
    rows = [];
    next = null;
    loaded = false;
    owner = '*';
  }
  function paint() {
    const root = box();
    if (!root) return;
    const draft = root.querySelector('#team-search input')?.value || '';
    for (const r of rows) people.set(r.account || '', r.owner || 'Unassigned');
    const view = rows.filter((r) => owner === '*' || (r.account || '') === owner);
    const active = view.filter((r) => !r.done);
    const fmt = new Date(),
      today = [
        fmt.getFullYear(),
        String(fmt.getMonth() + 1).padStart(2, '0'),
        String(fmt.getDate()).padStart(2, '0'),
      ].join('-');
    const late = active.filter((r) => r.due && r.due < today);
    const unassigned = active.filter((r) => !r.account);
    const followed = desk().handoffs.find((s) => s.site === site && s.project === project);
    root.innerHTML =
      '<div class="team-controls">' +
      select(
        'Jira site',
        'team-site',
        sites.map((s) => ({ id: s.id, name: new URL(s.url).hostname })),
        site,
      ) +
      select(
        'Project',
        'team-project',
        [
          { id: '', name: 'Choose a project' },
          ...projects.map((p) => ({ id: p.key, name: p.name + ' (' + p.key + ')' })),
        ],
        project,
      ) +
      (loaded
        ? select(
            'Person',
            'team-person',
            [
              { id: '*', name: 'Everyone' },
              ...[...people].map(([id, name]) => ({ id, name })),
              { id: '?', name: 'Find another colleague…' },
            ],
            owner,
          )
        : '') +
      '</div>' +
      (!project
        ? '<p>Select a project to see its shared tickets.</p>'
        : !loaded
          ? '<p role="status">Loading tickets…</p>'
          : panel(
              'Before you start',
              '<form id="team-search" class="inlineform"><label class="formrow">What are you about to work on?<input name="topic" required minlength="2" maxlength="150" placeholder="Sandbox testing environment"></label><button class="btn primary">Find existing work</button><small>Search this project and the projects you follow for mentions.</small></form>',
            ) +
            panel(
              'Your mentions',
              (followed
                ? '<p>Following ' +
                  esc(project) +
                  ' on this desk. ' +
                  (followed.checked
                    ? 'Last checked ' + esc(new Date(followed.checked).toLocaleString()) + '.'
                    : 'Waiting for the first check.') +
                  '</p>'
                : '<p>Get a private reminder when a recent ticket description or comment mentions your Jira account.</p>') +
                (followed?.note ? '<p role="status">' + esc(followed.note) + '</p>' : '') +
                (followed?.unread || [])
                  .map((a) =>
                    action(
                      'team-handoff',
                      'Review ' + a.key,
                      '',
                      'at-sign',
                      JSON.stringify([site, project, a.key, a.id, a.comment]),
                    ),
                  )
                  .join('') +
                '<div class="actions">' +
                (followed ? action('team-check', 'Check mentions') : '') +
                action(
                  'team-follow',
                  followed ? 'Stop following mentions' : 'Follow mentions',
                  'subtle',
                  'bell',
                  followed ? 'off' : 'on',
                ) +
                '</div>',
            ) +
            (followed?.recent?.length
              ? panel(
                  'Opened in the last two days',
                  followed.recent
                    .map((r) => action('team-timeline', r.key, 'subtle', 'history', r.key))
                    .join(''),
                )
              : '') +
            panel(
              'Project at a glance',
              '<p class="team-insight"><strong>' +
                active.length +
                ' open ' +
                (active.length === 1 ? 'ticket' : 'tickets') +
                '</strong> ' +
                (owner === '*' ? 'across this view' : 'for ' + esc(people.get(owner) || 'this person')) +
                '. ' +
                (late.length ? late.length + ' past due. ' : '') +
                (unassigned.length
                  ? unassigned.length +
                    (unassigned.length === 1 ? ' needs an owner.' : ' need an owner.')
                  : '') +
                '</p><small>' +
                view.length +
                ' shown · ' +
                (next ? 'More tickets available' : 'All loaded') +
                '</small>',
            ) +
            panel(
              'Tickets',
              view
                .map(
                  (r) =>
                    '<article class="team-ticket"><div><small>' +
                    esc(r.key) +
                    ' · ' +
                    esc(r.priority) +
                    '</small><strong>' +
                    esc(r.summary) +
                    '</strong><span>' +
                    esc(r.owner || 'Unassigned') +
                    ' · ' +
                    esc(r.status) +
                    (r.due ? ' · Due ' + esc(r.due) : '') +
                    '</span></div>' +
                    action('team-timeline', 'Timeline', 'subtle', 'history', r.key) +
                    action('team-edit', 'View ticket', 'subtle', 'arrow-up-right', r.key) +
                    '</article>',
                )
                .join('') || '<p>No tickets match this view.</p>',
              action('team-create', 'New ticket', 'subtle', 'plus'),
            ) +
            '<div class="actions">' +
            (next ? action('team-more', 'Load more tickets') : '') +
            action('team-refresh', 'Refresh tickets', 'subtle', 'refresh-cw') +
            '</div>');
    const search = root.querySelector('#team-search');
    if (search) search.elements.topic.value = draft;
    if (search)
      search.onsubmit = async (e) => {
        e.preventDefault();
        const query = search.elements.topic.value.trim();
        const scopes = [
          { site, project },
          ...desk().handoffs.filter((s) => s.site !== site || s.project !== project),
        ];
        modal('Existing work', query, '<p id="team-results" role="status">Searching projects…</p>');
        const out = document.querySelector('#team-results');
        const results = await Promise.allSettled(
          scopes.map((s) => read('search', { site: s.site, project: s.project, query })),
        );
        if (!out.isConnected) return;
        out.innerHTML = results
          .map((result, i) => {
            const scope = scopes[i],
              siteName = sites.find((s) => s.id === scope.site)?.url;
            const group =
              '<strong>' +
              esc(scope.project) +
              (siteName ? ' · ' + esc(new URL(siteName).hostname) : '') +
              '</strong>';
            if (result.status === 'rejected')
              return group + '<p>Search unavailable for this project.</p>';
            return (
              group +
              (result.value.items
                .map(
                  (r) =>
                    '<div class="historyrow"><div><strong>' +
                    esc(r.summary) +
                    '</strong><small>' +
                    esc(r.key + ' · ' + (r.owner || 'Unassigned') + ' · ' + r.status) +
                    '</small></div>' +
                    action(
                      'team-handoff',
                      'Open timeline',
                      'subtle',
                      'history',
                      JSON.stringify([scope.site, scope.project, r.key]),
                    ) +
                    '</div>',
                )
                .join('') || '<p>No matching tickets found.</p>') +
              (result.value.partial ? '<small>Showing the first 40 matches.</small>' : '')
            );
          })
          .join('<hr class="hr">');
      };
    root.querySelector('#team-site').onchange = (e) => {
      site = e.target.value;
      project = '';
      projects = [];
      clear();
      void run('projects');
    };
    root.querySelector('#team-project').onchange = (e) => {
      project = e.target.value;
      clear();
      if (project) void run('tickets');
      else {
        version++;
        paint();
      }
    };
    const person = root.querySelector('#team-person');
    if (person)
      person.onchange = (e) => {
        if (e.target.value === '?') {
          e.target.value = owner;
          modal(
            'Find a colleague',
            project,
            '<form class="inlineform" id="lookup-person"><label class="formrow">Name<input required maxlength="100" name="query"></label><button class="btn" type="submit">Find people</button><div role="status"></div></form>',
          );
          const form = document.querySelector('#lookup-person');
          form.onsubmit = async (event) => {
            event.preventDefault();
            const b = form.querySelector('button'),
              out = form.querySelector('[role=status]');
            b.disabled = true;
            try {
              const result = await read('people', { query: form.elements.query.value });
              out.innerHTML =
                result.people
                  .map((u) => action('team-person-pick', u.name, 'subtle', 'user', u.id))
                  .join('') || 'No assignable colleagues matched that name.';
              for (const u of result.people) people.set(u.id, u.name);
            } catch (error) {
              out.textContent = error.message;
            } finally {
              b.disabled = false;
            }
          };
        } else {
          owner = e.target.value;
          void run('tickets');
        }
      };
  }
  async function run(task, more = false) {
    const seq = ++version,
      root = box();
    if (!root) return;
    const current = () => root.isConnected && seq === version;
    if (!more) root.textContent = 'Loading shared work…';
    try {
      if (task === 'sites') {
        const data = await read('sites');
        if (!current()) return;
        sites = data.sites;
        if (!sites.length) {
          site = '';
          project = '';
          projects = [];
          clear();
          root.innerHTML = panel(
            'Connect Jira to see team tickets',
            '<p>Sign in with your own Jira account to browse the projects and tickets you can access.</p>',
            action('connections', 'Open plugins', 'primary', 'plug'),
          );
          return;
        }
        if (!sites.some((s) => s.id === site)) {
          site = sites[0].id;
          project = '';
          clear();
        }
        task = 'projects';
      }
      if (task === 'projects') {
        const data = await read('projects');
        if (!current()) return;
        projects = data.projects;
        if (!projects.some((p) => p.key === project)) {
          project = '';
          clear();
        }
        if (!project) project = projects[0]?.key || '';
        if (!project) {
          paint();
          return;
        }
      }
      const data = await read('tickets', { owner, ...(more ? { next } : {}) });
      if (!current()) return;
      rows = [...new Map([...(more ? rows : []), ...data.items].map((r) => [r.key, r])).values()];
      next = data.next;
      loaded = true;
      paint();
    } catch (e) {
      if (!current()) return;
      clear();
      root.innerHTML = panel(
        'Could not load shared tickets',
        '<p>' + esc(e.message) + '</p>',
        action('team-reload', 'Try again'),
      );
    }
  }
  async function edit(key) {
    const creating = !key;
    const data = creating ? { ticket: null, options: {} } : await read('details', { key });
    const r = data.ticket;
    const opts = creating
      ? ['create']
      : ['summary', 'status', 'assignee', 'priority', 'duedate', 'comment'];
    const siteUrl = sites.find((s) => s.id === site)?.url;
    modal(
      creating ? 'New ticket' : r.key,
      creating ? project : r.summary,
      (r
        ? '<p>' +
          esc(r.owner || 'Unassigned') +
          ' · ' +
          esc(r.status) +
          ' · ' +
          esc(r.priority) +
          '</p>' +
          link(siteUrl + '/browse/' + r.key, 'Open full ticket in Jira')
        : '') +
        '<form class="inlineform" id="ticket-edit">' +
        (creating
          ? ''
          : select(
              'Change',
              'ticket-field',
              opts.map((k) => ({ id: k, name: labels[k] })),
              'summary',
            )) +
        '<div id="ticket-value"></div><button class="btn primary" type="submit">Review change</button><p role="alert" class="team-error"></p></form>',
    );
    const form = document.querySelector('#ticket-edit');
    const current = () => (creating ? 'create' : form.querySelector('#ticket-field').value);
    function field() {
      const k = current(),
        value =
          {
            summary: r?.summary,
            status: r?.status,
            priority: r?.priority,
            duedate: r?.due,
            assignee: r?.account,
          }[k] || '';
      const choices = data.options[k];
      form.querySelector('#ticket-value').innerHTML =
        k === 'status' || k === 'assignee'
          ? select(
              labels[k],
              'ticket-input',
              [...(k === 'assignee' ? [{ id: '', name: 'Unassigned' }] : []), ...choices],
              value,
            )
          : '<label class="formrow">' +
            (creating ? 'Title' : labels[k]) +
            '<input id="ticket-input" type="' +
            (k === 'duedate' ? 'date' : 'text') +
            '" ' +
            (k === 'duedate' ? '' : 'required') +
            ' value="' +
            esc(value) +
            '"></label>' +
            (creating
              ? '<label class="formrow">Ticket type<input name="type" value="Task" required></label>'
              : '');
      form.querySelector('button[type=submit]').disabled = k === 'status' && !choices.length;
    }
    field();
    if (!creating) form.querySelector('#ticket-field').onchange = field;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      try {
        const k = current();
        const plan = await read('preview', {
          key,
          edit: {
            field: k,
            value: form.querySelector('#ticket-input').value,
            type: form.elements.type?.value,
            updated: r?.updated,
          },
        });
        modal(
          'Review ticket change',
          plan.key,
          '<div class="ticket-review"><h3>' +
            esc(labels[k]) +
            '</h3>' +
            (plan.before ? '<p>Current · ' + esc(plan.before) + '</p>' : '') +
            '<p><strong>' +
            esc(plan.after) +
            '</strong></p><small>' +
            (site === 'sample'
              ? 'This change applies to the sample project.'
              : 'Your coworkers will see this change in Jira.') +
            '</small></div>' +
            action(
              'team-save',
              site === 'sample' ? 'Save sample change' : 'Save to Jira',
              'primary',
              'check',
              plan.review,
            ),
        );
      } catch (err) {
        form.querySelector('.team-error').textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  return {
    screen: () =>
      header('Team tickets', 'See who owns the work and update a shared ticket.') +
      '<div id="team-content" class="stack" aria-live="polite">Loading shared work…</div>',
    bind: () => {
      void run('sites');
    },
    handle: async (a, v) => {
      if (a === 'team-scope-edit') {
        const [s, p, key] = JSON.parse(v);
        site = s;
        project = p;
        sites = desk().workspace.sites;
        return edit(key);
      }
      if (a === 'team-follow' || a === 'team-check') {
        await read(
          a === 'team-follow' ? 'follow' : 'check',
          a === 'team-follow' ? { enabled: v === 'on' } : {},
        );
        await refresh(false);
        paint();
        return;
      }
      if (a === 'team-reviewed') {
        const [site, project, id] = JSON.parse(v);
        await read('acknowledge', { site, project, id });
        document.querySelector('#dialog').close();
        await refresh();
        notice('Mention marked reviewed on your desk.');
        return;
      }
      if (a === 'team-timeline' || a === 'team-handoff') {
        const [s, p, key, id, comment] = a === 'team-timeline' ? [site, project, v] : JSON.parse(v);
        modal(
          'Ticket timeline',
          key,
          '<p id="timeline-loading" role="status">Reading the ticket history…</p>',
        );
        const pending = document.querySelector('#timeline-loading');
        const h = await read('timeline', { site: s, project: p, key });
        if (!pending.isConnected || !document.querySelector('#dialog').open) return;
        const prs = desk().workspace.pulls.filter((p) => p.linkedIssues.includes(h.url));
        modal(
          h.summary,
          h.key,
          '<p>' +
            esc(h.owner || 'Unassigned') +
            ' · ' +
            esc(h.status) +
            '</p>' +
            (prs.length
              ? '<div class="trace-path"><strong>' +
                esc(h.key) +
                '</strong><span>→</span>' +
                prs.map((p) => link(p.url, p.title)).join('') +
                '</div>'
              : '') +
            (h.description?.text
              ? '<details' +
                (id?.endsWith(':description') ? ' open' : '') +
                '><summary>Current ticket description</summary><p>' +
                esc(h.description.text) +
                '</p></details>'
              : '') +
            (comment && !h.events.some((e) => e.id === 'comment:' + comment)
              ? '<p>The original mention is outside the history returned by Jira.</p>'
              : '') +
            h.notices.map((n) => '<p role="status">' + esc(n) + '</p>').join('') +
            '<ol class="ticket-timeline">' +
            h.events
              .map(
                (event) =>
                  '<li' +
                  (comment && event.id === 'comment:' + comment ? ' class="highlight"' : '') +
                  '><small>' +
                  esc(event.at ? new Date(event.at).toLocaleString() : 'Time unavailable') +
                  '</small><strong>' +
                  esc((event.actor || 'Author unavailable') + ' · ' + event.title) +
                  '</strong>' +
                  (event.body ? '<p>' + esc(event.body) + '</p>' : '') +
                  (event.mentions?.length
                    ? '<small>Mentioned ' +
                      esc(event.mentions.map((m) => m.label).join(', ')) +
                      '</small>'
                    : '') +
                  (event.edited
                    ? '<small>Edited ' + esc(new Date(event.edited).toLocaleString()) + '</small>'
                    : '') +
                  (event.kind === 'comment' && event.url
                    ? '<details class="source-ref"><summary>Source</summary>' +
                      link(event.url, 'Open original comment') +
                      '</details>'
                    : '') +
                  '</li>',
              )
              .join('') +
            '</ol>' +
            (h.url ? link(h.url, 'Open original ticket') : '') +
            (id
              ? action(
                  'team-reviewed',
                  'Mark reviewed on my desk',
                  'primary',
                  'check',
                  JSON.stringify([s, p, id]),
                )
              : ''),
        );
        document.querySelector('.ticket-timeline .highlight')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (a === 'team-person-pick') {
        owner = v;
        document.querySelector('#dialog').close();
        return run('tickets');
      }
      if (a === 'team-edit' || a === 'team-create') return edit(a === 'team-create' ? null : v);
      if (a === 'team-save') {
        await read('commit', { review: v });
        document.querySelector('#dialog').close();
        notice(site === 'sample' ? 'Sample ticket saved.' : 'Jira confirmed your change.');
        if (!box()) {
          await refresh();
          return;
        }
        return run('tickets');
      }
      return run(a === 'team-reload' ? 'sites' : 'tickets', a === 'team-more');
    },
  };
}
