import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { gh } from './sources.js';

export function mcpConfig(directory, demo = false) {
  const entry = {
    command: process.execPath,
    args: [fileURLToPath(new URL('./cli.js', import.meta.url)), 'mcp'],
  };
  if (demo) entry.args.push('--demo');
  if (directory) entry.env = { KANCHA_HOME: directory };
  return { mcpServers: { 'kancha-pm': entry } };
}

export const hostProbeFields = {
  host: z.string().trim().min(1).max(120),
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  status: z.enum(['connected', 'missing', 'denied', 'unavailable']),
  identity: z.string().trim().max(200).optional(),
  scopes: z.array(z.string().trim().min(1).max(240)).max(1000).optional(),
  partial: z.boolean().optional(),
};

export function saveCheck(store, fields, method = 'MCP') {
  return store.tx(() => {
    const checks = store.config('hostChecks', {});
    const key = fields.host + ':' + fields.provider + (method === 'CLI' ? ':cli' : '');
    const result = { ...fields, method, checked: new Date().toISOString() };
    store.set('hostChecks', { ...checks, [key]: result });
    return result;
  });
}

export async function checkGithubCli(store, read = gh) {
  if (store.demo) throw Error('Open your personal desk to check its GitHub CLI.');
  const check = { host: 'Worker', provider: 'github' };
  try {
    const user = await read('user');
    if (!user?.login) throw Error('Missing GitHub identity');
    check.identity = user.login;
  } catch (err) {
    const status =
      err.code === 'ENOENT' ? 'missing' : [401, 403].includes(err.status) ? 'denied' : 'unavailable';
    return saveCheck(store, { ...check, status }, 'CLI');
  }
  const orgs = new Set();
  let partial = true;
  for (let page = 1; page <= 10; page++) {
    try {
      const repos = await read(
        'user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&page=' +
          page,
      );
      for (const repo of repos) {
        if (repo.owner?.type === 'Organization') orgs.add(repo.owner.login);
      }
      if (repos.length < 100) {
        partial = false;
        break;
      }
    } catch {
      break;
    }
  }
  return saveCheck(store, { ...check, status: 'connected', scopes: [...orgs].sort(), partial }, 'CLI');
}
