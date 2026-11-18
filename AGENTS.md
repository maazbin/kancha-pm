# Run Kancha for this developer

When asked to install this repository as a personal PM, use Node 24+ and run `npm ci --ignore-scripts` in the permanent checkout. Choose the current engine: `npm run setup -- claude`, `npm run setup -- codex`, or `npm run setup -- config` for another stdio MCP client. Register once and reload the host if required. Read `skills/personal-pm/SKILL.md` and use its discovery and project-mapping workflow.

Run `npm run worker` as a long-running process in this developer's personal environment. Check `npm run status` in another terminal. Open the reported address in a browser on that machine, or forward port 4317 privately from a remote worker. Shared machines need a separate OS account or private container and persistent data directory per developer. Give the developer the verified address, available connections, and any missing scope. Keep each developer’s notes and credentials in their own environment.
