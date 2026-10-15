import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { Claims } from '../auth/token.js';
import { destinationKey, type Destination } from '../destinations/selection.js';
import { acceptFiles, formatSize, type Rejected } from '../distribute/files.js';
import {
  buildJobRequest,
  deliveryCount,
  destinationCounts,
  emptyMapping,
  isUsable,
  readiness,
  removeDestination,
  removeFile,
  removeFromDestination,
  scopeOf,
  tickState,
  toggleDestination,
  type Mapping,
} from '../distribute/mapping.js';
import { Submission } from '../distribute/submit.js';
import { submitJob } from '../upload/api.js';
import { uploadManager } from '../upload/instance.js';
import type { UploadManager } from '../upload/manager.js';
import { AddFiles } from './AddFiles.js';
import { Destinations } from './Destinations.js';
import { FileTable } from './FileTable.js';
import { Preview } from './Preview.js';
import { Review } from './Review.js';
import { SendBar } from './SendBar.js';
import { Shell } from './Shell.js';
import { currentStep, Steps } from './Steps.js';
import type { Toast } from './Toasts.js';
import { useLeaveWarning } from './useLeaveWarning.js';

interface Props {
  claims: Claims;
  teams: string[];
  onTeams: (names: string[]) => void;
  notify: (text: string, kind?: Toast['kind']) => void;
  manager?: UploadManager;
  submission?: Submission;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The Distribute screen of the mockup: add files, tick folders, review, send (Step 2.6, flow 2). */
export function Distribute({ claims, teams, onTeams, notify, manager = uploadManager, submission }: Props) {
  const files = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const submit = useMemo(() => submission ?? new Submission(submitJob), [submission]);

  useLeaveWarning(files.some((f) => f.status === 'hashing' || f.status === 'waiting' || f.status === 'uploading'));

  const usable = files.filter(isUsable);
  const scope = scopeOf([...files], selected);
  const scopeIds = new Set(scope);
  const selectedUsable = usable.filter((f) => selected.has(f.id));
  const counts = destinationCounts(mapping, [...files]);
  const inUse = [...counts.keys()].flatMap((k) => (mapping.destinations[k] ? [mapping.destinations[k]] : []));
  const deliveries = deliveryCount(mapping, [...files]);
  const state = readiness(mapping, [...files]);
  const allMapped = usable.length > 0 && usable.every((f) => (mapping.files[f.id]?.length ?? 0) > 0);
  const totalBytes = usable.reduce((n, f) => n + f.sizeBytes, 0);

  const scopeTitle =
    selectedUsable.length > 0
      ? selectedUsable.length === 1
        ? 'the 1 selected file'
        : `the ${selectedUsable.length} selected files`
      : usable.length > 0
        ? `all ${usable.length} ${usable.length === 1 ? 'file' : 'files'}`
        : 'your files';

  const pick = useCallback(
    (picked: File[]) => {
      if (picked.length === 0) return;
      const { accepted, rejected: refused } = acceptFiles(manager.getSnapshot().length, picked);
      if (refused.length > 0) setRejected((r) => [...r, ...refused]);
      if (accepted.length > 0) {
        manager.add(accepted);
        setSendError(null);
      }
    },
    [manager],
  );

  const onToggleDestination = useCallback(
    (destination: Destination) => {
      const out = toggleDestination(mapping, [...files], selected, destination);
      if (out.refused) notify(out.refused, 'error');
      else {
        setMapping(out.mapping);
        setSendError(null);
      }
    },
    [files, mapping, notify, selected],
  );

  const onRemoveFile = (id: string) => {
    manager.remove(id);
    setMapping((m) => removeFile(m, id));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  };

  const onRemoveFromFolder = (fileId: string, key: string) => {
    const file = files.find((f) => f.id === fileId);
    const folder = mapping.destinations[key];
    const out = removeFromDestination(mapping, fileId, key);
    setMapping(out.mapping);
    const where = folder ? folder.path.split(' / ').at(-1) : 'that folder';
    if (out.dropped && file) {
      notify(`${file.name} had no other destination, so it was removed from this distribution.`);
      onRemoveFile(fileId);
    } else if (file) notify(`${file.name} will not go to ${where}.`);
  };

  const clearAll = () => {
    manager.clear();
    setMapping(emptyMapping);
    setSelected(new Set());
    setRejected([]);
    setSendError(null);
  };

  const send = async () => {
    const body = buildJobRequest(mapping, [...files]);
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    const out = await submit.submit(body, (binderId, folderId) => {
      const found = Object.values(mapping.destinations).find((d) => d.binderId === binderId && (d.folderId ?? null) === folderId);
      return found?.path ?? 'a destination';
    });
    setSending(false);
    if (out.ok) {
      notify(`Distribution ${out.jobId.slice(0, 8)} sent. ${plural(out.taskCount, 'delivery', 'deliveries')} queued.`);
      clearAll();
    } else {
      setSendError(out.message);
    }
  };

  const previewing = previewId ? files.find((f) => f.id === previewId) : undefined;

  return (
    <Shell claims={claims} teams={teams}>
      <div className="page">
        <div className="page-head">
          <div>
            <h1>New distribution</h1>
            <div className="lead">Upload each file once, then send it to every folder that needs it.</div>
          </div>
          <Steps current={currentStep(usable.length > 0, allMapped)} />
        </div>

        <div className="cols">
          <section className="left" aria-label="Add files">
            <AddFiles
              onPick={pick}
              rejected={rejected}
              onDismiss={(name) => setRejected((r) => (name === undefined ? [] : r.filter((x) => x.name !== name)))}
            />
            <div className="card summary" aria-label="This distribution">
              <h2>This distribution</h2>
              <div className="stats">
                <div>
                  <div className="big">{usable.length}</div>
                  <div className="lead">files</div>
                </div>
                <div>
                  <div className="big">{counts.size}</div>
                  <div className="lead">destinations</div>
                </div>
                <div>
                  <div className="big blue">{deliveries}</div>
                  <div className="lead">deliveries</div>
                </div>
                <div>
                  <div className="big">{formatSize(totalBytes)}</div>
                  <div className="lead">uploaded once</div>
                </div>
              </div>
              <div className="note">Each file is stored once, however many folders it goes to. Each folder it reaches is one delivery.</div>
            </div>
          </section>

          <section className="card documents" aria-label="Documents">
            <div className="doc-head">
              <div className="doc-title">
                <h2>Documents</h2>
                <span className="count-pill">{files.length} of 100 files</span>
              </div>
              <div className="lead">
                {selectedUsable.length > 0
                  ? `${selectedUsable.length} selected. Destinations you tick apply to these only.`
                  : 'or select files below to map them separately'}
              </div>
            </div>
            {files.length === 0 ? (
              <div className="empty-state">
                <strong>No documents yet</strong>
                <span>Add files on the left. They upload in the background while you choose destinations.</span>
              </div>
            ) : (
              <FileTable
                files={files}
                mapping={mapping}
                selected={selected}
                onToggleSelected={(id) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (!next.delete(id)) next.add(id);
                    return next;
                  })
                }
                onToggleAll={() => setSelected(selectedUsable.length === usable.length ? new Set() : new Set(usable.map((f) => f.id)))}
                onOnly={(id) => setSelected(new Set([id]))}
                onPreview={setPreviewId}
                onRetry={(id) => manager.retry(id)}
                onRemove={onRemoveFile}
              />
            )}
          </section>

          <Destinations
            selected={inUse}
            onToggle={onToggleDestination}
            onTeams={onTeams}
            scopeTitle={scopeTitle}
            disabled={usable.length === 0}
            onUseAll={selectedUsable.length > 0 ? () => setSelected(new Set()) : undefined}
            stateOf={(d) => tickState(mapping, [...scopeIds], destinationKey(d))}
            countOf={(d) => counts.get(destinationKey(d)) ?? 0}
          />
        </div>

        <Review
          files={files}
          mapping={mapping}
          onPreview={setPreviewId}
          onRemoveFolder={(key) => setMapping((m) => removeDestination(m, key))}
          onRemoveFromFolder={onRemoveFromFolder}
        />
      </div>

      <SendBar
        checks={state.checks}
        deliveries={deliveries}
        ready={state.ready}
        sending={sending}
        error={sendError}
        canClear={files.length > 0}
        onClear={clearAll}
        onSend={() => void send()}
      />

      {previewing && (
        <Preview
          name={previewing.name}
          contentType={previewing.contentType}
          sizeBytes={previewing.sizeBytes}
          blob={previewing.file}
          meta={`${formatSize(previewing.sizeBytes)}, not sent yet`}
          note="Shown from the copy in your browser. Nothing has been sent yet."
          onClose={() => setPreviewId(null)}
        />
      )}
    </Shell>
  );
}
