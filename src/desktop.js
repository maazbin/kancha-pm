import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { markers, quiet } from './engine.js';
import { handoffDesk } from './handoffs.js';
import { advisorState } from './advisor.js';
const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/notify.ps1', import.meta.url));
export async function deliver(store) {
  const b = store.board();
  if (quiet(b.settings)) return;
  const mentions = handoffDesk(store).flatMap((scope) =>
    scope.unread.map((a) => ({
      key: JSON.stringify(['mention', store.config('plugin.version.jira', ''), scope.site, a.id]),
      label: 'Jira mention',
      title: 'You were mentioned on ' + a.key + '. Open Team tickets to review.',
    })),
  );
  const advisor = advisorState(store);
  const recommendation =
    advisor.brief && !advisor.accepted
      ? [{ key: 'pm:' + advisor.brief.revision, label: 'Your next move', title: advisor.brief.next }]
      : [];
  for (const m of [...recommendation, ...markers(b), ...mentions]) {
    const key = 'notice:' + m.key,
      lease = store.acquire(key, 60000);
    if (!lease) continue;
    try {
      if (store.config(key, false)) continue;
      const title = 'Kancha · ' + m.label;
      if (process.platform === 'win32') {
        const args = ['-NoProfile', '-NonInteractive', '-File', script],
          options = {
            windowsHide: true,
            timeout: 13000,
            env: { ...process.env, KANCHA_NOTICE_TITLE: title, KANCHA_NOTICE_BODY: m.title },
          };
        try {
          await run('pwsh.exe', args, options);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          await run('powershell.exe', args, options);
        }
      } else if (process.platform === 'darwin')
        await run(
          'osascript',
          [
            '-e',
            'on run argv',
            '-e',
            'display notification (item 2 of argv) with title (item 1 of argv)',
            '-e',
            'end run',
            title,
            m.title,
          ],
          { timeout: 10000 },
        );
      else await run('notify-send', ['--', title, m.title], { timeout: 10000 });
      store.set(key, true);
    } finally {
      store.release(key, lease);
    }
  }
}
