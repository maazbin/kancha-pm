export function workspaceSnapshot(store) {
  if (!store.config) return { sites: [], repos: [], pulls: [] };
  const jira = store.config('plugin.status.jira', {}),
    github = store.config('plugin.status.github', {});
  const snapshot = store.config('workspace.jira', {}),
    code = store.config('workspace.github', {}),
    host = store.config('workspace.githubHost', {});
  const live = jira.connected && snapshot.version === store.config('plugin.version.jira', '');
  const verified = github.connected
    ? code.route === 'plugin' && code.version === store.config('plugin.version.github', '')
    : code.route === 'cli';
  const probe = Object.values(store.config('hostChecks', {})).find(
    (x) => x.host === host.host && x.provider === 'github' && x.status === 'connected',
  );
  const g = verified && !code.error ? code : probe ? host : {};
  const links = new Map();
  if (g.pulls?.length)
    for (const { pr, issue } of store.db.prepare('SELECT pr,issue FROM associations').all()) {
      if (!links.has(pr)) links.set(pr, []);
      links.get(pr).push(issue);
    }
  return {
    sites: live ? (snapshot.sites || []).filter((s) => jira.sites?.some((k) => k.id === s.id)) : [],
    jiraConnected: !!jira.connected,
    checked: live ? snapshot.checked : null,
    jiraError: live ? snapshot.error : '',
    repos: g.repos || [],
    pulls: (g.pulls || []).map((p) => ({
      ...p,
      linkedIssues: [...new Set([...p.linkedIssues, ...(links.get(p.url) || [])])],
    })),
    githubVia: g.route || '',
    githubChecked: g.checked || null,
    githubPartial: !!g.partial,
  };
}
