import { describe, expect, it } from 'vitest';
import { describeAudit, formatWhen, jobChip, plural, shortId, taskLook } from './format.js';

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

describe('audit events', () => {
  it('describes a distribution that was sent', () => {
    const line = describeAudit({ action: 'job.submitted', actorId: 'u', detail: { actorName: 'Priya Shah', fileCount: 2, destinationCount: 3, taskCount: 6 } });
    expect(line).toMatchObject({ title: 'Distribution sent', who: 'Priya Shah', detail: '2 files to 3 destinations, 6 deliveries.' });
  });

  it('shows only who for another person\'s job-wide event', () => {
    const line = describeAudit({ action: 'job.submitted', actorId: 'u', detail: { actorName: 'Priya Shah' } });
    expect(line.detail).toBe('Distribution sent.');
    expect(line.who).toBe('Priya Shah');
  });

  it('marks a failure as bad and a cancelled delivery as not', () => {
    const failed = describeAudit({
      action: 'task.failed',
      actorId: null,
      detail: { failureCode: 'CHECKSUM_MISMATCH', failureReason: 'a.pdf to Cardio / Reg: the fingerprint differs' },
    });
    expect(failed).toMatchObject({ title: 'Delivery failed', who: 'System', bad: true });
    expect(failed.detail).toContain('fingerprint differs');
    const cancelled = describeAudit({ action: 'task.failed', actorId: 'u', detail: { failureCode: 'CANCELLED', actorName: 'Priya Shah' } });
    expect(cancelled).toMatchObject({ title: 'Delivery cancelled', bad: false, who: 'Priya Shah' });
  });

  it('describes deliveries, retries, cancels, previews and refusals', () => {
    expect(describeAudit({ action: 'task.completed', actorId: null, detail: { fileName: 'a.pdf', destinationPath: 'Cardio / Reg' } }).detail).toBe('a.pdf to Cardio / Reg.');
    expect(describeAudit({ action: 'job.retried', actorId: 'u', detail: { retried: 2 } }).detail).toBe('2 failed deliveries sent again.');
    expect(describeAudit({ action: 'job.cancelled', actorId: 'u', detail: { cancelled: 1 } }).detail).toBe('1 waiting delivery cancelled.');
    expect(describeAudit({ action: 'download.issued', actorId: 'u', detail: { mode: 'preview', fileName: 'a.pdf' } }).title).toBe('Preview link issued');
    expect(describeAudit({ action: 'file.refused', actorId: null, detail: { fileName: 'x.pdf', reason: 'MALWARE' } })).toMatchObject({ bad: true, detail: 'x.pdf: malware found by the scan.' });
  });
});
