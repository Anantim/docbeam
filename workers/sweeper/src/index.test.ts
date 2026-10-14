import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from './index.js';

afterEach(() => vi.restoreAllMocks());

describe('sweeper handler', () => {
  it.each(['resend', 'cleanup'] as const)('logs a %s run', async (task) => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await handler({ task });
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({ name: 'sweeper', msg: 'sweeper run', task });
  });
});
