import { describe, expect, it } from 'vitest';
import { formatWhen, jobChip, plural, shortId, taskLook } from './format.js';

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

describe('times', () => {
  it('formats a date and time', () => {
    expect(formatWhen(new Date(2026, 9, 16, 9, 5).toISOString())).toBe('16 Oct 09:05');
  });
});
