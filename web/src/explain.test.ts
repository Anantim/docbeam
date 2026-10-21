import { FAILURE_CODES, JOB_STATUSES, TASK_STATUSES } from '@docbeam/shared/browser';
import { describe, expect, it } from 'vitest';
import { failureMeaning, FAILURE_MEANING, INFECTED_REASON, JOB_STATUS_MEANING, TASK_STATUS_MEANING, UPLOAD_STATUS_MEANING } from './explain.js';

describe('the shared meanings', () => {
  it('has one line for every failure code, task status, job status and upload status', () => {
    expect(Object.keys(FAILURE_MEANING).sort()).toEqual([...FAILURE_CODES].sort());
    expect(Object.keys(TASK_STATUS_MEANING).sort()).toEqual([...TASK_STATUSES, 'cancelled'].sort());
    expect(Object.keys(JOB_STATUS_MEANING).sort()).toEqual([...JOB_STATUSES].sort());
    expect(Object.keys(UPLOAD_STATUS_MEANING)).toHaveLength(8); // malware is not a state: the file leaves the list (D-F1-78)
  });

  it('keeps each one short and on one line', () => {
    const all = [FAILURE_MEANING, TASK_STATUS_MEANING, JOB_STATUS_MEANING, UPLOAD_STATUS_MEANING].flatMap((m) => Object.values(m));
    for (const text of all) {
      expect(text.includes('\n')).toBe(false);
      expect(text.length).toBeLessThanOrEqual(100);
      expect(text.endsWith('.')).toBe(true);
    }
  });

  // The one reason map (D-F1-60): this test fails when a new failure code is added without a sentence, and when a sentence shows a
  // raw code or says what the row already says.
  it('has a plain sentence for every failure code and every problem a file can have, and none shows a raw code', () => {
    for (const code of FAILURE_CODES) {
      const sentence = FAILURE_MEANING[code];
      expect(sentence, code).toBeTruthy();
      expect(sentence, code).not.toMatch(/[A-Z]{2,}_[A-Z_]+/); // no raw code
      expect(sentence, code).not.toMatch(/\.(pdf|docx|xlsx|png|jpg)\b/i); // no file name
      expect(sentence, code).not.toContain(' / '); // no folder path
    }
    for (const status of ['refused', 'interrupted', 'unchecked'] as const) expect(UPLOAD_STATUS_MEANING[status], status).toBeTruthy();
  });

  it('says it the way the person asked', () => {
    expect(FAILURE_MEANING.FILE_NOT_UPLOADED).toBe("The file never finished uploading, so it couldn't be delivered.");
    expect(FAILURE_MEANING.CANCELLED).toBe('Cancelled by the sender before it was delivered.');
    expect(FAILURE_MEANING.DESTINATION_NOT_FOUND).toBe('The folder no longer exists.');
    expect(FAILURE_MEANING.NOT_AUTHORIZED_AT_DELIVERY).toBe('The sender is no longer in this team.');
    expect(FAILURE_MEANING.RETRIES_EXHAUSTED).toBe("The platform didn't respond after 5 attempts.");
    expect(INFECTED_REASON).toBe('Malware was found. The file was deleted.');
    expect(UPLOAD_STATUS_MEANING.unchecked).toBe("The scan couldn't run.");
    expect(UPLOAD_STATUS_MEANING.refused).toBe('Storage did not accept the upload.');
  });

  it('gives a plain sentence, never a raw code, for a code it does not know', () => {
    expect(failureMeaning('SOMETHING_NEW')).toBe('The delivery did not go through.');
    expect(failureMeaning(null)).toBe('The delivery did not go through.');
    expect(failureMeaning('CANCELLED')).toContain('Cancelled');
  });
});
