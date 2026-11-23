const plugins = [
  {
    id: 'jira',
    name: 'Jira',
    mark: 'J',
    copy: 'See shared tickets, change owners and move work forward.',
    access: 'Read and update tickets',
  },
  {
    id: 'github',
    name: 'GitHub',
    mark: 'GH',
    copy: 'Read pull requests and repository activity for your projects.',
    access: 'Read-only code access',
  },
  {
    id: 'slack',
    name: 'Slack',
    mark: '#',
    copy: 'Find conversations and decisions your workspace lets you read.',
    access: 'Read conversations',
  },
];
export function pluginScreen({ board, header, panel, esc, action, date }) {
  const cards = plugins
    .map((p) => {
      const direct = board.plugins?.[p.id] || {},
        checks = Object.values(board.hostChecks || {}).filter((c) => c.provider === p.id);
      const good = checks.filter((c) => c.status === 'connected');
      const available = direct.connected
        ? 'Connected to this desk'
        : direct.needsSignIn
          ? 'Sign in again'
          : good.length
            ? 'Available through ' +
              good.map((c) => (c.method === 'CLI' ? 'GitHub CLI' : c.host)).join(', ')
            : 'Available to connect';
      return (
        '<section class="panel plugin-card"><div class="plugin-heading"><span class="plugin-mark ' +
        p.id +
        '">' +
        p.mark +
        '</span><div><h2>' +
        p.name +
        '</h2><small>' +
        esc(available) +
        '</small></div></div><p>' +
        p.copy +
        '</p><small>' +
        p.access +
        '</small>' +
        (direct.connected
          ? '<p class="plugin-account">' +
            esc(direct.account || direct.sites?.map((s) => new URL(s.url).hostname).join(', ') || '') +
            '</p>'
          : '') +
        '<div class="actions">' +
        (board.demo
          ? action('team', 'Explore sample tickets', 'subtle')
          : direct.connected
            ? (p.id === 'jira' ? action('team', 'View team tickets', 'primary') : '') +
              action('plugin-manage', 'Manage', 'subtle', 'settings-2', p.id)
            : action(
                'plugin-manage',
                direct.needsSignIn ? 'Reconnect ' + p.name : 'Connect ' + p.name,
                'primary',
                'plug',
                p.id,
              )) +
        '</div>' +
        (checks.length
          ? '<details><summary>Agent access</summary>' +
            checks
              .map(
                (c) =>
                  '<p>' +
                  esc(c.host) +
                  ' · ' +
                  esc(c.method || 'MCP') +
                  ' · ' +
                  esc(c.status) +
                  '<br><small>' +
                  esc([c.identity, ...(c.scopes || [])].filter(Boolean).join(', ')) +
                  ' · ' +
                  esc(date(c.checked)) +
                  '</small></p>',
              )
              .join('') +
            '</details>'
          : '') +
        '</section>'
      );
    })
    .join('');
  return (
    header('Plugins', 'Choose the services you use at work.') +
    '<div class="plugin-grid">' +
    cards +
    '</div>' +
    '<details class="panel advanced-plugins"><summary>Developer settings</summary><p>Manage the coding-agent connection, export JSON, or check access in an existing session.</p><div class="actions">' +
    action('mcp-setup', 'Set up MCP') +
    action('connection-prompt', 'Get agent prompt') +
    '</div></details>'
  );
}
export function pluginDialog({ id, board, modal, esc, action, api, refresh, notice }) {
  const p = plugins.find((p) => p.id === id),
    direct = board.plugins[id];
  const linked = direct.connected;
  const oauth = id === 'jira' || id === 'slack';
  const text = linked
    ? 'Manage access for this desk.'
    : id === 'jira'
      ? 'Sign in with Atlassian. You choose the account and approve access on their website.'
      : id === 'slack'
        ? 'Sign in through the Slack app approved by your workspace. Your administrator can enable it for this desk.'
        : 'Check the GitHub login already on this machine, or connect a read-only token.';
  modal(
    p.name + ' plugin',
    p.access,
    '<p>' +
      text +
      '</p>' +
      (!linked && oauth
        ? action(
            'plugin-signin',
            'Sign in with ' + (id === 'jira' ? 'Atlassian' : 'Slack'),
            'primary',
            'arrow-up-right',
            id,
          )
        : '') +
      (linked
        ? '<div class="actions">' +
          action('plugin-check', 'Check access', 'subtle', 'refresh-cw', id) +
          action('plugin-remove', 'Disconnect from this desk', 'subtle', 'unplug', id) +
          '</div>'
        : '') +
      (id === 'github' && !linked
        ? action('check-gh-cli', 'Check GitHub login', 'primary', 'github')
        : '') +
      (!linked && id !== 'slack'
        ? '<details class="plugin-token"><summary>Use ' +
          (id === 'jira' ? 'an API token' : 'a personal access token') +
          '</summary><form class="inlineform" id="plugin-token">' +
          (id === 'jira'
            ? '<label class="formrow">Atlassian email<input type="email" name="email" required></label>'
            : '') +
          '<label class="formrow">Token<input name="token" type="password" required autocomplete="off" maxlength="6000"></label><button type="submit" class="btn">Verify and connect</button><p role="alert"></p></form></details>'
        : '') +
      (id === 'slack' && !linked
        ? '<details class="plugin-token"><summary>Workspace app setup</summary><p>Use the client credentials of an approved internal or Marketplace Slack app. Register this redirect address in that app: <code>' +
          esc(location.origin + '/oauth/slack') +
          '</code>.</p><form class="inlineform" id="slack-app"><label class="formrow">Client ID<input name="clientId" required></label><label class="formrow">Client secret<input name="clientSecret" type="password" autocomplete="off" required></label><button class="btn" type="submit">Continue to Slack</button><p role="alert"></p></form><a href="https://docs.slack.dev/ai/slack-mcp-server/" target="_blank" rel="noreferrer">Slack workspace setup</a></details>'
        : ''),
  );
  const slack = document.querySelector('#slack-app');
  if (slack)
    slack.onsubmit = async (e) => {
      e.preventDefault();
      const b = slack.querySelector('button');
      b.disabled = true;
      try {
        const creds = Object.fromEntries(new FormData(slack));
        slack.elements.clientSecret.value = '';
        const r = await api('plugins', { id, action: 'signin', ...creds });
        if (r.authorize) location.assign(r.authorize);
        else {
          document.querySelector('#dialog').close();
          await refresh();
        }
      } catch (err) {
        slack.querySelector('[role=alert]').textContent = err.message;
      } finally {
        b.disabled = false;
      }
    };
  const form = document.querySelector('#plugin-token');
  if (form)
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      const value = Object.fromEntries(new FormData(form));
      form.elements.token.value = '';
      try {
        await api('plugins', { id, action: 'token', ...value });
        document.querySelector('#dialog').close();
        await refresh();
        notice(p.name + ' connected.');
      } catch (err) {
        form.querySelector('[role=alert]').textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
}
