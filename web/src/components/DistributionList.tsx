import { memo } from 'react';
import { JOB_STATUS_MEANING } from '../explain.js';
import { statusFromCounts } from '../tracking/apply.js';
import type { Counts, JobScope, JobSummary } from '../tracking/api.js';
import { formatWhen, jobChip, shortId } from '../tracking/format.js';
import { JobBar } from './JobBar.js';
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

interface RowProps {
  job: JobSummary;
  /** The live counts of the open distribution, or null: its row follows them. */
  counts: Counts | null;
  meId: string;
  selected: boolean;
  onOpen: (jobId: string) => void;
}

/** Two rows are the same when what they show is the same, so a refresh that changes nothing redraws no row. */
const sameRow = (a: RowProps, b: RowProps): boolean =>
  a.selected === b.selected &&
  a.meId === b.meId &&
  a.onOpen === b.onOpen &&
  a.counts === b.counts &&
  a.job.jobId === b.job.jobId &&
  a.job.status === b.job.status &&
  a.job.createdAt === b.job.createdAt &&
  a.job.taskCount === b.job.taskCount &&
  a.job.fileCount === b.job.fileCount &&
  a.job.destinationCount === b.job.destinationCount &&
  a.job.submittedBy.userId === b.job.submittedBy.userId &&
  a.job.submittedBy.name === b.job.submittedBy.name &&
  (Object.keys(a.job.counts) as Array<keyof Counts>).every((k) => a.job.counts[k] === b.job.counts[k]);

const Row = memo(function Row({ job, counts, meId, selected, onOpen }: RowProps) {
  const status = counts ? statusFromCounts(counts, job.status === 'cancelled') : job.status;
  const chip = jobChip(status);
  return (
    <tr className={selected ? 'on' : ''} onClick={() => onOpen(job.jobId)}>
      <td>
        <button
          type="button"
          className="link mono dist-id"
          title={job.jobId}
          data-job-id={job.jobId}
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
      <td>
        <StatusChip tone={chip.tone} label={chip.label} title={JOB_STATUS_MEANING[status]} />
        {(status === 'pending' || status === 'in_progress') && <JobBar counts={counts ?? job.counts} total={job.taskCount} thin />}
      </td>
      <td>{formatWhen(job.createdAt)}</td>
      <td className="ellipsis dist-more" title={job.submittedBy.name}>
        {job.submittedBy.userId === meId ? 'You' : job.submittedBy.name}
      </td>
      <td className="num-col dist-more">{job.fileCount}</td>
      <td className="num-col dist-more">{job.destinationCount}</td>
    </tr>
  );
}, sameRow);

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
            <th scope="col">Status</th>
            <th scope="col">Sent</th>
            <th scope="col" className="dist-more">
              Sender
            </th>
            <th scope="col" className="num-col dist-more">
              Files
            </th>
            <th scope="col" className="num-col dist-more">
              Folders
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const following = live && live.jobId === job.jobId ? live.counts : null;
            return <Row key={job.jobId} job={job} counts={following} meId={meId} selected={selectedId === job.jobId} onOpen={onOpen} />;
          })}
        </tbody>
      </table>
      {hasMore && <MoreRow className="state small" busy={loadingMore} failed={moreFailed} onMore={onMore} />}
    </div>
  );
}
