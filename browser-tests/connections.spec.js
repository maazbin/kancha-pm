import { test, expect } from './fixture.js';
import { readFile } from 'node:fs/promises';
test('MCP setup exports this worker and merges selected services in the browser', async ({ page }) => {
  await page.goto('/#connections');
  await expect(page.getByRole('heading', { name: 'Slack' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up MCP' }).click();
  const json = page.getByLabel('MCP JSON', { exact: true });
  const entry = JSON.parse(await json.inputValue()).mcpServers['kancha-pm'];
  expect(entry.args.at(-1)).toBe('mcp');
  expect(entry.env.KANCHA_HOME).toBeTruthy();
  await page.getByLabel('Jira (Atlassian)').check();
  await page.getByLabel('Slack', { exact: true }).check();
  const selected = JSON.parse(await json.inputValue()).mcpServers;
  expect(selected.atlassian.type).toBe('http');
  expect(selected.slack.url).toBe('https://mcp.slack.com/mcp');
  const download = page.waitForEvent('download');
  await page.locator('#merge-config').setInputFiles({
    name: 'existing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ setting: 7, mcpServers: { slack: { url: 'https://existing.example/mcp' } } }),
    ),
  });
  const merged = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(merged.setting).toBe(7);
  expect(merged.mcpServers.slack.url).toBe('https://existing.example/mcp');
  expect(merged.mcpServers['kancha-pm']).toEqual(entry);
});
