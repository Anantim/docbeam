import { useCallback, useState, type FormEvent } from 'react';
import { liveClient } from '../live/instance.js';
import type { LiveClient } from '../live/socket.js';
import type { Counts, JobSummary } from '../tracking/api.js';
import { extractJobId } from '../tracking/route.js';
import { usePolledJobs } from '../tracking/usePolledJobs.js';
import { JobDetailView } from './JobDetailView.js';
import { JobList } from './JobList.js';

interface Props {
  jobId: string | null;
  onOpen: (jobId: string | null) => void;
  /** My distributions, polled by the app (it also feeds the badge on the Status tab). */
  mine: { jobs: JobSummary[] | null; error: string; refresh: () => Promise<void> };
  notify: (text: string, kind?: 'ok' | 'error') => void;
  live?: LiveClient;
  /** Counts the sign-ins made from the 12-hour dialog. When it changes, the lists and the open distribution read again. */
  signedInAgain?: number;
}

/** Status: the Distributions list on the left (Mine, My teams) and the open distribution on the right. */
export function StatusPage({ jobId, onOpen, mine, notify, live = liveClient, signedInAgain = 0 }: Props) {
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState('');
  const [liveCounts, setLiveCounts] = useState<{ jobId: string; counts: Counts } | null>(null);
  const followCounts = useCallback((id: string, counts: Counts) => setLiveCounts({ jobId: id, counts }), []);
  const team = usePolledJobs('team', scope === 'team', undefined, signedInAgain);
  const list = scope === 'mine' ? mine : team;

  // Any new attempt to open something starts with a clean note.
  const open = (id: string): void => {
    setTypedError('');
    onOpen(id);
  };

  const openTyped = (event: FormEvent): void => {
    event.preventDefault();
    setTypedError('');
    if (typed.trim() === '') return;
    const id = extractJobId(typed);
    if (!id) {
      setTypedError('Paste the full distribution id or a link to it. The short 8-character id is not enough.');
      return;
    }
    setTyped('');
    open(id);
  };

  const empty = typed.trim() === '';

  return (
    <div className="status-page">
      <aside className="status-side">
        <h1>Distributions</h1>
        <JobList scope={scope} onScope={setScope} jobs={list.jobs} error={list.error} selectedId={jobId} onOpen={open} live={jobId ? liveCounts : null}>
          <form className="openid" onSubmit={openTyped}>
            <label className="sr" htmlFor="job-id">
              Open by ID
            </label>
            <input
              id="job-id"
              className="field mono"
              value={typed}
              placeholder="Paste a distribution id or link"
              onChange={(e) => {
                setTyped(e.target.value);
                setTypedError('');
              }}
            />
            <button className="btn2" type="submit" disabled={empty} title={empty ? 'Paste a distribution id or link first' : undefined}>
              Open
            </button>
          </form>
          {typedError && (
            <div role="alert" className="alert">
              {typedError}
            </div>
          )}
        </JobList>
      </aside>
      <section className="status-main">
        {jobId ? (
          <JobDetailView
            key={jobId}
            jobId={jobId}
            live={live}
            notify={notify}
            onCounts={followCounts}
            signedInAgain={signedInAgain}
            onChanged={() => {
              void mine.refresh();
              if (scope === 'team') void team.refresh();
            }}
          />
        ) : (
          <div className="card jempty big">Pick a distribution, or paste an id to open one.</div>
        )}
      </section>
    </div>
  );
}
