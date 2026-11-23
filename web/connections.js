const endpoints = {
  jira: ['atlassian', 'https://mcp.atlassian.com/v2/mcp'],
  slack: ['slack', 'https://mcp.slack.com/mcp'],
};
const probePrompt =
  'Use Kancha to check my existing connections. Make read-only calls through the Jira and Slack tools available in this coding session. For GitHub, use the available connector or the signed-in GitHub CLI. Show the account, Jira sites, Slack workspaces, and GitHub organizations with visible repositories that each check verifies. Record each result in Kancha so it appears in Connections. Ask about setup only for a service I want that you cannot access.';

export function setupDialog({ config, modal, esc, action, notice }) {
  const entry = config.mcpServers['kancha-pm'];
  const root = entry.args[0].replace(/[\\/]src[\\/]cli\.js$/, '');
  const install =
    'Set up the Kancha PM MCP and its skill for this coding agent from the clone at ' +
    root +
    '. Use the existing registration if it points to this clone. Verify it by calling project_scope. ' +
    probePrompt;
  modal(
    'Set up MCP',
    'Connections',
    '<div class="setup-stack"><h3>Ask your coding agent</h3><p>Paste this in the engine that will use your personal desk. Run the agent and Kancha in the same environment.</p><textarea id="install-prompt" aria-label="Installation prompt" rows="3" readonly>' +
      esc(install) +
      '</textarea>' +
      action('copy-install', 'Copy setup request', 'subtle') +
      '<small>From the clone, Codex can run <code>npm run setup -- codex</code> and Claude Code can run <code>npm run setup -- claude</code>. Reload the coding session after registration.</small>' +
      '<h3>Configure with JSON</h3><p>For Claude Code or a client that accepts <code>mcpServers</code>. Select optional OAuth servers only if your agent needs them. Complete sign-in in that client.</p>' +
      '<fieldset id="mcp-options"><legend>Include in configuration</legend><label><input type="checkbox" checked disabled> Kancha PM</label><label><input type="checkbox" value="jira"> Jira (Atlassian)</label><label><input type="checkbox" value="slack"> Slack</label></fieldset>' +
      '<textarea id="mcp-json" aria-label="MCP JSON" rows="7" spellcheck="false" readonly></textarea><div class="actions">' +
      action('copy-config', 'Copy JSON') +
      action('export-config', 'Download JSON') +
      '</div>' +
      '<label class="formrow">Merge into a copy of an existing MCP JSON file<input type="file" id="merge-config" accept=".json,application/json"></label><small>Files are processed in your browser. Existing server entries take precedence. Review the downloaded copy before installing.</small></div>',
  );
  const output = document.querySelector('#mcp-json');
  function update() {
    const servers = { ...config.mcpServers };
    for (const option of document.querySelectorAll('#mcp-options input:checked:not(:disabled)')) {
      const [name, url] = endpoints[option.value];
      servers[name] = { type: 'http', url };
    }
    output.value = JSON.stringify({ mcpServers: servers }, null, 2);
  }
  update();
  document.querySelector('#mcp-options').onchange = update;
  document.querySelector('#merge-config').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw Error('Choose a JSON configuration smaller than 1 MB.');
      const previous = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      if (
        !previous ||
        typeof previous !== 'object' ||
        Array.isArray(previous) ||
        !previous.mcpServers ||
        typeof previous.mcpServers !== 'object' ||
        Array.isArray(previous.mcpServers)
      )
        throw Error('Choose a JSON object with an mcpServers section.');
      const selected = JSON.parse(output.value).mcpServers;
      download({ ...previous, mcpServers: { ...selected, ...previous.mcpServers } });
      notice('Downloaded the merged configuration.');
    } catch (err) {
      notice(err instanceof SyntaxError ? 'This file contains invalid JSON.' : err.message);
    } finally {
      e.target.value = '';
    }
  };
}

export function download(config) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(config, null, 2) + '\n'], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'kancha.mcp.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { probePrompt };
