import { test, expect } from './fixture.js';
test('a teammate finds another owner and reviews a ticket change without affecting the personal queue', async ({
  page,
}) => {
  await page.goto('/sample/#team');
  await expect(page.getByRole('heading', { name: 'Project at a glance' })).toBeVisible();
  await page.getByLabel('Person', { exact: true }).selectOption('nadia');
  await expect(page.locator('.team-ticket')).toHaveCount(1);
  await page.getByRole('button', { name: 'View ticket' }).click();
  await page.getByLabel('Change', { exact: true }).selectOption('status');
  await page.getByLabel('Status', { exact: true }).selectOption('Done');
  await page.getByRole('button', { name: 'Review change' }).click();
  await expect(page.getByRole('dialog')).toContainText('Current · In progress');
  await page.getByRole('button', { name: 'Save sample change' }).click();
  await expect(page.locator('.team-ticket')).toContainText('Done');
  await expect(page.locator('.team-insight')).toContainText('0 open tickets');
  await page.reload();
  await expect(page.locator('.team-ticket').filter({ hasText: 'APP-17' })).toContainText('Done');
});
test('plugin setup starts with providers; JSON and credentials are progressively disclosed', async ({
  page,
}) => {
  await page.goto('/#connections');
  await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up MCP' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect Jira' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Atlassian' })).toBeVisible();
  await expect(page.getByLabel('Token', { exact: true })).not.toBeVisible();
  await page.getByText('Use an API token', { exact: true }).click();
  await expect(page.getByLabel('Token', { exact: true })).toHaveAttribute('type', 'password');
});
