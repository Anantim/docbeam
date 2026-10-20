import { JOB_STATUS_MEANING } from '../explain.js';
import { statusFromCounts } from '../tracking/apply.js';
import type { Counts, JobScope, JobSummary } from '../tracking/api.js';
import { formatWhen, jobChip, shortId } from '../tracking/format.js';
import { MoreRow } from './MoreRow.js';
import { StatusChip } from './StatusChip.js';

interface Props {
  /** The signed-in person, so their own distributions read "You" under any filter. */
  meId: string;
  /** What the list is filtered to, for the words of its empty state. */
  scope: JobScope;
  filtered?: boolean;
  jobs: JobSummary[] | null;
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
  /** The last request for the next page failed. */
  moreFailed: boolean;
  onMore: () => void;
  onRetry: () => void;
  selectedId: string | null;
  onOpen: (jobId: string) => void;
  /** The open distribution's live counts. Its row follows them, so it never disagrees with the panel beside it. */
  live?: { jobId: string; counts: Counts } | null;
}

const SKELETON_ROWS = 5;

/**
 * The distributions, newest first, one row each: short id, when it was sent, who sent it, how many files and
 * destinations, and its status. A row opens the side panel. The list is paged on scroll (D-F1-7).
 */
export function DistributionList({ meId, scope, filtered = false, jobs, error, hasMore, loadingMore, moreFailed, onMore, onRetry, selectedId, onOpen, live }: Props) {
  if (jobs === null && error === '') {
    return (
      <div className="card" role="status" aria-busy="true" aria-label="Loading distributions">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div className="dist-skeleton" key={i}>
            <span className="skeleton" />
          </div>
        ))}
      </div>
    );
  }
  if (jobs === null) {
    return (
      <div className="card state" role="alert">
        <strong>The list could not be loaded</strong>
        <span>{error}</span>
        <button className="btn2" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="card state">
        <strong>
          {filtered ? 'No distribution has this status' : scope === 'team' ? 'Nothing has been sent to your teams' : 'You have not sent a distribution yet'}
        </strong>
        {!filtered && scope !== 'team' && <span>Distributions you send appear here.</span>}
      </div>
    );
  }

  return (
    <div className="card dist">
      {error && !(hasMore && moreFailed) && (
        <div className="alert dist-error" role="alert">
          {error}
        </div>
      )}
      <table className="dist-table" aria-label="Distributions">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Sent</th>
            <th scope="col">Sender</th>
            <th scope="col" className="num-col dist-more">
              Files
            </th>
            <th scope="col" className="num-col dist-more">
              Folders
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const following = live && live.jobId === job.jobId ? live.counts : null;
            const status = following ? statusFromCounts(following, job.status === 'cancelled') : job.status;
            const chip = jobChip(status);
            const selected = selectedId === job.jobId;
            return (
              <tr key={job.jobId} className={selected ? 'on' : ''} onClick={() => onOpen(job.jobId)}>
                <td>
                  <button
                    type="button"
                    className="link mono dist-id"
                    title={job.jobId}
                    aria-current={selected ? 'true' : undefined}
                    aria-label={`Open distribution ${shortId(job.jobId)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(job.jobId);
                    }}
                  >
                    {shortId(job.jobId)}
                  </button>
                </td>
                <td>{formatWhen(job.createdAt)}</td>
                <td className="ellipsis" title={job.submittedBy.name}>
                  {job.submittedBy.userId === meId ? 'You' : job.submittedBy.name}
                </td>
                <td className="num-col dist-more">{job.fileCount}</td>
                <td className="num-col dist-more">{job.destinationCount}</td>
                <td>
                  <StatusChip tone={chip.tone} label={chip.label} title={JOB_STATUS_MEANING[status]} />
                  {(status === 'pending' || status === 'in_progress') && <ProgressBar counts={following ?? job.counts} total={job.taskCount} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && <MoreRow className="state small" busy={loadingMore} failed={moreFailed} onMore={onMore} />}
    </div>
  );
}

const pct = (n: number, total: number): number => (total > 0 ? (n / total) * 100 : 0);

/** A thin bar under the chip of a distribution that is still running. */
function ProgressBar({ counts, total }: { counts: Counts; total: number }) {
  return (
    <div className="jbar thin" aria-hidden="true">
      <div data-tone="ok" style={{ width: `${pct(counts.completed, total)}%` }} />
      <div data-tone="bad" style={{ width: `${pct(counts.failed, total)}%` }} />
      <div data-tone="busy" style={{ width: `${pct(counts.in_progress, total)}%` }} />
    </div>
  );
}
