import { FAILURE_CODES, JOB_STATUSES, TASK_STATUSES } from '@docbeam/shared/browser';
import { describe, expect, it } from 'vitest';
import { failureMeaning, FAILURE_MEANING, JOB_STATUS_MEANING, TASK_STATUS_MEANING, UPLOAD_STATUS_MEANING } from './explain.js';

describe('the shared meanings', () => {
  it('has one line for every failure code, task status, job status and upload status', () => {
    expect(Object.keys(FAILURE_MEANING).sort()).toEqual([...FAILURE_CODES].sort());
    expect(Object.keys(TASK_STATUS_MEANING).sort()).toEqual([...TASK_STATUSES, 'cancelled'].sort());
    expect(Object.keys(JOB_STATUS_MEANING).sort()).toEqual([...JOB_STATUSES].sort());
    expect(Object.keys(UPLOAD_STATUS_MEANING)).toHaveLength(9);
  });

  it('keeps each one short and on one line', () => {
    const all = [FAILURE_MEANING, TASK_STATUS_MEANING, JOB_STATUS_MEANING, UPLOAD_STATUS_MEANING].flatMap((m) => Object.values(m));
    for (const text of all) {
      expect(text.includes('\n')).toBe(false);
      expect(text.length).toBeLessThanOrEqual(100);
      expect(text.endsWith('.')).toBe(true);
    }
  });

  it('explains RETRIES_EXHAUSTED the way the person asked', () => {
    expect(FAILURE_MEANING.RETRIES_EXHAUSTED).toBe('Tried 5 times over about 17 minutes; the platform did not accept it.');
  });

  it('says nothing for a code it does not know', () => {
    expect(failureMeaning('SOMETHING_NEW')).toBeUndefined();
    expect(failureMeaning(null)).toBeUndefined();
    expect(failureMeaning('CANCELLED')).toContain('cancelled');
  });
});
