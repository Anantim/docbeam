import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { liveClient } from '../live/instance.js';
import type { LiveClient } from '../live/socket.js';
import { PANEL_OUT_MS, prefersReducedMotion } from '../motion.js';
import { trackingApi, type Counts, type JobSummary } from '../tracking/api.js';
import { applicableFilters, isUnfiltered, needsChoices, sameFilters, withoutUnjudged, type Filters } from '../tracking/filters.js';
import { useFilterChoices } from '../tracking/useFilterChoices.js';
import { usePagedJobs } from '../tracking/usePagedJobs.js';
import { DistributionList } from './DistributionList.js';
import { DistributionPanel } from './DistributionPanel.js';
import { FilterBar } from './FilterBar.js';
import { OpenById } from './OpenById.js';

type Jobs = ReturnType<typeof usePagedJobs>;

/** How many more pages of 20 Open by ID reads to find a row before it shows the row on its own (D-F1-74). */
const REVEAL_PAGES = 5;

interface Props {
  /** The signed-in person's id. */
  meId: string;
  jobId: string | null;
  /** The filters of the list, from the address. */
  filters: Filters;
  /** Sets the filters (and so the address). */
  onFilters: (filters: Filters) => void;
  /** Puts filters that apply to this person in the address in place of the ones that do not: the address is replaced, with no new history entry (D-F1-81). */
  onSanitise?: (filters: Filters) => void;
  /** Opens a distribution in the panel, or closes the panel with null. */
  onOpen: (jobId: string | null) => void;
  /** Everything I can see, unfiltered, loaded by the app (it also feeds the badge on the Status tab). */
  all: Jobs;
  /** Told the live counts of the open distribution, so the badge on the tab follows them. */
  onLive?: (jobId: string, counts: Counts) => void;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  live?: LiveClient;
  /** Counts the sign-ins made from the 12-hour dialog. When it changes, the lists and the open distribution read again. */
  signedInAgain?: number;
  /** The distribution that was just sent: its panel takes the focus when it opens (D-F1-31). */
  focusJobId?: string | null;
}

/**
 * Status: every distribution the person can see, newest first (D-F1-7, D-F1-15, D-F1-21), with one row of filters above.
 * When one is open its panel takes about 60 % of the width and the list narrows to a compact column (id, sender, status,
 * when). Esc or Close brings the full list back. The address keeps the open distribution and the filters. The web app
 * shows job history only: no audit trail (D-F1-13).
 */
export function StatusPage({ meId, jobId, filters: addressFilters, onFilters, onSanitise = onFilters, onOpen, all, onLive, notify, live = liveClient, signedInAgain = 0, focusJobId = null }: Props) {
  const [liveCounts, setLiveCounts] = useState<{ jobId: string; counts: Counts } | null>(null);
  const choices = useFilterChoices(true, signedInAgain);
  // The filters of the address that apply to this person (D-F1-81): a team they are not in, or a sender who is not them or in their
  // teams, is dropped, and the list shows as if the link did not have it. A team or sender is judged only when the person's teams and
  // colleagues are in, so a slow read never drops a valid one; until then the list waits. If those reads fail the address is kept as it is.
  const waiting = needsChoices(addressFilters, meId) && !choices.settled;
  const filters = useMemo(() => {
    if (waiting) return withoutUnjudged(addressFilters, meId);
    const cannotJudge = needsChoices(addressFilters, meId) && !choices.ok;
    const me = addressFilters.sender === 'me' ? { ...addressFilters, sender: meId } : addressFilters;
    return cannotJudge ? me : applicableFilters(addressFilters, { meId, memberIds: choices.members.map((m) => m.userId), teamIds: choices.teams.map((t) => t.id) });
  }, [addressFilters, waiting, choices.ok, choices.members, choices.teams, meId]);
  // Dropped filters leave the address too, replacing it, so the back button does not return to them.
  useEffect(() => {
    if (!waiting && !sameFilters(filters, addressFilters)) onSanitise(filters);
  }, [waiting, filters, addressFilters, onSanitise]);
  // The app already loads the unfiltered list (it feeds the badge on the tab): use it while nothing is filtered.
  const unfiltered = isUnfiltered(filters) && !waiting;
  const other = usePagedJobs(filters, !unfiltered && !waiting, undefined, signedInAgain);
  const list = unfiltered ? all : other;

  // Opening Status reads the list again: the app's list is polled only while something runs, so a distribution that
  // someone sent to my team since it was last read is shown now and not at the next poll (D-F1-25).
  const refreshAll = useRef(all.refresh);
  refreshAll.current = all.refresh;
  useEffect(() => {
    void refreshAll.current();
  }, []);

  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const followCounts = useCallback((id: string, counts: Counts) => {
    setLiveCounts({ jobId: id, counts });
    onLiveRef.current?.(id, counts);
  }, []);

  // When the open distribution finishes, its row and the badge on the tab are read again at once, not at the next
  // refresh 30 seconds later (D-F1-15).
  const finished = liveCounts !== null && liveCounts.counts.pending + liveCounts.counts.in_progress === 0;
  const refreshRef = useRef({ all: all.refresh, other: other.refresh, unfiltered });
  refreshRef.current = { all: all.refresh, other: other.refresh, unfiltered };
  useEffect(() => {
    if (!finished) return;
    void refreshRef.current.all();
    if (!refreshRef.current.unfiltered) void refreshRef.current.other();
  }, [finished, liveCounts?.jobId]);

  // Stable, so the rows of the list (memoised) are not drawn again whenever this page is.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const open = useCallback((id: string): void => {
    setLiveCounts(null); // counts followed from an earlier look at a distribution are not this one's
    onOpenRef.current(id);
  }, []);

  // The panel slides in from the right when it opens and out again when it closes (D-F1-47). While it leaves it stays mounted for
  // 200 ms, as the same element, so it does not load again, and the list widens when it has gone. Input is never held back: a
  // click or a key works at once, whatever is moving.
  const [entering, setEntering] = useState(false);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [, setClosed] = useState(0);
  const lastJob = useRef<string | null>(jobId);
  useLayoutEffect(() => {
    const before = lastJob.current;
    lastJob.current = jobId;
    if (jobId !== null && before === null) {
      setLeavingId(null);
      if (prefersReducedMotion()) return;
      setEntering(true);
      const t = setTimeout(() => setEntering(false), PANEL_OUT_MS + 50);
      return () => clearTimeout(t);
    }
    if (jobId === null && before !== null) {
      if (prefersReducedMotion()) {
        setClosed((n) => n + 1); // draw again without the panel, at once
        return;
      }
      setLeavingId(before);
      const t = setTimeout(() => setLeavingId(null), PANEL_OUT_MS);
      return () => clearTimeout(t);
    }
  }, [jobId]);
  // On the render where the distribution closes, `lastJob` still holds it (the layout effect above moves it on), so the panel is
  // not unmounted and mounted again to slide out: it is the same element throughout.
  const panelId = jobId ?? leavingId ?? lastJob.current;

  // Open by ID on the distribution that is already open changes nothing in the address, so it is shown instead: its row is
  // brought into view in the list and highlighted for a second, with the same fade as a just-sent row (D-F1-51). The card
  // closes itself.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const jobIdNow = useRef(jobId);
  jobIdNow.current = jobId;
  // Opening by ID, or by a link, shows the row in the list whether or not that distribution was already open (D-F1-74): the list
  // reads up to REVEAL_PAGES more pages until the row is in it; when it is not (too far down, or left out by a filter) the row
  // is shown on its own at the top of the list, as a pinned row. Either way the row is brought into view and highlighted for a second.
  const loadUntil = list.loadUntil;
  const loadUntilRef = useRef(loadUntil);
  loadUntilRef.current = loadUntil;
  const [pinned, setPinned] = useState<JobSummary | null>(null);
  // The distribution a reveal was started for (by Open by ID, or below by the address), so a row click does not start one.
  const revealed = useRef<string | null>(null);
  const reveal = useCallback(async (id: string): Promise<void> => {
    const inList = await loadUntilRef.current(id, REVEAL_PAGES);
    let pin: JobSummary | null = null;
    if (!inList) {
      try {
        pin = (await trackingApi.byIdPrefix(id.slice(0, 8))).find((j) => j.jobId === id) ?? null;
      } catch {
        pin = null; // the panel says what is wrong; the list just has no pinned row
      }
    }
    if (revealed.current !== id) return; // another one was opened meanwhile
    setPinned(pin);
    clearTimeout(flashTimer.current);
    setFlashId(null); // off and on again, so a second look restarts the highlight
    requestAnimationFrame(() => {
      setFlashId(id);
      flashTimer.current = setTimeout(() => setFlashId(null), 1000);
    });
  }, []);
  const openById = useCallback(
    (id: string): void => {
      revealed.current = id;
      if (id !== jobIdNow.current) open(id);
      void reveal(id);
    },
    [open, reveal],
  );
  const openFromRow = useCallback(
    (id: string): void => {
      revealed.current = id;
      setPinned(null);
      open(id);
    },
    [open],
  );
  // A distribution that the address opens (a copied link, or a reload) is revealed once the first page of the list is in.
  const listReady = list.jobs !== null;
  useEffect(() => {
    if (jobId === null) {
      revealed.current = null;
      setPinned(null);
    } else if (listReady && revealed.current !== jobId) {
      revealed.current = jobId;
      void reveal(jobId);
    }
  }, [jobId, listReady, reveal]);

  return (
    // From 1024 px up the page itself does not scroll (D-F1-29); the list and the panel scroll in their own areas.
    <div className="page page-fixed">
      <div className="page-head">
        <h1>Distributions</h1>
        <OpenById onOpen={openById} meId={meId} />
      </div>
      <FilterBar filters={filters} onChange={onFilters} meId={meId} members={choices.members} teams={choices.teams} />

      <div className={`status-layout ${panelId ? 'open' : ''}`}>
        <DistributionList
          meId={meId}
          filtered={!unfiltered}
          onClearFilters={() => onFilters({})}
          jobs={list.jobs}
          error={list.error}
          hasMore={list.hasMore}
          loadingMore={list.loadingMore}
          moreFailed={list.moreFailed}
          onMore={() => void list.loadMore()}
          onRetry={() => void list.refresh()}
          selectedId={jobId}
          onOpen={openFromRow}
          pinned={pinned && pinned.jobId === jobId && !(list.jobs ?? []).some((j) => j.jobId === pinned.jobId) ? pinned : null}
          notify={notify}
          live={jobId ? liveCounts : null}
          freshId={focusJobId ?? null}
          flashId={flashId}
        />
        {panelId && (
          <div className={`panel-slot ${entering ? 'entering' : ''} ${jobId === null ? 'leaving' : ''}`}>
            <DistributionPanel
              key={panelId}
              jobId={panelId}
              live={live}
              notify={notify}
              onClose={() => {
                onOpen(null);
                // Focus goes back to the row that opened the panel, not to the page.
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-job-id="${panelId}"]`)?.focus());
              }}
              onCounts={followCounts}
              signedInAgain={signedInAgain}
              focusHeading={focusJobId === panelId}
              onChanged={() => {
                void all.refresh();
                if (!unfiltered) void other.refresh();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
