import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { markers, quiet } from './engine.js';
const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/notify.ps1', import.meta.url));
export async function deliver(store) {
  const b = store.board();
  if (quiet(b.settings)) return;
  for (const m of markers(b)) {
    const key = 'notice:' + m.key,
      lease = store.acquire(key, 60000);
    if (!lease) continue;
    try {
      if (store.config(key, false)) continue;
      const title = 'Kancha · ' + m.label;
      if (process.platform === 'win32')
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], {
          windowsHide: true,
          timeout: 13000,
          env: { ...process.env, KANCHA_NOTICE_TITLE: title, KANCHA_NOTICE_BODY: m.title },
        });
      else if (process.platform === 'darwin')
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
