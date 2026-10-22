import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { env } from '../integration/helpers.js';
import { clearPage, newAccount, PRIYA, RAJ, SAM, signIn } from './helpers.js';

// M1, Browse destinations, as a regression pack (flow 1): sign-in, and seeing only your own teams.
const NEURO_BINDER = 'a3a4ad1e-e539-549e-80f9-508b960d620d'; // NEU-207 Regulatory, in the Neuro team only
const PASSWORD = 'correct-horse-battery-staple';

test('an account the administrator set up sees an empty tree, signs out and signs in again; the web app offers no registration', async ({ page }) => {
  // The page has no way to register (D-F1-17): it says who sets accounts up, and the old register address opens sign-in.
  await page.goto('/#/register');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('Accounts are set up by your study administrator.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create an account' })).toHaveCount(0);
  await expect(page.getByLabel('Full name')).toHaveCount(0);

  // The account itself is made outside the page (here through the Auth Service, as the seed script does).
  const email = await newAccount(page, 'E2E Person');
  await expect(page.getByText('You are not in a team yet')).toBeVisible();
  await expect(page.locator('.who .nm')).toHaveText('E2E Person');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('the sign-in page has the tagline and subtitle, and a wrong password gets one generic answer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'One upload, every binder that needs it.' })).toBeVisible();
  await expect(page.getByText('Clinical trial document distribution for study teams')).toBeVisible();
  await page.getByLabel('Work email').fill(PRIYA);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText(/no such|not found|exists/i); // it must not say whether the account exists
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});

test('each person sees only their own teams', async ({ browser }) => {
  const expected: Array<[string, string[]]> = [
    [PRIYA, ['Cardio', 'Oncology']],
    [RAJ, ['Cardio']],
    [SAM, ['Neuro']],
  ];
  for (const [email, teams] of expected) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signIn(page, email);
      await expect(page.locator('.row .name.team')).toHaveText(teams);
      await expect(page.locator('.who .tm')).toHaveText(teams.join(', '));
      for (const other of ['Cardio', 'Oncology', 'Neuro'].filter((t) => !teams.includes(t))) {
        await expect(page.locator('.row .name.team', { hasText: other })).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  }
});

test('the tree loads a level only when it is opened', async ({ page }) => {
  const contents: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/(binders|folders)\/[^/]+\/contents/.test(r.url())) contents.push(r.url());
  });
  await signIn(page, PRIYA);
  await expect(page.locator('.row .name.team')).toHaveText(['Cardio', 'Oncology']); // the tree starts with the teams only
  await expect(page.getByText('CARDIO-301 Regulatory', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand Cardio', exact: true }).click();
  await expect(page.getByText('CARDIO-301 Regulatory', { exact: true })).toBeVisible(); // the binders are listed
  expect(contents).toHaveLength(0); // but no binder's folders yet

  await page.getByRole('button', { name: 'Expand CARDIO-301 Regulatory' }).click();
  await expect(page.getByText('IRB approvals', { exact: true })).toBeVisible();
  expect(contents).toHaveLength(1);

  await page.getByRole('button', { name: 'Collapse CARDIO-301 Regulatory' }).click();
  await page.getByRole('button', { name: 'Expand CARDIO-301 Regulatory' }).click();
  await expect(page.getByText('IRB approvals', { exact: true })).toBeVisible();
  expect(contents).toHaveLength(1); // opened again from what was loaded
});

test('a binder has no tick, only its folders do (D-F1-3)', async ({ page }) => {
  await signIn(page, PRIYA);
  await page.getByRole('button', { name: 'Expand Cardio', exact: true }).click();
  await expect(page.getByText('CARDIO-301 Regulatory', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /CARDIO-301 Regulatory$/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand CARDIO-301 Regulatory' }).click();
  await expect(page.getByRole('checkbox', { name: /IRB approvals$/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /CARDIO-301 Regulatory$/ })).toHaveCount(0);
});

test("another team's binder answers 404, the same as one that does not exist", async ({ page }) => {
  await signIn(page, PRIYA); // Cardio and Oncology, not Neuro
  const token = (await page.evaluate("sessionStorage.getItem('docbeam.accessToken')")) as string;
  const get = (id: string) => page.request.get(`/api/binders/${id}/contents`, { headers: { authorization: `Bearer ${token}` } });
  const neuro = await get(NEURO_BINDER);
  const missing = await get('00000000-0000-4000-8000-000000000000');
  expect(neuro.status()).toBe(404);
  expect(missing.status()).toBe(404);
  expect(await neuro.json()).toEqual(await missing.json());
  // And the same call is allowed for the person who is in Neuro.
  const sam = await page.context().browser()!.newContext();
  const samPage = await sam.newPage();
  await signIn(samPage, SAM);
  const samToken = (await samPage.evaluate("sessionStorage.getItem('docbeam.accessToken')")) as string;
  const ok = await samPage.request.get(`/api/binders/${NEURO_BINDER}/contents`, { headers: { authorization: `Bearer ${samToken}` } });
  expect(ok.status()).toBe(200);
  await sam.close();
});

test('a reload keeps the sign-in, and a new tab signs in quietly with no password', async ({ page, context }) => {
  await signIn(page, PRIYA);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

  // A new tab has no token of its own. It tries one quiet refresh with the cookie before showing sign-in (D-M1-8).
  const tab = await context.newPage();
  await tab.goto('/');
  await expect(tab.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(tab.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
});

test('when the sign-in has ended, a dialog asks for the password and the page stays as it is', async ({ page }) => {
  await signIn(page, PRIYA);
  const name = `keep-${randomUUID().slice(0, 6)}.pdf`;
  await page.getByLabel('Choose files').setInputFiles([{ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF\n`) }]);
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(1, { timeout: 90_000 });

  // The server no longer accepts the access token or the refresh cookie, as after 12 hours. The next call that
  // needs the API gets 401, one refresh is tried, it is refused, and the sign-in ends.
  const unauthorised = { status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }) };
  await page.route('**/api/jobs**', (route) => route.fulfill(unauthorised));
  await page.route('**/api/auth/refresh', (route) => route.fulfill(unauthorised));
  await page.getByRole('button', { name: 'Status' }).click();
  // Opening Status reads the list (D-F1-25): that call meets the 401.
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Nothing on this page is lost');
  // The page behind keeps what it showed: no "could not be loaded" error while the dialog is open (D-F1-14).
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/couldn't be loaded/i)).toHaveCount(0);

  await page.unroute('**/api/jobs**');
  await page.unroute('**/api/auth/refresh');
  await dialog.getByLabel('Password', { exact: true }).fill(env.SEED_USER_PASSWORD as string);
  await dialog.getByRole('button', { name: 'Sign in again' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Distribute' }).click();
  await expect(page.locator('.frow', { hasText: name })).toHaveCount(1); // the prepared file is still there
  await clearPage(page);
});
