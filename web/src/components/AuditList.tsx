import type { AuditEvent } from '../tracking/api.js';
import { describeAudit, formatTime, shortId } from '../tracking/format.js';

const TONES: Record<string, { bg: string; fg: string }> = {
  sent: { bg: '#EEF3FF', fg: '#2B59C3' },
  delivery: { bg: '#ECFDF3', fg: '#067647' },
  retry: { bg: '#FFFAEB', fg: '#B54708' },
  cancel: { bg: '#F2F4F7', fg: '#344054' },
  download: { bg: '#F4F3FF', fg: '#5925DC' },
  files: { bg: '#F2F4F7', fg: '#475467' },
};

interface RowProps {
  event: AuditEvent;
  /** Show the distribution's short id as a link (the Audit trail page). */
  onOpenJob?: (jobId: string) => void;
}

/** One audit event: a tile, the event, who did it, what happened, and when. */
export function AuditRow({ event, onOpenJob }: RowProps) {
  const line = describeAudit(event);
  const tone = TONES[line.tone] ?? { bg: '#F2F4F7', fg: '#475467' };
  return (
    <div className="arow">
      <div className="mono atime">{formatTime(event.occurredAt)}</div>
      <span className="atile" style={{ background: line.bad ? '#FEF3F2' : tone.bg, color: line.bad ? '#B42318' : tone.fg }} aria-hidden="true">
        {line.glyph}
      </span>
      <div className="grow">
        <div className="atitle">
          <span style={{ fontWeight: 600, color: line.bad ? '#B42318' : undefined }}>{line.title}</span>
          <span className="by">by {line.who}</span>
        </div>
        <div className="adetail">{line.detail}</div>
      </div>
      {event.jobId && onOpenJob && (
        <button className="link mono" type="button" onClick={() => onOpenJob(event.jobId as string)} title="Open this distribution">
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
        <div className="more">
          <button className="btn2" type="button" disabled={loading} onClick={onLoadMore}>
            {loading ? 'Loading…' : 'Load more events'}
          </button>
        </div>
      )}
    </div>
  );
}
