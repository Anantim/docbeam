import { memo, useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import type { LiveClient } from '../live/socket.js';
import { TASK_PAGE, trackingApi, type TaskKind, type TaskRow } from '../tracking/api.js';
import { applyTaskUpdate } from '../tracking/apply.js';
import { failureMeaning, TASK_STATUS_MEANING } from '../explain.js';
import { DownloadButton, PreviewButton } from './FileActions.js';
import { InfoIcon } from './Icons.js';
import { matchesFilter, NoMatches } from './ListFilter.js';
import { StatusChip } from './StatusChip.js';
import { Tooltip } from './Tooltip.js';
import { TypeBadge } from './TypeBadge.js';
import { plural, taskKindOf, taskLook } from '../tracking/format.js';
import { pagesFor, visibleRange } from '../tracking/virtual.js';

/** One delivery row: the file name with the folder path in small text under it (D-F1-46). The list of distributions uses the same height (`--row-h`). */
export const ROW_HEIGHT = 52; // the same as --row-h in the stylesheet, which the list of distributions uses too (D-F1-56)
const MAX_ATTEMPTS = 5;

interface Props {
  jobId: string;
  status: TaskKind | 'all';
  /** The "Filter…" box above (in the panel's Deliveries row) narrows the rows loaded so far by file name or folder path (D-F1-41). */
  query?: string;
  /** "Clear filter" under "No matches": the panel empties its box and puts the focus back in it. */
  onClearFilter?: () => void;
  /** Changes when the page must load the tasks again (after a reconnect, a cancel or a retry). */
  reloadKey: number;
  live: LiveClient;
  /** Preview and Download on a delivered file (flow 4). */
  onPreview: (task: TaskRow) => void;
  onDownload: (task: TaskRow) => void;
  /** How tall the rows' box is when it does not fill: the rows scroll inside it. */
  viewportHeight?: number;
  /** In the side panel: the box takes the height that is left (CSS) and the rows scroll inside it, with a fade at the bottom edge (D-F1-26). */
  fill?: boolean;
}

/** Space kept clear under a row that keyboard focus scrolls into view, so the fade at the bottom edge does not cover it. */
const FOCUS_PAD = 24;

/**
 * The deliveries of one distribution, up to 2,000 rows, 100 loaded at a time. Only the rows in view are drawn
 * (TDD Step 3.4). Live pushes change a row in place; a reload keeps the old rows on screen until the new page arrives.
 */
export function TaskTable({ jobId, status, query = '', onClearFilter, reloadKey, live, onPreview, onDownload, viewportHeight: fixedHeight = 480, fill = false }: Props) {
  const [pages, setPages] = useState<Map<number, TaskRow[]>>(new Map());
  // The height of the rows' box as the page lays it out (only when it fills); the number given is used until it is known.
  const [measured, setMeasured] = useState(0);
  const viewportHeight = fill && measured > 0 ? measured : fixedHeight;
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
      } catch {
        // Said the same way for every cause; the reason a request failed is not for this page to show (D-F1-62).
        if (generation.current === gen) setError('Deliveries could not be loaded');
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

  // "Try again" asks again for the first page and the pages on screen, and clears the message while the answers come.
  const retryLoad = (): void => {
    setError('');
    for (const p of new Set([1, ...pagesRef.current.keys()])) void load(p, generation.current);
  };

  useEffect(() => {
    const box = scroller.current;
    if (!fill || !box || typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(() => setMeasured(box.clientHeight));
    watcher.observe(box);
    setMeasured(box.clientHeight);
    return () => watcher.disconnect();
  }, [fill]);

  // Keyboard focus that moves into a row that is out of view (or under the fade) scrolls that row into the box.
  // Only for keyboard focus: a mouse click on a button in a row must not move the rows under the pointer.
  const byKeyboard = useRef(false);
  const onFocusRow = (event: FocusEvent<HTMLDivElement>): void => {
    if (!byKeyboard.current) return;
    const rowEl = (event.target as HTMLElement).closest<HTMLElement>('[role="row"][aria-rowindex]');
    const box = scroller.current;
    if (!rowEl || !box) return;
    const top = (Number(rowEl.getAttribute('aria-rowindex')) - 2) * ROW_HEIGHT;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + ROW_HEIGHT + FOCUS_PAD > box.scrollTop + viewportHeight) box.scrollTop = top + ROW_HEIGHT + FOCUS_PAD - viewportHeight;
    setScrollTop(box.scrollTop);
  };

  // With text in the filter box only the rows loaded so far that match are listed; without it, all rows, loaded as they scroll in.
  const matching = useMemo(() => {
    if (query.trim() === '') return null;
    return [...pages.keys()]
      .sort((a, b) => a - b)
      .flatMap((p) => pages.get(p) ?? [])
      .filter((t) => matchesFilter(t.fileName, query) || matchesFilter(t.destinationPath, query));
  }, [pages, query]);
  const shownTotal = matching ? matching.length : total;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollTop(0);
  }, [query]);

  // Scrolling to rows that are not loaded yet loads their pages.
  const range = visibleRange({ scrollTop, viewport: viewportHeight, rowHeight: ROW_HEIGHT, total: shownTotal });
  useEffect(() => {
    if (matching) return; // a filtered list is made of rows that are already here
    for (const p of pagesFor(range, TASK_PAGE)) {
      if (!pagesRef.current.has(p)) void load(p, generation.current);
    }
  }, [range.start, range.end, total, load, matching === null]);

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
    rows.push({ index: i, task: matching ? matching[i] : pages.get(Math.floor(i / TASK_PAGE) + 1)?.[i % TASK_PAGE] });
  }

  // More rows below the box: a soft fade at its bottom edge says so.
  const moreBelow = shownTotal * ROW_HEIGHT > scrollTop + viewportHeight + 2;

  return (
    <div className={`ttable ${fill ? 'fill' : ''}`} role="table" aria-label={`Deliveries, ${total}`} aria-rowcount={shownTotal + 1}>
      <div className="trow thead" role="row">
        <div role="columnheader">Deliveries</div>
        <div role="columnheader">Status</div>
        <div role="columnheader">Details</div>
      </div>
      {error && (
        <div role="alert" className="alert tmargin">
          {error} · <button className="link" type="button" onClick={retryLoad}>Try again</button>
        </div>
      )}
      {!firstLoaded && !error && (
        // Under the real header: rows in the same grid, with bars the shape of the file and folder, the status chip,
        // the attempts and the two icon buttons (D-F1-22).
        <div className="tskel" role="status" aria-label="Loading deliveries" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="trow" key={i} aria-hidden="true">
              <div>
                <span className="sk sk-file" />
                <span className="sk sk-path" />
              </div>
              <div>
                <span className="sk sk-chip" />
              </div>
              <div>
                <span className="sk sk-date" />
              </div>
            </div>
          ))}
        </div>
      )}
      {!error && firstLoaded && total === 0 && <div className="state small">{status === 'all' ? 'This distribution has no deliveries.' : 'No deliveries with this status.'}</div>}
      {!error && firstLoaded && total > 0 && matching?.length === 0 && onClearFilter && <NoMatches onClear={onClearFilter} />}
      <div className={`tbody-wrap fadewrap ${fill ? 'fill' : ''} ${moreBelow ? 'more-below' : ''}`}>
        <div
          ref={scroller}
          className={`tscroll ${fill ? 'fill' : ''}`}
          // With `fill` the box takes all the height that is left in the panel (CSS: flex 1, and `min-height: 0` on every parent up to the
          // panel), however many rows there are (D-F1-46); a parent that loses its `min-height: 0` makes it as tall as every row.
          style={fill ? undefined : { height: Math.min(viewportHeight, Math.max(ROW_HEIGHT, shownTotal * ROW_HEIGHT)) }}
          onFocus={onFocusRow}
          onKeyDownCapture={() => (byKeyboard.current = true)}
          onPointerDownCapture={() => (byKeyboard.current = false)}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          tabIndex={0}
          role="region"
          aria-label="Delivery rows, scrolls"
        >
          <div style={{ height: shownTotal * ROW_HEIGHT, position: 'relative' }}>
            {rows.map(({ index, task }) => (
              <div key={task?.taskId ?? `empty-${index}`} className="trow" role="row" aria-rowindex={index + 2} style={{ position: 'absolute', top: index * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}>
                {task ? <TaskCells task={task} onPreview={onPreview} onDownload={onDownload} /> : <div className="skeleton" role="cell" aria-label="Loading" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A failure that is the same however often it is tried: it is never said to have been "after N attempts" (D-F1-60). */
const PERMANENT_FAILURES = new Set(['FILE_NOT_UPLOADED', 'CHECKSUM_MISMATCH', 'UNSUPPORTED_TYPE', 'NOT_AUTHORIZED_AT_DELIVERY', 'DESTINATION_NOT_FOUND', 'FANOUT_FAILED', 'CANCELLED']);

/** A delivery that is waiting or running again after a failed try is "Retrying" (D-F1-60). */
export const isRetrying = (task: Pick<TaskRow, 'attemptCount'>, kind: TaskKind): boolean => (kind === 'pending' || kind === 'in_progress') && task.attemptCount > 1;

/**
 * The attempts, said only where they matter and only in the tooltip (D-F1-60): "Attempt N of 5" while a delivery is trying
 * again, "Failed after N attempts" for a failure that was retried, and nothing for a permanent failure (a file that never
 * uploaded fails the same way every time), a cancelled delivery, or one that went through the first time.
 */
export function attemptNote(task: Pick<TaskRow, 'attemptCount' | 'failureCode'>, kind: TaskKind): string | null {
  const used = Math.min(MAX_ATTEMPTS, task.attemptCount);
  if (kind === 'failed') return used > 1 && !PERMANENT_FAILURES.has(task.failureCode ?? '') ? `Failed after ${plural(used, 'attempt', 'attempts')}` : null;
  return isRetrying(task, kind) ? `Attempt ${used} of ${MAX_ATTEMPTS}` : null;
}

/** What the chip and the info icon of a delivery say: the reason from the one map, then the attempts where they apply. */
export function deliveryTip(task: Pick<TaskRow, 'attemptCount' | 'failureCode'>, kind: TaskKind): string {
  const note = attemptNote(task, kind);
  if (kind === 'failed' || kind === 'cancelled') {
    const reason = failureMeaning(kind === 'cancelled' ? 'CANCELLED' : task.failureCode);
    // The sentence for RETRIES_EXHAUSTED already says "after 5 attempts"; every other retried failure gets the note.
    return note && task.failureCode !== 'RETRIES_EXHAUSTED' ? `${reason} ${note}.` : reason;
  }
  return isRetrying(task, kind) && note ? `Trying again. ${note}.` : TASK_STATUS_MEANING[kind];
}

/** One row's cells. Memoised: a scroll or a push for another row does not draw it again. */
const TaskCells = memo(function TaskCells({ task, onPreview, onDownload }: { task: TaskRow } & Pick<Props, 'onPreview' | 'onDownload'>) {
  const kind = taskKindOf(task);
  const retrying = isRetrying(task, kind);
  const look = retrying ? { label: 'Retrying', tone: 'busy' as const } : taskLook(kind);
  const tip = deliveryTip(task, kind);
  const hasReason = kind === 'failed' || kind === 'cancelled';
  return (
    <>
      <div role="cell" className="tfile-cell">
        <div className="tfile-line">
          {/* The type found in the file's contents when it was uploaded, never one worked out from the name (D-F1-44). */}
          <TypeBadge contentType={task.fileType} />
          <Tooltip text={task.fileName}>
            <span className="ellipsis tfile">{task.fileName}</span>
          </Tooltip>
        </div>
        <Tooltip text={task.destinationPath} block>
          <div className="ellipsis lead dest-text">{task.destinationPath}</div>
        </Tooltip>
      </div>
      <div role="cell" className="tstatus">
        {/* Nothing under the chip (D-F1-60): the reason and the attempts are its tooltip, on hover, on focus and on a click. */}
        <StatusChip tone={look.tone} label={look.label} meaning={tip} focusable={hasReason || retrying} />
      </div>
      {/* The Details column is icons only: Preview and Download on a delivered file, an info icon where nothing arrived. */}
      <div role="cell" className="tdetail">
        {hasReason && (
          <Tooltip text={tip} openOnClick>
            <button className="icon" type="button" aria-label={kind === 'cancelled' ? 'Why this delivery was cancelled' : 'Why this delivery failed'}>
              <InfoIcon />
            </button>
          </Tooltip>
        )}
        {task.status === 'completed' && (task.fileExpired ? (
          <Tooltip text="The uploaded file is more than 33 days old and has been deleted from storage. The delivered copy is still in the folder." openOnClick>
            <button className="icon" type="button" aria-label="Why this file cannot be opened">
              <InfoIcon />
            </button>
          </Tooltip>
        ) : (
          <div className="tbuttons">
            <PreviewButton name={task.fileName} onClick={() => onPreview(task)} />
            <DownloadButton name={task.fileName} onClick={() => onDownload(task)} />
          </div>
        ))}
      </div>
    </>
  );
});
