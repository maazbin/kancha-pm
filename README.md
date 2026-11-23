# Kancha PM

**For shared project work**, open **Plugins**, choose **Connect Jira**, and sign in with Atlassian. Open **Team tickets**, choose your site and project, then filter by person. The view shows your colleagues’ Jira tickets under your own access permissions. Review and save a title, due date, priority, owner, workflow transition or comment, or create a ticket. The full Jira link is available for custom workflow screens. The sample project lets you try the flow locally.

**Plugins** also supports GitHub through your existing agent or CLI and a directly verified read-only MCP token. Slack uses an approved internal or Marketplace app; the administrator can enter its client ID and secret under **Workspace app setup** or supply `KANCHA_SLACK_CLIENT_ID` and `KANCHA_SLACK_CLIENT_SECRET` on the worker. Register the callback shown on the card. Sign-in and consent occur on the provider’s site. The worker uses MCP OAuth discovery, PKCE and SDK refresh. Disconnect clears the local credentials; revoke the provider grant in the provider account to revoke it everywhere. Plugin credentials are encrypted in the private desk database with a key file beside it. Protect that directory and its backups under your OS account. Developers can still export or merge MCP JSON under **Plugins → Developer settings**.

A personal project manager inside the coding agent you already use. Kancha prepares your next action, remembers where you stopped, and brings a blocker back when someone replies. Your desk runs on your computer. Teammates can answer in Jira or GitHub without installing Kancha.

![Kancha's personal focus desk, showing a checkout decision and two follow-ups](docs/focus-desk.jpg)

## Open your desk

Install **Node.js 24 or newer**. Clone this repo and run the following commands.

```sh
git clone https://github.com/maazbin/kancha-pm.git
cd kancha-pm
npm ci --ignore-scripts
npm start -- --open
```

On Windows, double-click **Start Kancha.cmd** in the checkout. The launcher installs missing dependencies, opens the browser, and enables local notifications while the process is running. Reopening the launcher reuses an existing desk.

The personal dashboard is at **http://127.0.0.1:4317**. Choose **Explore the sample desk** to try a fictional workspace with its own database. You can also run `npm run demo -- --open` on port 4318. An empty live workspace is expected until you capture your own work or connect a source.

## Give your coding agent the PM

**One developer, one private desk, many projects.** Clone this repository in your own environment and tell your coding agent: “Install Kancha for this engine, start its worker, check my existing GitHub and Jira MCP connections, and let me choose my boards and repositories.” The repository includes entry instructions for Claude Code and AGENTS.md-aware agents. Each developer keeps their own database and permissions. Point two coding engines at the same private data directory if you want to share your own desk between them.

Run the command for your preferred host from the permanent install location.

```sh
npm run setup -- codex
# or
npm run setup -- claude
```

Setup registers a local stdio MCP server through the host's own CLI and installs the **kancha-personal-pm** skill in the user's skills directory. Restart the host and ask **“Start my day with Kancha. Show me my next action and what could unblock someone.”** The agent and dashboard can run separately and share the same database.

For another MCP client, run `npm run setup -- config` and use the printed absolute command and arguments. Import `skills/personal-pm/SKILL.md` into the client's skill mechanism if supported. If you move the checkout, register the new path. A host that uses a hosted model processes the context your agent sends it.

## Connect real work

### Use your existing MCP connections first

Your agent checks its GitHub and Atlassian tools by making a read-only request. **Workspace → Last host checks** shows which host checked each connection and when. Missing access prompts are specific to the affected source. Your credentials stay with the host. The optional native readers below enable unattended source checks. Host-only data refreshes when the coding agent runs the skill.

In **Projects**, follow each Jira board by its URL, add GitHub repositories independently, and register any local checkouts. Board identity includes the Jira site and numeric board ID. A single board can include issues from several Jira projects. A colleague's dashboard can lead you to a board, but access to that dashboard alone does not establish issue membership.

The agent imports observed board results, then joins source records by **PR URL → full Jira issue URL → observed board memberships**. Several boards can contain an issue, and one PR can reference multiple issues. A bare issue key on a branch or PR title produces a candidate that you can confirm in the work brief. A repository association is only a search hint. Local checkout registration reads the Git origin. If two worktrees match, the handoff offers both. **Signals** graphs personal work by state and open work by board, and lists actionable alerts. Board totals may overlap.

### Local or cloud worker

Run `npm run worker` in the developer's environment and `npm run status` to check it. On the same computer open **http://127.0.0.1:4317/** or **http://localhost:4317/**. A GitHub repository URL displays the source. A different machine’s loopback URL reaches that other machine.

For a private VM with SSH, run the worker there and run `ssh -N -L 4317:127.0.0.1:4317 user@your-vm` on your laptop. Open the laptop's local address. Use an available port on both ends if 4317 is occupied. This setup needs a long-running Node process, persistent SQLite storage and a private tunnel. A hosted chat without a process runtime and port forwarding cannot serve this UI. If the remote worker sleeps, source checks resume when it wakes. Native OS pop-ups appear on the worker machine; your browser can show the dashboard markers through the tunnel.

Open **Workspace**, enter your working hours, and select only the repositories or projects you want the PM to follow. Save, then choose **Check sources now**.

| Source | Setup and behavior |
|---|---|
| GitHub | Install and sign in to the GitHub CLI with `gh auth login`. Check `gh api user --jq .login`. Enter comma-separated `owner/repo` pairs. Kancha reads assigned open issues and direct personal review requests. It checks ordinary issue and PR conversation comments on active watches. Team review requests and inline review threads can be imported through your agent. |
| Jira Cloud | Set `KANCHA_JIRA_EMAIL` and `KANCHA_JIRA_TOKEN` in the environment of the Kancha process. Use the Jira Cloud site URL and project keys. The native reader uses a site-compatible API token and queries issues assigned to the current account. Names or account IDs can identify a watched issue commenter. Scoped cloud-ID gateway tokens can use your host's connector instead. |
| Existing agent integrations | The skill can import assigned work and permitted passages from your existing Jira, GitHub, document, email, messaging, support, and monitoring connectors. It reuses a stable external key when updating an item. Host-only sources refresh when an authorized coding session reads them. |
| Local checkout | Set an absolute checkout directory. A work brief reads the current branch and commit. Save a private checkpoint with the file or fixture to resume. |
| Documents and reported alerts | Choose **Attach** inside a work brief to save an excerpt and optional link. Use an approved source for each excerpt. Review the source before treating a reported symptom as a confirmed cause. |

Kancha uses your existing GitHub CLI credential storage. Supply Jira secrets through your process environment or your usual secret manager. Credentials are excluded from the dashboard configuration and database. Background polling needs its own available source credentials. Signing in to a coding host alone does not authenticate an independent process.

## One complete handoff

1. Open a work brief and choose **Ask / watch**. Enter the exact question, expected responder, and next check time.
2. **Start local watch** saves the follow-up privately. **Review & post question** shows the destination and text. Confirm to post once to the original Jira thread. You can also watch an existing conversation without posting.
3. While you wait, the desk suggests other available work. Save your checkpoint before switching. Kancha checks native sources on its configured interval while the service and machine are running.
4. A new comment from the expected responder raises **Reply received**. Choose **Use this answer** or **Keep watching**. Replies are candidates until confirmed.
5. **Resume work** returns the item to focus and clears the handoff reminder. **Copy handoff** assembles the decision, source references, and private checkpoint for your coding agent. **Complete** records personal completion. Shared Jira and GitHub state stays under the team's existing workflow.

The sample desk supports this complete loop with **Simulate owner reply**. Live sources require real responses. New tickets can be delegated to your existing ticket agent or created through an explicitly authorized host connector.

## Background and local data

### Connect your coding agent

Open **Plugins → Developer settings → Set up MCP** on the personal dashboard. Copy the setup request into your coding agent, or download the JSON for a client with an `mcpServers` configuration. The generated Kancha entry uses the paths and data directory on the worker. Claude Code supports project-level `.mcp.json`. For Codex, run `npm run setup -- codex` from the installed clone. The file merge runs in your browser and retains existing server entries in the downloaded copy.

Use **Get agent prompt** to test a Jira or Slack connection already available in your host. Select an optional server in the JSON dialog only when setting it up for the first time in a compatible OAuth client. The provider handles sign-in. GitHub can use either the coding agent's connector or **Check GitHub login** with an existing login. Plugins lists organizations with visible repositories and labels partial results. Access discovery does not subscribe the developer to projects. [Atlassian MCP setup](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/) · [Slack MCP setup and client requirements](https://docs.slack.dev/ai/mcp-server/)

### Worker and storage

**Priority** explains the order of the personal agenda and filters it by board. **Alarms** collects overdue actions, deadlines in the next 24 hours, owner replies, and upcoming reminders. Snooze or resolve an item from its brief. **Analytics** shows seven days of recorded intake and completions and the oldest unresolved waits. Quiet hours govern notification delivery.

**PM chat** runs in the browser. Choose **Open coding session** and ask your agent to answer your pending Kancha browser chat through MCP, or select **Claude Code CLI** or **Codex CLI** to start a local, noninteractive response using that CLI’s existing login. CLI mode needs a compatible installed executable on the worker, provider access and available usage. Sending a question shares up to 25 open actions and the last four answered exchanges with that engine. Questions and replies are saved in the private desk database. The chat offers advice. Use the work brief to change an action.

- `npm start -- --notify` enables native reminders. Dashboard markers also work in the browser. Quiet hours use your device's timezone. Snoozes and delivered reminders persist across sessions.
- **Windows sign-in startup** is optional. Run `./scripts/start-at-login.ps1` in PowerShell to install a user Startup shortcut. Run it with `-Remove` to remove the shortcut. No administrator access is required. On other systems run the dashboard under your own user service. Linux native delivery requires `notify-send`. macOS uses `osascript`.
- Native reminders depend on OS notification permissions and availability. When the laptop sleeps, the next successful check reconciles the latest work before delivering pending reminders. A host-only watch can raise a time reminder while source verification still needs an agent session.
- The default private data directory is `%LOCALAPPDATA%/KanchaPM` on Windows, or `$XDG_DATA_HOME/kancha-pm` (default `~/.local/share/kancha-pm`) elsewhere. `KANCHA_HOME` overrides it. Keep this value consistent between the dashboard and agent. `KANCHA_PORT` overrides the HTTP port.
- SQLite stores local work, follow-ups, evidence, checkpoints and notification receipts. Back up the data folder with all Kancha processes stopped. The server listens only on IPv4 loopback. Keep it on your personal machine. Use your OS account and disk protection for stored notes.
- For hosts that virtualize the user's application-data folder, create a private `kancha.local.json` alongside `package.json` with an absolute `dataDirectory` string. The dashboard and MCP server read the same setting across sessions. An explicit `KANCHA_HOME` takes precedence. The local settings file is ignored by Git.
- Native access failures are visible in Workspace. Removed native scope and definitive access denials hide affected work and drop source excerpts. Host-imported excerpts require revalidation by the host skill. Private items are not a team-wide permissions or assignment system.

## Develop and verify

```sh
npm ci --ignore-scripts
npm test
npx playwright install chromium
npm run test:browser
```

To test with an existing Chromium browser, set `KANCHA_CHROMIUM` to its executable. Browser tests run against isolated, disposable SQLite databases. GitHub Actions runs workflow tests on Windows and Linux and the browser suite on Linux.

| Path | Purpose |
|---|---|
| `src/store.js` | SQLite storage, personal scope, guarded state transitions, focus ordering and process leases |
| `src/sources.js` | Native GitHub/Jira readers, pagination, source refreshes, reply matching and confirmed question delivery |
| `src/engine.js` | Validated operations shared by the agent and dashboard, reminders and source evidence |
| `src/mcp.js` | MCP SDK stdio server |
| `src/server.js`, `web/` | Local API and responsive dashboard |
| `src/desktop.js`, `scripts/` | Optional notification and sign-in helpers |
| `skills/personal-pm/` | Portable PM behavior for coding agents |

The native adapters use the [GitHub CLI API](https://cli.github.com/manual/gh_api), [GitHub issue comments](https://docs.github.com/en/rest/issues/comments), and [Jira Cloud issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/). Agent clients connect using [MCP stdio](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
