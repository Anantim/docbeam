import { expect, test, type Locator } from '@playwright/test';
import { PRIYA, removeSeeded, seedJob, signIn } from './helpers.js';

// The Files and Destinations cells of the full-width list (D-F1-57): "<first file> +N" and "<first two folders> +N", one line,
// the ellipsis on the names only, "+N" always whole, and Files and Destinations sharing the spare width about 40 / 60.

const SHOTS = process.env.SHOT_DIR;
const folders = ['Cardio / CARDIO-301 Regulatory / IRB approvals', 'Cardio / CARDIO-301 Regulatory / Protocol amendments', 'Oncology / ONC-118 Regulatory / Ethics committee', 'Oncology / ONC-118 Site files / Delegation logs', 'Neuro / NEURO-204 Regulatory / Ethics committee'];

const textOf = async (cell: Locator): Promise<string> => (await cell.innerText()).replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();

for (const width of [1440, 1280, 1024]) {
  test(`Files and Destinations show the names and "+N" at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, PRIYA);
    const names = (n: number, prefix: string): string[] => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(3, '0')}.pdf`);
    const one = await seedJob(page, names(1, 'one-'), folders.slice(0, 1));
    const two = await seedJob(page, names(2, 'two-'), folders.slice(0, 2));
    const many = await seedJob(page, names(100, 'many-'), folders);
    try {
      await page.getByRole('button', { name: 'Distribute' }).click();
      await page.getByRole('button', { name: 'Status' }).click();
      const row = (id: string): Locator => page.locator('tr', { has: page.locator(`[data-job-id="${id}"]`) });
      await expect(row(many)).toBeVisible();
      const cells = async (id: string): Promise<{ files: Locator; dests: Locator }> => ({ files: row(id).locator('td').nth(3), dests: row(id).locator('td').nth(4) });

      // 1, 2 and 100 files; 1, 2 and 5 folders: the text that is drawn.
      const a = await cells(one);
      expect(await textOf(a.files)).toBe('one-001.pdf'); // a single file: its name, no "+N"
      expect(await textOf(a.dests)).toBe('Cardio · IRB approvals'); // "team · folder" (D-F1-81)
      const b = await cells(two);
      expect(await textOf(b.files)).toBe('two-001.pdf +1');
      expect(await textOf(b.dests)).toBe('Cardio · IRB approvals, Cardio · Protocol amendments'); // two folders: both, no "+N"
      const c = await cells(many);
      expect(await textOf(c.files)).toBe('many-001.pdf +99');
      expect(await textOf(c.dests)).toBe('Cardio · IRB approvals, Cardio · Protocol amendments +3');

      for (const id of [one, two, many]) {
        const { files, dests } = await cells(id);
        for (const cell of [files, dests]) {
          // One line; the name is wider than a few characters (not collapsed); "+N", where there is one, is whole and inside the cell.
          const name = cell.locator('.cell-text').first();
          expect((await name.boundingBox())!.width, 'the name is not collapsed').toBeGreaterThan(40);
          const more = cell.locator('.count-link');
          if (await more.count()) {
            const cellBox = (await cell.boundingBox())!;
            const moreBox = (await more.boundingBox())!;
            expect(moreBox.x + moreBox.width, '"+N" is inside its cell').toBeLessThanOrEqual(cellBox.x + cellBox.width);
            expect(await more.evaluate((el: unknown) => (el as { scrollWidth: number; clientWidth: number }).scrollWidth <= (el as { clientWidth: number }).clientWidth), '"+N" is not cut').toBe(true);
          }
        }
        expect(Math.round((await row(id).boundingBox())!.height), 'one line, one row height').toBeLessThanOrEqual(53);
      }

      // Files and Destinations share the spare width about 40 / 60.
      const fw = (await c.files.boundingBox())!.width;
      const dw = (await c.dests.boundingBox())!.width;
      expect(fw / (fw + dw), `Files take about 40% of the pair at ${width} px (${Math.round(fw)} and ${Math.round(dw)} px)`).toBeGreaterThan(0.35);
      expect(fw / (fw + dw)).toBeLessThan(0.45);

      // Hovering the cell outside the name shows no stray tooltip; hovering the name shows the whole name when it is cut.
      await page.mouse.move(0, 0);
      await c.files.hover({ position: { x: (await c.files.boundingBox())!.width - 6, y: 6 } });
      await page.waitForTimeout(500);
      await expect(page.getByRole('tooltip')).toHaveCount(0);

      if (SHOTS) await page.locator('.dist-scroll').screenshot({ path: `${SHOTS}/status-cells-${width}.png` });
    } finally {
      for (const id of [one, two, many]) await removeSeeded(id);
    }
  });
}
