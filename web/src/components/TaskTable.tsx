import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveClient } from '../live/socket.js';
import { ApiFailure } from '../auth/session.js';
import { TASK_PAGE, trackingApi, type TaskRow, type TaskStatus } from '../tracking/api.js';
import { applyTaskUpdate } from '../tracking/apply.js';
import { failureMeaning, TASK_STATUS_MEANING } from '../explain.js';
import { DownloadButton, NOT_YET, PreviewButton } from './FileActions.js';
import { StatusChip, TONES } from './StatusChip.js';
import { taskLook } from '../tracking/format.js';
import { pagesFor, visibleRange } from '../tracking/virtual.js';

export const ROW_HEIGHT = 64;
const MAX_ATTEMPTS = 5;

interface Props {
  jobId: string;
  status: TaskStatus | 'all';
  /** Changes when the page must load the tasks again (after a reconnect, a cancel or a retry). */
  reloadKey: number;
  live: LiveClient;
  viewportHeight?: number;
}

/**
 * The deliveries of one distribution, up to 2,000 rows, 100 loaded at a time. Only the rows in view are drawn
 * (TDD Step 3.4). Live pushes change a row in place; a reload keeps the old rows on screen until the new page arrives.
 */
export function TaskTable({ jobId, status, reloadKey, live, viewportHeight = 480 }: Props) {
  const [pages, setPages] = useState<Map<number, TaskRow[]>>(new Map());
  const [total, setTotal] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [error, setError] = useState('');
  const [firstLoaded, setFirstLoaded] = useState(false);

  const generation = useRef(0);
  const inflight = useRef(new Set<number>());
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const scroller = useRef<HTMLDivElement>(null);
  const filter = status === 'all' ? undefined : status;

  const load = useCallback(
    async (page: number, gen: number): Promise<void> => {
      if (inflight.current.has(page)) return;
      inflight.current.add(page);
      try {
        const out = await trackingApi.tasks(jobId, page, filter);
        if (generation.current !== gen) return;
        setTotal(out.total);
        setPages((prev) => new Map(prev).set(page, out.tasks));
        setError('');
        setFirstLoaded(true);
      } catch (e) {
        if (generation.current === gen) setError(e instanceof ApiFailure ? e.message : 'The deliveries could not be loaded.');
      } finally {
        inflight.current.delete(page);
      }
    },
    [jobId, filter],
  );

  // A different distribution or filter starts again from the top.
  useEffect(() => {
    generation.current += 1;
    inflight.current.clear();
    setPages(new Map());
    setTotal(0);
    setScrollTop(0);
    setFirstLoaded(false);
    if (scroller.current) scroller.current.scrollTop = 0;
    void load(1, generation.current);
  }, [load]);

  // A reload asks again for the pages already on screen, and leaves them in place until the answers come.
  const reloads = useRef(reloadKey);
  useEffect(() => {
    if (reloads.current === reloadKey) return;
    reloads.current = reloadKey;
    const wanted = new Set([1, ...pagesRef.current.keys()]);
    for (const p of wanted) void load(p, generation.current);
  }, [reloadKey, load]);

  // Scrolling to rows that are not loaded yet loads their pages.
  const range = visibleRange({ scrollTop, viewport: viewportHeight, rowHeight: ROW_HEIGHT, total });
  useEffect(() => {
    for (const p of pagesFor(range, TASK_PAGE)) {
      if (!pagesRef.current.has(p)) void load(p, generation.current);
    }
  }, [range.start, range.end, total, load]);

  // Live pushes. With every status shown, a row is changed in place. With a filter on, the row may leave the
  // list, so the visible pages are loaded again instead.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = live.onMessage((message) => {
      if (message.jobId !== jobId || message.type !== 'task_update') return;
      if (status === 'all') {
        setPages((prev) => {
          for (const [page, rows] of prev) {
            const at = rows.findIndex((r) => r.taskId === message.taskId);
            if (at < 0) continue;
            const next = applyTaskUpdate(rows[at] as TaskRow, message);
            if (next === rows[at]) return prev;
            const copy = new Map(prev);
            copy.set(page, rows.map((r, i) => (i === at ? next : r)));
            return copy;
          }
          return prev;
        });
      } else {
        clearTimeout(timer);
        timer = setTimeout(() => {
          for (const p of new Set([1, ...pagesRef.current.keys()])) void load(p, generation.current);
        }, 600);
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [live, jobId, status, load]);

  const columns = columnsFor([...pages.values()].flat().map((t) => t.destinationPath));
  const rows: Array<{ index: number; task: TaskRow | undefined }> = [];
  for (let i = range.start; i < range.end; i++) {
    rows.push({ index: i, task: pages.get(Math.floor(i / TASK_PAGE) + 1)?.[i % TASK_PAGE] });
  }

  return (
    <div className="ttable" role="table" aria-label="Deliveries" aria-rowcount={total + 1} style={{ ['--cols' as string]: columns }}>
      <div className="trow thead" role="row">
        <div role="columnheader">File</div>
        <div role="columnheader">Destination</div>
        <div role="columnheader">Status</div>
        <div role="columnheader">Attempts</div>
        <div role="columnheader">Details and actions</div>
      </div>
      {error && (
        <div role="alert" className="alert" style={{ margin: 12 }}>
          {error}
        </div>
      )}
      {!error && firstLoaded && total === 0 && <div className="empty-line">No deliveries with this status.</div>}
      <div
        ref={scroller}
        className="tscroll"
        style={{ height: Math.min(viewportHeight, Math.max(ROW_HEIGHT, total * ROW_HEIGHT)) }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        tabIndex={0}
        aria-label="Deliveries list, scrolls"
      >
        <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
          {rows.map(({ index, task }) => (
            <div key={task?.taskId ?? `empty-${index}`} className="trow" role="row" aria-rowindex={index + 2} style={{ position: 'absolute', top: index * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}>
              {task ? <TaskCells task={task} /> : <div className="skeleton" role="cell" aria-label="Loading" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskCells({ task }: { task: TaskRow }) {
  const look = taskLook(task.status);
  const used = Math.min(MAX_ATTEMPTS, task.attemptCount);
  return (
    <>
      <div role="cell" className="ellipsis tfile" title={task.fileName}>
        {task.fileName}
      </div>
      <div role="cell" className="ellipsis" title={task.destinationPath}>
        {task.destinationPath}
      </div>
      <div role="cell">
        <StatusChip tone={look.tone} label={look.label} title={TASK_STATUS_MEANING[task.status]} />
      </div>
      <div role="cell" className="attempts" title={used === 0 ? 'Not attempted yet' : `${used} of the ${MAX_ATTEMPTS} allowed attempts`}>
        <span aria-hidden="true" className="segs">
          {Array.from({ length: MAX_ATTEMPTS }, (_, i) => (
            <span key={i} style={{ background: i < used ? TONES[look.tone].dot : '#E4E7EC' }} />
          ))}
        </span>
        <span className="num">{used} of {MAX_ATTEMPTS}</span>
      </div>
      <div role="cell" className="tdetail">
        {task.status === 'failed' && (
          <>
            <div className="code" title={failureMeaning(task.failureCode)}>
              {task.failureCode}
            </div>
            <div className="reason" title={task.failureReason ?? undefined}>
              {task.failureReason}
            </div>
          </>
        )}
        {task.status === 'completed' && (task.fileExpired ? <ExpiredNote /> : <FileButtons name={task.fileName} />)}
        {task.status === 'in_progress' && <span className="muted">Delivering now</span>}
        {task.status === 'pending' && <span className="muted">In the queue</span>}
      </div>
    </>
  );
}

function ExpiredNote() {
  return (
    <span className="muted">
      The uploaded file is more than 33 days old and has been deleted from storage. The delivered copy is still in the folder.
    </span>
  );
}

/** Preview and Download are wired up in M4 (TDD Step 3.4). They are shown as on Distribute, and wait. */
function FileButtons({ name }: { name: string }) {
  return (
    <div className="tbuttons">
      <PreviewButton name={name} offBecause={NOT_YET} />
      <DownloadButton name={name} offBecause={NOT_YET} />
    </div>
  );
}

/**
 * The columns size to what is in them (D-M3-12): the file name gets the spare room, the destination only as
 * much as its longest path (up to 48 characters), and the rest are fixed to their chips. Rows are drawn one by
 * one, so the widths come from the rows loaded so far, not from the rows in view.
 */
export function columnsFor(destinationPaths: readonly string[]): string {
  const longest = destinationPaths.reduce((n, p) => Math.max(n, p.length), 0);
  const dest = Math.min(48, Math.max(12, longest + 1));
  return `minmax(160px, 1fr) minmax(0, ${dest}ch) 124px 112px minmax(200px, 34ch)`;
}
