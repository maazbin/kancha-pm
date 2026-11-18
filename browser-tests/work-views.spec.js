import { test, expect } from './fixture.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
test('priority, alarms, analytics and an agent reply work from the personal dashboard', async ({
  page,
}) => {
  await page.goto('/sample/#priority');
  await expect(page.getByRole('heading', { name: 'Recommended order' })).toBeVisible();
  await page.getByLabel('Board', { exact: true }).selectOption({ label: 'Billing release' });
  await expect(page.locator('.rank-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Set priority' }).click();
  await page.getByRole('dialog').getByRole('combobox').selectOption('urgent');
  await page.getByRole('button', { name: 'Save priority' }).click();
  await expect(page.locator('.rank-row')).toContainText('Personal priority: urgent');
  await page.getByRole('button', { name: 'Alarms', exact: true }).click();
  await expect(page.getByText('Reply to review', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('meter')).toHaveCount(14);
  await page.getByRole('button', { name: 'PM chat', exact: true }).click();
  await page.getByLabel('Your question').fill('Which review comes first?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText(/Waiting for your coding session/)).toBeVisible();
  const headers = { 'X-Kancha': '1' };
  const cfg = await (await page.request.get('/sample/api/mcp-config', { headers })).json();
  const client = new Client({ name: 'browser-integration', version: '1' });
  await client.connect(new StdioClientTransport({ ...cfg.mcpServers['kancha-pm'], stderr: 'pipe' }));
  try {
    const read = await client.callTool({ name: 'read_browser_chat', arguments: {} });
    const pending = JSON.parse(read.content[0].text);
    expect(pending.context.question).toBe('Which review comes first?');
    const result = await client.callTool({
      name: 'reply_browser_chat',
      arguments: { id: pending.id, answer: 'Review the receipt copy change.' },
    });
    expect(result.isError).toBeFalsy();
  } finally {
    await client.close();
  }
  await expect(
    page.locator('.chat-turn').getByText('Review the receipt copy change.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Review the receipt copy change.', { exact: true })).toBeVisible();
});
