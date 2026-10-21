import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The motion rules (D-F1-47), read from the stylesheet and the sources.
const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'testing' ? [] : sources(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('motion tokens', () => {
  it('has the durations 80, 100, 120, 140, 150, 180, 200 and 300 ms and one ease-out curve', () => {
    for (const [name, ms] of [['t-80', 80], ['t-100', 100], ['t-120', 120], ['t-140', 140], ['t-150', 150], ['t-180', 180], ['t-200', 200], ['t-300', 300]] as const) {
      expect(css).toMatch(new RegExp(`--${name}: ${ms}ms;`));
    }
    expect(css.match(/--ease-out: cubic-bezier\([^)]*\);/g)).toHaveLength(1);
    // Every transition and animation uses the tokens, not a number of its own.
    const effects = css.slice(css.indexOf('/* ---- Effects (D-F1-47)'));
    expect(effects.match(/\b(?:transition|animation)[^;{}]*\b\d+(?:\.\d+)?m?s\b/g)?.filter((s) => !s.includes('fresh-fade 1s')) ?? []).toEqual([]);
  });

  it('under reduced motion nothing moves and every duration is 80 ms or less', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([^@]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(reduced).toMatch(/--lift: 0px; --lift-toast: 0px; --slide-panel: 0px; --scale-from: 1;/);
    const durations = [...reduced.matchAll(/--t-\d+: (\d+)ms/g)].map((m) => Number(m[1]));
    expect(durations).toHaveLength(8);
    expect(Math.max(...durations)).toBeLessThanOrEqual(80);
    expect(reduced).toMatch(/\.skeleton, \.sk \{ animation: none; \}/);
    // Every keyframe that moves reads its distance from a variable that is 0 above.
    for (const frames of css.matchAll(/@keyframes [\w-]+ \{[^@]*?\n?\}/g)) {
      const moves = /translate[XY]?\(([^)]*)\)/g;
      for (const m of frames[0].matchAll(moves)) expect(m[1] === '-50%' || /--(lift|lift-toast|slide-panel)/.test(m[1] ?? '')).toBe(true);
    }
  });

  it('animates only opacity, transform, colours and the two widths that were asked for (the progress bars; the panel moves by transform)', () => {
    const effects = css.slice(css.indexOf('/* ---- Effects (D-F1-47)'));
    const widthOrHeight = [...effects.matchAll(/transition:[^;]*\b(width|height|top|left|right|bottom|margin|padding)\b[^;]*;/g)].map((m) => m[0]);
    expect(widthOrHeight.every((t) => t.includes('width var(--t-300)'))).toBe(true); // the progress bar
    expect(widthOrHeight).toHaveLength(1);
    for (const frames of css.matchAll(/@keyframes [\w-]+ \{[^@]*?\n?\}/g)) expect(frames[0]).not.toMatch(/\b(height|top|left|right|bottom|width|margin|padding)\s*:/);
  });

  it('does not animate scrolling, page changes or typing in filters', () => {
    expect(css).not.toMatch(/scroll-behavior:\s*smooth/);
    expect(css).not.toMatch(/\.field[^{]*\{[^}]*animation/);
    expect(css).not.toMatch(/transition:[^;]*\ball\b/);
  });
});

describe('tooltips are one component', () => {
  it('leaves no title attribute in web/src', () => {
    const offenders = sources(join(process.cwd(), 'web/src'))
      .filter((p) => p.endsWith('.tsx'))
      .flatMap((p) => readFileSync(p, 'utf8').split('\n').map((line, i) => ({ p, line, n: i + 1 })).filter(({ line }) => /\btitle=/.test(line)))
      .map(({ p, n }) => `${p.replace(process.cwd(), '')}:${n}`);
    expect(offenders).toEqual([]);
  });
});
