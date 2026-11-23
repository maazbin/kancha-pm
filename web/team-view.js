const labels = {
  summary: 'Title',
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  duedate: 'Due date',
  comment: 'Comment',
  create: 'New ticket',
};
export function teamView({ api, esc, action, header, panel, modal, notice, link }) {
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
    rows = [];
    next = null;
    loaded = false;
    owner = '*';
  }
  function paint() {
    const root = box();
    if (!root) return;
    const people = new Map(rows.map((r) => [r.account || '', r.owner || 'Unassigned']));
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
            [{ id: '*', name: 'Everyone' }, ...[...people].map(([id, name]) => ({ id, name }))],
            owner,
          )
        : '') +
      '</div>' +
      (!project
        ? '<p>Select a project to see its shared tickets.</p>'
        : !loaded
          ? '<p role="status">Loading tickets…</p>'
          : panel(
              'Project at a glance',
              '<p class="team-insight"><strong>' +
                active.length +
                ' open ' +
                (active.length === 1 ? 'ticket' : 'tickets') +
                '</strong> ' +
                (owner === '*' ? 'across this view' : 'for ' + esc(people.get(owner) || 'this person')) +
                '. ' +
                (late.length ? late.length + ' past due. ' : '') +
                (unassigned.length ? unassigned.length + ' need an owner.' : '') +
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
        owner = e.target.value;
        paint();
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
        if (!project && site === 'sample') project = projects[0]?.key || '';
        if (!project) {
          paint();
          return;
        }
      }
      const data = await read('tickets', more ? { next } : {});
      if (!current()) return;
      rows = [...new Map([...(more ? rows : []), ...data.items].map((r) => [r.key, r])).values()];
      next = data.next;
      loaded = true;
      if (owner !== '*' && !rows.some((r) => (r.account || '') === owner)) owner = '*';
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
      if (a === 'team-edit' || a === 'team-create') return edit(a === 'team-create' ? null : v);
      if (a === 'team-save') {
        await read('commit', { review: v });
        document.querySelector('#dialog').close();
        notice(site === 'sample' ? 'Sample ticket saved.' : 'Jira confirmed your change.');
        return run('tickets');
      }
      return run(a === 'team-reload' ? 'sites' : 'tickets', a === 'team-more');
    },
  };
}
