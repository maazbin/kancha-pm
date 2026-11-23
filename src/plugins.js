import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const urls = {
  jira: 'https://mcp.atlassian.com/v2/mcp',
  slack: 'https://mcp.slack.com/mcp',
  github: 'https://api.githubcopilot.com/mcp/readonly',
};
const titles = { jira: 'Jira', slack: 'Slack', github: 'GitHub' };
const states = new Map();
function key(store) {
  const file = path.join(store.base, 'plugin-secrets.key');
  try {
    return readFileSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const bytes = randomBytes(32);
  try {
    writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    return bytes;
  } catch (e) {
    if (e.code === 'EEXIST') return readFileSync(file);
    throw e;
  }
}
function secret(store, id, value) {
  const name = 'plugin.secret.' + id;
  if (value === null) {
    store.set(name, null);
    return;
  }
  if (value === undefined) {
    const encoded = store.config(name, null);
    if (!encoded) return {};
    const [iv, tag, data] = encoded.split('.').map((x) => Buffer.from(x, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key(store), iv);
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString());
  }
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(store), iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  store.set(name, [iv, cipher.getAuthTag(), data].map((x) => x.toString('base64')).join('.'));
}
function known(id) {
  if (!Object.hasOwn(urls, id)) throw Error('Choose a plugin from the catalog.');
}
export async function pluginRead(store, id, name, args = {}) {
  if (!['slack', 'github'].includes(id)) throw Error('Choose GitHub or Slack.');
  return withPlugin(store, id, async (client) => {
    const entries = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      entries.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const allowed = entries.filter((t) =>
      id === 'github'
        ? [
            'get_me',
            'list_pull_requests',
            'pull_request_read',
            'issue_read',
            'get_file_contents',
            'search_repositories',
          ].includes(t.name)
        : /^(?:slack_)?(?:search|read|get|list)_/.test(t.name) &&
          t.annotations?.destructiveHint !== true,
    );
    if (!name)
      return allowed.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    if (!allowed.some((t) => t.name === name))
      throw Error('This operation is outside the plugin’s read permissions.');
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30000 });
    if (result.isError) throw Error('The provider declined the read. Check your permissions.');
    return result.structuredContent ?? result.content;
  });
}
export function pluginStates(store) {
  return Object.fromEntries(
    Object.keys(urls).map((id) => [id, store.config('plugin.status.' + id, { connected: false })]),
  );
}
function status(store, id, data) {
  store.set('plugin.status.' + id, { ...data, checked: new Date().toISOString() });
}
function oauth(store, id, credential, flow, save) {
  const persist = (field, value) => {
    credential[field] = value;
    save(credential);
  };
  return {
    redirectUrl: credential.redirect,
    clientMetadata: {
      client_name: 'Kancha PM',
      redirect_uris: [credential.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: id === 'slack' ? 'client_secret_post' : 'none',
      ...(id === 'slack' ? { scope: 'search:read.public channels:read channels:history' } : {}),
    },
    state: () => flow?.state,
    clientInformation: () =>
      credential.client ||
      (id === 'slack' && process.env.KANCHA_SLACK_CLIENT_ID && process.env.KANCHA_SLACK_CLIENT_SECRET
        ? {
            client_id: process.env.KANCHA_SLACK_CLIENT_ID,
            client_secret: process.env.KANCHA_SLACK_CLIENT_SECRET,
          }
        : undefined),
    saveClientInformation: (v) => persist('client', v),
    tokens: () => credential.tokens,
    saveTokens: (v) => persist('tokens', v),
    saveCodeVerifier: (v) => persist('verifier', v),
    codeVerifier: () => credential.verifier,
    redirectToAuthorization: (u) => {
      if (!flow) throw Error('Sign in again from Plugins.');
      if (u.protocol !== 'https:') throw Error('Invalid sign-in address.');
      flow.url = u.href;
    },
    saveDiscoveryState: (v) => persist('discovery', v),
    discoveryState: () => credential.discovery,
    invalidateCredentials: (scope) => {
      for (const name of scope === 'all' ? ['tokens', 'client', 'verifier', 'discovery'] : [scope])
        delete credential[name];
      save(credential);
    },
  };
}
function transport(store, id, credential, flow, save) {
  const opts = {
    requestInit: { redirect: 'error', headers: id === 'github' ? { 'X-MCP-Readonly': 'true' } : {} },
  };
  if (credential.header) opts.requestInit.headers.Authorization = credential.header;
  else opts.authProvider = oauth(store, id, credential, flow, save);
  return new StreamableHTTPClientTransport(new URL(urls[id]), opts);
}
export function unpack(result) {
  if (result.isError)
    throw Error(
      'The provider declined this request. Check your access or open the ticket in Jira for its required fields.',
    );
  let v = result.structuredContent;
  if (!v || !Object.keys(v).length) {
    const text = result.content?.find((x) => x.type === 'text')?.text;
    try {
      v = JSON.parse(text);
    } catch {
      throw Error('The provider returned an unsupported response.');
    }
  }
  if (v.errors?.length || v.error || v.success === false)
    throw Error('The provider declined the request. Refresh the project or check your permissions.');
  return v.data ?? v;
}
async function connected(store, id, credential, operation, flow, save) {
  const client = new Client({ name: 'kancha-pm', version: '1.0.0' });
  try {
    const tr = transport(store, id, credential, flow, save);
    await client.connect(tr, { timeout: 20000 });
    return await operation(client);
  } catch (e) {
    if (flow?.url) return { authorize: flow.url };
    if (e.code === 401 || e.name === 'UnauthorizedError' || /\b401\b|sign in again/i.test(e.message)) {
      if (!flow && !save.staged) status(store, id, { connected: false, needsSignIn: true });
      throw Error('Sign in again from Plugins to continue.');
    }
    if (/\b403\b|forbidden/i.test(e.message))
      throw Error('Your account or workspace policy does not allow this operation.');
    if (e.name === 'TypeError' && /fetch|network/i.test(e.message))
      throw Error(
        'The worker could not reach ' + titles[id] + '. Check the network connection and try again.',
      );
    if (e.code !== undefined || /OAuth|StreamableHTTP/i.test(e.name))
      throw Error(
        titles[id] +
          ' could not complete the request. Check the provider connection and your account permissions.',
      );
    throw e;
  } finally {
    await client.close().catch(() => {});
  }
}
export async function withPlugin(store, id, operation) {
  known(id);
  if (store.demo || !pluginStates(store)[id].connected)
    throw Error('Connect ' + titles[id] + ' in Plugins first.');
  const version = store.config('plugin.version.' + id, '');
  const save = (v) => {
    if (store.config('plugin.version.' + id, '') === version) secret(store, id, v);
  };
  return connected(store, id, secret(store, id), operation, null, save);
}
export async function callTool(client, name, args = {}) {
  return unpack(await client.callTool({ name, arguments: args }, undefined, { timeout: 30000 }));
}
async function verify(client, id) {
  if (id === 'jira') {
    const data = await callTool(client, 'getAccessibleAtlassianResources');
    const sites = (data.resources || data)
      .filter((r) => (r.products ? r.products.some((x) => x.id === 'jira') : true))
      .map((r) => ({ id: r.cloudId || r.id, url: r.url }))
      .filter((r) => r.id && /^https:\/\/[\w.-]+\/?$/.test(r.url));
    if (!sites.length) throw Error('No Jira sites are visible to this account.');
    return { sites };
  }
  if (id === 'github') {
    const me = await callTool(client, 'get_me');
    return { account: me.login || me.user?.login || 'GitHub account' };
  }
  const list = await client.listTools();
  if (!list.tools.length) throw Error('Your Slack app has no accessible tools.');
  return { account: 'Slack workspace', tools: list.tools.length };
}
function install(store, id, cred, verified) {
  delete cred.verifier;
  store.tx(() => {
    secret(store, id, cred);
    store.set('plugin.version.' + id, randomBytes(12).toString('hex'));
    status(store, id, { connected: true, ...verified });
  });
  return { connected: true };
}
function cleanFlows(store, id) {
  for (const [state, f] of states)
    if (f.expires < Date.now() || (f.store === store && f.id === id)) states.delete(state);
}
export async function pluginAction(store, { id, action, token, email, clientId, clientSecret }, origin) {
  known(id);
  if (store.demo) throw Error('Use your personal desk to connect a real service.');
  if (action === 'disconnect') {
    cleanFlows(store, id);
    store.tx(() => {
      secret(store, id, null);
      store.set('plugin.version.' + id, '');
      status(store, id, { connected: false });
    });
    return { connected: false };
  }
  if (action === 'check') {
    const data = await withPlugin(store, id, (c) => verify(c, id));
    status(store, id, { connected: true, ...data });
    return { connected: true };
  }
  if (action === 'token') {
    if (!['github', 'jira'].includes(id) || !token?.trim() || token.length > 6000)
      throw Error('Enter a valid token.');
    if (id === 'jira' && !/^[^\s:@]+@[^\s:]+$/.test(email || ''))
      throw Error('Enter your Atlassian account email.');
    const cred = {
      header:
        id === 'jira'
          ? 'Basic ' + Buffer.from(email + ':' + token.trim()).toString('base64')
          : 'Bearer ' + token.trim(),
    };
    const stage = () => {};
    stage.staged = true;
    const verified = await connected(store, id, cred, (c) => verify(c, id), null, stage);
    cleanFlows(store, id);
    return install(store, id, cred, verified);
  }
  if (action !== 'signin' || id === 'github') throw Error('Choose an available connection method.');
  const registered =
    id === 'slack' &&
    (clientId && clientSecret
      ? { client_id: clientId, client_secret: clientSecret }
      : secret(store, id).client);
  if (
    id === 'slack' &&
    !registered &&
    !(process.env.KANCHA_SLACK_CLIENT_ID && process.env.KANCHA_SLACK_CLIENT_SECRET)
  )
    throw Error('Use workspace app setup below, or ask your administrator for an approved Slack app.');
  cleanFlows(store, id);
  const state = randomBytes(32).toString('hex'),
    flow = { state, id, store, expires: Date.now() + 600000 };
  flow.credential = { redirect: origin + '/oauth/' + id, ...(registered ? { client: registered } : {}) };
  states.set(state, flow);
  try {
    if (id === 'slack') {
      const provider = oauth(store, id, flow.credential, flow, () => {});
      await auth(provider, { serverUrl: urls[id], scope: provider.clientMetadata.scope });
      if (flow.url) return { authorize: flow.url, state };
    }
    const r = await connected(
      store,
      id,
      flow.credential,
      (c) => verify(c, id),
      flow,
      () => {},
    );
    if (r.authorize) return { authorize: r.authorize, state };
    states.delete(state);
    return install(store, id, flow.credential, r);
  } catch (e) {
    states.delete(state);
    throw e;
  }
}
export async function finishPlugin(store, id, query, cookie, origin) {
  known(id);
  const state = query.get('state'),
    flow = states.get(state);
  if (
    !flow ||
    flow.store !== store ||
    flow.id !== id ||
    flow.expires < Date.now() ||
    flow.credential.redirect !== origin + '/oauth/' + id ||
    !cookie.split(/;\s*/).includes('kancha_oauth=' + state)
  )
    throw Error('Sign-in expired. Return to Plugins and try again.');
  states.delete(state);
  if (query.has('error') || !query.get('code'))
    throw Error('Sign-in was cancelled. Return to Plugins to try again.');
  const tr = transport(store, id, flow.credential, null, () => {});
  try {
    await tr.finishAuth(query.get('code'));
  } finally {
    await tr.close().catch(() => {});
  }
  const stage = () => {};
  stage.staged = true;
  const verified = await connected(store, id, flow.credential, (c) => verify(c, id), null, stage);
  return install(store, id, flow.credential, verified);
}
