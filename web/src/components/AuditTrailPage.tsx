import { useEffect, useMemo, useState } from 'react';
import { AUDIT_KINDS, dayHeading, dayKey, shortId } from '../tracking/format.js';
import { useAudit } from '../tracking/useAudit.js';
import { AuditRow } from './AuditList.js';

/**
 * The full history across every distribution the person can see (flow 3). Filter by kind of event and by
 * distribution. Events are only ever added, so this is the whole record, a page at a time.
 */
export function AuditTrailPage({ onOpenJob }: { onOpenJob: (jobId: string) => void }) {
  const [kind, setKind] = useState('all');
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const actions = AUDIT_KINDS.find((k) => k.id === kind)?.actions ?? [];
  const { events, hasMore, loading, error, loadMore } = useAudit({ ...(jobId ? { jobId } : {}), actions });

  // The Distribution filter offers the distributions seen so far, so it stays whole after one is chosen.
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    setSeen((prev) => {
      const next = [...prev];
      for (const e of events) if (e.jobId && !next.includes(e.jobId)) next.push(e.jobId);
      return next.length === prev.length ? prev : next;
    });
  }, [events]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; heading: string; items: typeof events }> = [];
    for (const e of events) {
      const key = dayKey(e.occurredAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, heading: dayHeading(e.occurredAt), items: [e] });
    }
    return out;
  }, [events]);

  return (
    <div className="audit-page">
      <div className="audit-head">
        <div>
          <h1>Audit trail</h1>
          <div className="lead">The full history of every distribution you can see. Events are only ever added, never changed or deleted.</div>
        </div>
        <div className="count-text" aria-live="polite">
          {events.length === 0 && !loading ? 'No events yet' : `${events.length} ${events.length === 1 ? 'event' : 'events'} loaded${hasMore ? ', more available' : ''}`}
        </div>
      </div>

      <div className="card filters">
        <div className="pills" role="group" aria-label="Event">
          <span className="plabel">Event</span>
          {AUDIT_KINDS.map((k) => (
            <button key={k.id} type="button" className={`pill ${kind === k.id ? 'on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="pills" role="group" aria-label="Distribution">
          <span className="plabel">Distribution</span>
          <button type="button" className={`pill ${jobId === undefined ? 'on' : ''}`} aria-pressed={jobId === undefined} onClick={() => setJobId(undefined)}>
            All
          </button>
          {seen.slice(0, 7).map((id) => (
            <button key={id} type="button" className={`pill mono ${jobId === id ? 'on' : ''}`} aria-pressed={jobId === id} title={id} onClick={() => setJobId(id)}>
              {shortId(id)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {!loading && !error && events.length === 0 && <div className="card empty-line">No events match these filters.</div>}
      {loading && events.length === 0 && <div className="card empty-line">Loading…</div>}
      {groups.map((g) => (
        <div key={g.key}>
          <div className="day">{g.heading.toUpperCase()}</div>
          <div className="card agroup">
            {g.items.map((e) => (
              <AuditRow key={e.id} event={e} onOpenJob={onOpenJob} />
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <div className="load-more">
          <button className="btn2" type="button" disabled={loading} onClick={() => void loadMore()}>
            {loading ? 'Loading…' : 'Load more events'}
          </button>
        </div>
      )}
    </div>
  );
}
