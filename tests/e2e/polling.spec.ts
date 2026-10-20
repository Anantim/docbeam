import { expect, test, type Request } from '@playwright/test';
import { SAM, signIn } from './helpers.js';

// F1 part 2: the job list is reloaded every 30 seconds only while a listed job is running. When everything
// has finished, nothing in the page asks the server again until the person comes back to the tab.

declare const document: { dispatchEvent: (event: unknown) => void };
declare class Event {
  constructor(type: string);
}

test('no request repeats after every distribution has finished, and coming back to the tab loads once', async ({ page }) => {
  const calls: string[] = [];
  const running: boolean[] = [];
  page.on('request', (r: Request) => {
    if (r.url().includes('/api/') && !r.url().includes('/auth/')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  page.on('response', async (res) => {
    if (res.url().includes('/api/jobs') && res.request().method() === 'GET' && !/\/jobs\/[0-9a-f-]{36}/.test(res.url())) {
      const body = (await res.json().catch(() => ({}))) as { items?: { status: string }[] };
      const list = body.items ?? [];
      running.push(list.some((j) => j.status === 'pending' || j.status === 'in_progress'));
    }
  });

  await page.clock.install();
  await signIn(page, SAM);
  await expect.poll(() => running.length).toBeGreaterThan(0);
  test.skip(running.at(-1) === true, 'a distribution is still running in the local stack; the list is allowed to poll');

  const listCalls = (): number => calls.filter((c) => c === 'GET /api/jobs' || c.startsWith('GET /api/jobs?')).length;
  const before = listCalls();
  await page.clock.runFor(5 * 60_000);
  await page.waitForTimeout(500);
  expect(listCalls()).toBe(before);

  // Coming back to the tab loads the list once more.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(listCalls).toBe(before + 1);
  await page.clock.runFor(5 * 60_000);
  await page.waitForTimeout(500);
  expect(listCalls()).toBe(before + 1);
});
