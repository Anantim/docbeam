import { test } from '@playwright/test';
import { addPdfs, CARDIO_IRB, CARDIO_PROTOCOL, PRIYA, send, signIn, tick } from './helpers.js';
const OUT = '/tmp/claude-1000/-home-anantim-docbeam/4493db39-09a8-4de3-a523-3d37ebc39507/scratchpad/shots';
test('shots', async ({ page }) => {
  await signIn(page, PRIYA);
  await addPdfs(page, 2, 'report');
  await tick(page, CARDIO_IRB); await tick(page, CARDIO_PROTOCOL);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${OUT}/d1280.png`, clip: { x: 320, y: 140, width: 560, height: 220 } });
  await send(page);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/s1280.png` });
});
