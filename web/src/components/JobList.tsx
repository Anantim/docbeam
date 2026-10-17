import type { ReactNode } from 'react';
import { JOB_STATUS_MEANING } from '../explain.js';
import { statusFromCounts } from '../tracking/apply.js';
import { StatusChip } from './StatusChip.js';
import type { JobSummary } from '../tracking/api.js';
import { formatWhen, jobChip, plural, shortId } from '../tracking/format.js';

interface Props {
  scope: 'mine' | 'team';
  onScope: (scope: 'mine' | 'team') => void;
  /** Null while the first answer is awaited. */
  jobs: JobSummary[] | null;
  error: string;
  selectedId: string | null;
  onOpen: (jobId: string) => void;
  /** The open distribution's live counts. Its card follows them, so it never disagrees with the page beside it. */
  live?: { jobId: string; counts: JobSummary['counts'] } | null;
  /** Shown between the Mine / My teams switch and the cards, as in the mockup (the Open-by-ID box). */
  children?: ReactNode;
}

/** Cancelled is grey in every bar and tile; red is for real failures only (D-M3-17). */
export const CANCELLED_GREY = '#98A2B3';

const pct = (n: number, total: number): number => (total > 0 ? (n / total) * 100 : 0);

/** The Distributions list of the Status page: Mine and My teams, each card a chip and a progress bar. */
export function JobList({ scope, onScope, jobs, error, selectedId, onOpen, live, children }: Props) {
  return (
    <>
      <div className="seg-group" role="group" aria-label="Whose distributions">
        {(
          [
            ['mine', 'Mine'],
            ['team', 'My teams'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={`seg ${scope === id ? 'on' : ''}`} aria-pressed={scope === id} onClick={() => onScope(id)}>
            {label}
          </button>
        ))}
      </div>

      {children}

      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {jobs === null && !error && <div className="card jempty">Loading distributions…</div>}
      {jobs?.length === 0 && (
        <div className="card jempty">
          {scope === 'mine' ? 'You have not sent a distribution yet. Send one from the Distribute tab.' : 'No one else has sent anything to your teams yet.'}
        </div>
      )}
      {jobs?.map((job) => {
        // The open distribution follows its live counts; the others show what the 30-second refresh read.
        const following = live && live.jobId === job.jobId ? live.counts : null;
        const c = following ?? job.counts;
        const status = following ? statusFromCounts(following, job.status === 'cancelled') : job.status;
        const chip = jobChip(status);
        return (
          <button
            key={job.jobId}
            type="button"
            className={`jcard ${selectedId === job.jobId ? 'on' : ''}`}
            aria-current={selectedId === job.jobId ? 'true' : undefined}
            onClick={() => onOpen(job.jobId)}
          >
            <div className="jcard-top">
              <span className="mono jid" title={job.jobId}>
                {shortId(job.jobId)}
              </span>
              <span className="grow" />
              <StatusChip tone={chip.tone} label={chip.label} title={JOB_STATUS_MEANING[status]} />
            </div>
            <div className="jcard-by">
              {scope === 'team' ? `${job.submittedBy.name}, ` : ''}
              {formatWhen(job.createdAt)}, {plural(job.taskCount, 'delivery', 'deliveries')}
              {scope === 'team' ? ' to your teams' : ''}
            </div>
            <div className="jbar" aria-hidden="true">
              <div style={{ width: `${pct(c.completed, job.taskCount)}%`, background: '#12B76A' }} />
              <div style={{ width: `${pct(c.failed, job.taskCount)}%`, background: '#F04438' }} />
              <div style={{ width: `${pct(c.in_progress, job.taskCount)}%`, background: '#2B59C3' }} />
              <div style={{ width: `${pct(c.cancelled, job.taskCount)}%`, background: CANCELLED_GREY }} />
            </div>
          </button>
        );
      })}
    </>
  );
}
