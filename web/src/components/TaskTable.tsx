import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { LiveClient } from '../live/socket.js';
import { ApiFailure } from '../auth/session.js';
import { TASK_PAGE, trackingApi, type TaskKind, type TaskRow } from '../tracking/api.js';
import { applyTaskUpdate } from '../tracking/apply.js';
import { failureMeaning, TASK_STATUS_MEANING } from '../explain.js';
import { DownloadButton, PreviewButton } from './FileActions.js';
import { StatusChip } from './StatusChip.js';
import { plural, taskKindOf, taskLook } from '../tracking/format.js';
import { pagesFor, visibleRange } from '../tracking/virtual.js';

export const ROW_HEIGHT = 64;
const MAX_ATTEMPTS = 5;

interface Props {
  jobId: string;
  status: TaskKind | 'all';
  /** Changes when the page must load the tasks again (after a reconnect, a cancel or a retry). */
  reloadKey: number;
  live: LiveClient;
  /** Preview and Download on a delivered file (flow 4). */
  onPreview: (task: TaskRow) => void;
  onDownload: (task: TaskRow) => void;
  viewportHeight?: number;
}

/**
 * The deliveries of one distribution, up to 2,000 rows, 100 loaded at a time. Only the rows in view are drawn
 * (TDD Step 3.4). Live pushes change a row in place; a reload keeps the old rows on screen until the new page arrives.
 */
export function TaskTable({ jobId, status, reloadKey, live, onPreview, onDownload, viewportHeight = 480 }: Props) {
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

  const rows: Array<{ index: number; task: TaskRow | undefined }> = [];
  for (let i = range.start; i < range.end; i++) {
    rows.push({ index: i, task: pages.get(Math.floor(i / TASK_PAGE) + 1)?.[i % TASK_PAGE] });
  }

  return (
    <div className="ttable" role="table" aria-label="Deliveries" aria-rowcount={total + 1}>
      <div className="trow thead" role="row">
        <div role="columnheader">File and folder</div>
        <div role="columnheader">Status</div>
        <div role="columnheader" className="tattempts">
          Attempts
        </div>
        <div role="columnheader">Details</div>
      </div>
      {error && (
        <div role="alert" className="alert tmargin">
          {error}
        </div>
      )}
      {!firstLoaded && !error && (
        <div className="tree-skeleton" role="status" aria-label="Loading deliveries" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <span className="skeleton" key={i} />
          ))}
        </div>
      )}
      {!error && firstLoaded && total === 0 && <div className="state small">No deliveries with this status.</div>}
      <div
        ref={scroller}
        className="tscroll"
        style={{ height: Math.min(viewportHeight, Math.max(ROW_HEIGHT, total * ROW_HEIGHT)) }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        tabIndex={0}
        role="region"
        aria-label="Delivery rows, scrolls"
      >
        <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
          {rows.map(({ index, task }) => (
            <div key={task?.taskId ?? `empty-${index}`} className="trow" role="row" aria-rowindex={index + 2} style={{ position: 'absolute', top: index * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}>
              {task ? <TaskCells task={task} onPreview={onPreview} onDownload={onDownload} /> : <div className="skeleton" role="cell" aria-label="Loading" />}
            </div>
          ))}
        </div>
      </div>
      {total * ROW_HEIGHT > viewportHeight && (
        <div className="tnote">
          {plural(total, 'delivery', 'deliveries')}: scroll the list to see them all.
        </div>
      )}
    </div>
  );
}

/** One row's cells. Memoised: a scroll or a push for another row does not draw it again. */
const TaskCells = memo(function TaskCells({ task, onPreview, onDownload }: { task: TaskRow } & Pick<Props, 'onPreview' | 'onDownload'>) {
  const kind = taskKindOf(task);
  const look = taskLook(kind);
  const used = Math.min(MAX_ATTEMPTS, task.attemptCount);
  return (
    <>
      <div role="cell" className="tfile-cell">
        <div className="ellipsis tfile" title={task.fileName}>
          {task.fileName}
        </div>
        <div className="ellipsis lead dest-text" title={task.destinationPath}>
          {task.destinationPath}
        </div>
      </div>
      <div role="cell">
        <StatusChip tone={look.tone} label={look.label} title={TASK_STATUS_MEANING[kind]} />
      </div>
      <div role="cell" className="size tattempts" title={used === 0 ? 'Not attempted yet' : `${plural(used, 'attempt', 'attempts')} of the ${MAX_ATTEMPTS} allowed`}>
        {used} of {MAX_ATTEMPTS}
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
        {task.status === 'completed' && (task.fileExpired ? (
          <span className="muted" title="The uploaded file is more than 33 days old and has been deleted from storage. The delivered copy is still in the folder.">
            File expired
          </span>
        ) : (
          <div className="tbuttons">
            <PreviewButton name={task.fileName} onClick={() => onPreview(task)} />
            <DownloadButton name={task.fileName} onClick={() => onDownload(task)} />
          </div>
        ))}
        {task.status === 'in_progress' && <span className="muted">Delivering now</span>}
        {task.status === 'pending' && <span className="muted">In the queue</span>}
      </div>
    </>
  );
});
