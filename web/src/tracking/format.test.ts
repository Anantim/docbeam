import { describe, expect, it } from 'vitest';
import { formatFull, formatWhen, jobChip, plural, shortId, taskLook } from './format.js';

describe('labels', () => {
  it('names the five job statuses and four task states as the mockup does', () => {
    expect(jobChip('completed_with_errors').label).toBe('Completed with errors');
    expect(jobChip('cancelled').label).toBe('Cancelled');
    expect(taskLook('completed').label).toBe('Completed');
    expect(taskLook('pending').label).toBe('Pending');
  });

  it('shows a distribution as its first 8 characters', () => {
    expect(shortId('3f1c2a9e-84d5-4b6a-9c11-0a5f6d7e8b90')).toBe('3f1c2a9e');
  });

  it('pluralises', () => {
    expect(plural(1, 'delivery', 'deliveries')).toBe('1 delivery');
    expect(plural(0, 'delivery', 'deliveries')).toBe('0 deliveries');
  });
});

// Local times (the viewer's zone), so the tests do not depend on the zone the machine is in.
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date => new Date(y, mo - 1, d, h, mi, s);

describe('times (D-F1-59)', () => {
  const now = at(2026, 10, 21, 12, 0);

  it('today: "Today, 04:34"', () => {
    expect(formatWhen(at(2026, 10, 21, 4, 34).toISOString(), now)).toBe('Today, 04:34');
    expect(formatWhen(at(2026, 10, 21, 0, 0).toISOString(), now)).toBe('Today, 00:00'); // 24-hour, midnight is 00:00
    expect(formatWhen(at(2026, 10, 21, 23, 59).toISOString(), now)).toBe('Today, 23:59');
  });

  it('yesterday: "Yesterday, 18:10"', () => {
    expect(formatWhen(at(2026, 10, 20, 18, 10).toISOString(), now)).toBe('Yesterday, 18:10');
    expect(formatWhen(at(2026, 10, 20, 0, 0).toISOString(), now)).toBe('Yesterday, 00:00');
  });

  it('midnight is the edge: 23:59 is still yesterday a minute later, and 00:00 is today', () => {
    const before = at(2026, 10, 20, 23, 59).toISOString();
    expect(formatWhen(before, at(2026, 10, 20, 23, 59, 30))).toBe('Today, 23:59');
    expect(formatWhen(before, at(2026, 10, 21, 0, 0))).toBe('Yesterday, 23:59');
    expect(formatWhen(before, at(2026, 10, 22, 0, 0))).toBe('20 Oct, 23:59'); // the day after tomorrow's midnight: a date
  });

  it('this year: "21 Oct, 04:34" with a one-digit day not padded', () => {
    expect(formatWhen(at(2026, 10, 16, 9, 5).toISOString(), now)).toBe('16 Oct, 09:05');
    expect(formatWhen(at(2026, 3, 3, 14, 2).toISOString(), now)).toBe('3 Mar, 14:02');
  });

  it('an earlier year: "3 Mar 2025, 14:02", and the year boundary', () => {
    expect(formatWhen(at(2025, 3, 3, 14, 2).toISOString(), now)).toBe('3 Mar 2025, 14:02');
    // 1 January: 31 December of last year is "Yesterday"; the day before it has the year.
    const newYear = at(2027, 1, 1, 10, 0);
    expect(formatWhen(at(2026, 12, 31, 22, 30).toISOString(), newYear)).toBe('Yesterday, 22:30');
    expect(formatWhen(at(2026, 12, 30, 22, 30).toISOString(), newYear)).toBe('30 Dec 2026, 22:30');
    expect(formatWhen(at(2027, 1, 1, 0, 5).toISOString(), newYear)).toBe('Today, 00:05');
  });

  it('a time in the future (a clock that is a little behind) is a date, not "Today" by accident', () => {
    expect(formatWhen(at(2026, 10, 23, 8, 0).toISOString(), now)).toBe('23 Oct, 08:00');
  });

  it('the full time has seconds and the zone: "21 Oct 2026, 04:34:12 IST"', () => {
    expect(formatFull(at(2026, 10, 21, 4, 34, 12).toISOString())).toMatch(/^21 Oct 2026, 04:34:12( \S+)?$/);
    expect(formatFull(at(2025, 3, 3, 14, 2, 5).toISOString())).toMatch(/^3 Mar 2025, 14:02:05/);
  });
});
