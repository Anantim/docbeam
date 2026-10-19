import type { AuditEvent } from '../tracking/api.js';
import { describeAudit, formatTime, shortId } from '../tracking/format.js';

/** The tile colour of each kind of event: the same status tones as everywhere else (D-F1-5). */
const TONES: Record<string, 'idle' | 'busy' | 'ok' | 'warn'> = {
  sent: 'busy',
  delivery: 'ok',
  retry: 'warn',
  cancel: 'idle',
  download: 'busy',
  files: 'idle',
};

interface RowProps {
  event: AuditEvent;
  /** Show the distribution's short id as a link (the Audit trail page). */
  onOpenJob?: (jobId: string) => void;
}

/** One audit event: a tile, the event, who did it, what happened, and when. */
export function AuditRow({ event, onOpenJob }: RowProps) {
  const line = describeAudit(event);
  const tone = line.bad ? 'bad' : (TONES[line.tone] ?? 'idle');
  return (
    <div className="arow">
      <div className="mono atime">{formatTime(event.occurredAt)}</div>
      <span className="atile" data-tone={tone} aria-hidden="true">
        {line.glyph}
      </span>
      <div className="grow">
        <div className="atitle">
          <span className="atitle-text" data-tone={line.bad ? 'bad' : undefined}>{line.title}</span>
          <span className="by">by {line.who}</span>
        </div>
        <div className="adetail">{line.detail}</div>
      </div>
      {event.jobId && onOpenJob && (
        <button className="link mono" type="button" onClick={() => onOpenJob(event.jobId as string)} title={`Open distribution ${event.jobId}`}>
          {shortId(event.jobId)}
        </button>
      )}
    </div>
  );
}

interface ListProps {
  events: AuditEvent[];
  hasMore: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => void;
  empty: string;
}

/** The flat list in a distribution's Audit tab. */
export function AuditList({ events, hasMore, loading, error, onLoadMore, empty }: ListProps) {
  return (
    <div className="audit-tab">
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {!loading && !error && events.length === 0 && <div className="empty-line">{empty}</div>}
      {events.map((e) => (
        <AuditRow key={e.id} event={e} />
      ))}
      {loading && events.length === 0 && <div className="empty-line">Loading…</div>}
      {hasMore && (
        <div className="load-more">
          <button className="btn2" type="button" disabled={loading} onClick={onLoadMore}>
            {loading ? 'Loading…' : 'Load more events'}
          </button>
        </div>
      )}
    </div>
  );
}
