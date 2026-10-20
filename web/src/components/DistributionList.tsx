import { JOB_STATUS_MEANING } from '../explain.js';
import { statusFromCounts } from '../tracking/apply.js';
import type { Counts, JobSummary } from '../tracking/api.js';
import { formatWhen, jobChip, shortId } from '../tracking/format.js';
import { MoreRow } from './MoreRow.js';
import { StatusChip } from './StatusChip.js';

interface Props {
  scope: 'mine' | 'team';
  jobs: JobSummary[] | null;
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
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
export function DistributionList({ scope, jobs, error, hasMore, loadingMore, onMore, onRetry, selectedId, onOpen, live }: Props) {
  if (jobs === null && error === '') {
    return (
      <div className="card" aria-busy="true" aria-label="Loading distributions">
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
        <strong>{scope === 'mine' ? 'You have not sent a distribution yet' : 'Nothing has been sent to your teams'}</strong>
        {scope === 'mine' && <span>Distributions you send appear here.</span>}
      </div>
    );
  }

  return (
    <div className="card dist">
      {error && !hasMore && (
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
              Destinations
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
              <tr key={job.jobId} className={selected ? 'on' : ''} onClick={() => onOpen(job.jobId)} aria-selected={selected}>
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
                  {scope === 'mine' ? 'You' : job.submittedBy.name}
                </td>
                <td className="num-col dist-more">{job.fileCount}</td>
                <td className="num-col dist-more">{job.destinationCount}</td>
                <td>
                  <StatusChip tone={chip.tone} label={chip.label} title={JOB_STATUS_MEANING[status]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && <MoreRow className="state small" busy={loadingMore} failed={error !== ''} onMore={onMore} />}
    </div>
  );
}
