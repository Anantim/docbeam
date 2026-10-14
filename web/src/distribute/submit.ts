import { ApiFailure } from '../auth/session.js';
import type { JobAccepted } from '../upload/api.js';
import type { JobBody } from './mapping.js';

export type SubmitOutcome =
  | { ok: true; jobId: string; taskCount: number }
  | { ok: false; message: string };

/**
 * One distribution's submission. The Idempotency-Key is made once and kept while the same batch is retried, so
 * a repeat after a 503 or a dropped connection can never create a second job (D-M2-4). A change to the files or
 * the mapping, or a success, starts a new key.
 */
export class Submission {
  private key: string | undefined;
  private fingerprint = '';

  constructor(
    private readonly send: (body: JobBody, key: string) => Promise<JobAccepted>,
    private readonly newKey: () => string = () => crypto.randomUUID(),
  ) {}

  async submit(body: JobBody, describe: (binderId: string, folderId: string | null) => string): Promise<SubmitOutcome> {
    const fingerprint = JSON.stringify(body);
    if (this.key === undefined || fingerprint !== this.fingerprint) {
      this.key = this.newKey();
      this.fingerprint = fingerprint;
    }
    try {
      const accepted = await this.send(body, this.key);
      this.key = undefined;
      return { ok: true, ...accepted };
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === 'PLATFORM_UNAVAILABLE' || error.status === 503) {
          return { ok: false, message: 'The platform is not answering. Try again.' };
        }
        if (error.code === 'DESTINATION_NOT_FOUND') {
          const missing = (error.body?.notFound as { binderId: string; folderId?: string | null }[] | undefined) ?? [];
          const names = missing.map((d) => describe(d.binderId, d.folderId ?? null)).join(', ');
          return { ok: false, message: names ? `These destinations were not found or are not in your teams: ${names}.` : error.message };
        }
        return { ok: false, message: error.message };
      }
      // The connection dropped: the server may or may not have saved the job, so the same key goes again.
      return { ok: false, message: 'The connection was lost. Try again.' };
    }
  }
}
