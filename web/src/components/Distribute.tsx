import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { destinationKey, type Destination } from '../destinations/selection.js';
import { keepSelected, pickRow, type Pick } from '../distribute/rows.js';
import { plural } from '../text.js';
import { acceptFiles, formatSize, type Rejected } from '../distribute/files.js';
import {
  applyHeld,
  buildJobRequest,
  emptyMapping,
  isUsable,
  readiness,
  removeFile,
  scopeOf,
  summarise,
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
import { SendBar } from './SendBar.js';
import { SendDialog } from './SendDialog.js';
import type { Toast } from './Toasts.js';
import { useLeaveWarning } from './useLeaveWarning.js';

interface Props {
  onTeams: (names: string[]) => void;
  notify: (text: string, kind?: Toast['kind']) => void;
  /** Called after a distribution is sent, with its id, so the app can open it on the Status page. */
  onSent?: (jobId: string) => void;
  manager?: UploadManager;
  submission?: Submission;
}

/** The Distribute screen (D-F1-8): files on the left, destinations on the right, one bar to send (flow 2). */
export function Distribute({ onTeams, notify, onSent, manager = uploadManager, submission }: Props) {
  const files = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [pick, setPick] = useState<Pick>({ selected: new Set(), anchor: null });
  const selected = pick.selected;
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const submit = useMemo(() => submission ?? new Submission(submitJob), [submission]);

  // Files on the page have not been sent (Send clears the page), and a reload loses the prepared batch.
  useLeaveWarning(files.length > 0);

  const usable = files.filter(isUsable);
  const scope = scopeOf([...files], selected);
  const scopeIds = new Set(scope);
  const selectedUsable = usable.filter((f) => selected.has(f.id));
  const state = readiness(mapping, [...files]);
  const summary = summarise(mapping, [...files]);

  const scopeTitle =
    selectedUsable.length > 0
      ? selectedUsable.length === 1
        ? '1 selected file'
        : `${selectedUsable.length} selected files`
      : usable.length > 0
        ? `all ${usable.length} ${usable.length === 1 ? 'file' : 'files'}`
        : 'all files';

  const pickFiles = useCallback(
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

  // Folders ticked for all files go to the files added while they stay ticked (D-F1-5).
  useEffect(() => {
    setMapping((m) => applyHeld(m, [...files]));
  }, [files]);

  // A file that left the page leaves the selection.
  useEffect(() => {
    setPick((p) => {
      const kept = keepSelected(p.selected, files.map((f) => f.id));
      return kept.size === p.selected.size ? p : { selected: kept, anchor: p.anchor };
    });
  }, [files]);

  const onToggleDestination = useCallback(
    (destination: Destination) => {
      setMapping((m) => toggleDestination(m, [...files], selected, destination));
      setSendError(null);
    },
    [files, selected],
  );

  const onRemoveFile = (id: string) => {
    manager.remove(id);
    setMapping((m) => removeFile(m, id));
  };

  const clearAll = () => {
    manager.clear();
    setMapping(emptyMapping);
    setPick({ selected: new Set(), anchor: null });
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
    setAsking(false);
    if (out.ok) {
      notify('Sent');
      clearAll();
      onSent?.(out.jobId);
    } else {
      setSendError(out.message);
    }
  };

  const previewing = previewId ? files.find((f) => f.id === previewId) : undefined;
  const order = files.map((f) => f.id);

  return (
    <>
      <div className="page">
        <div className="page-head">
          <h1>New distribution</h1>
        </div>

        <div className="workspace">
          <AddFiles
            empty={files.length === 0}
            onPick={pickFiles}
            rejected={rejected}
            onDismiss={() => setRejected([])}
          >
            <FileTable
              files={files}
              mapping={mapping}
              selected={selected}
              onPick={(id, mods) => setPick((p) => pickRow(p, order, id, mods))}
              onToggleAll={() => setPick((p) => ({ selected: selectedUsable.length === usable.length ? new Set() : new Set(usable.map((f) => f.id)), anchor: p.anchor }))}
              onPreview={setPreviewId}
              onRetry={(id) => manager.retry(id)}
              onRemove={onRemoveFile}
            />
          </AddFiles>

          <Destinations
            onToggle={onToggleDestination}
            onTeams={onTeams}
            scopeTitle={scopeTitle}
            hint={selectedUsable.length > 0 ? `for ${plural(selectedUsable.length, 'selected file', 'selected files')}` : undefined}
            stateOf={(d) => tickState(mapping, [...scopeIds], destinationKey(d))}
            filesOf={(d) => {
              // The files in scope (the selected ones, or all) that go to this folder.
              const key = destinationKey(d);
              const inScope = files.filter((f) => isUsable(f) && scopeIds.has(f.id));
              return { names: inScope.filter((f) => (mapping.files[f.id] ?? []).includes(key)).map((f) => f.name), total: inScope.length };
            }}
          />
        </div>
      </div>

      <SendBar
        ready={state.ready}
        reason={files.length === 0 ? null : state.reason}
        sending={sending}
        error={sendError}
        canClear={files.length > 0 || mapping.held.length > 0 || rejected.length > 0}
        onClear={clearAll}
        onSend={() => setAsking(true)}
      />

      {asking && (
        <SendDialog
          files={summary.files}
          folders={summary.folders}
          busy={sending}
          onSend={() => void send()}
          onCancel={() => setAsking(false)}
        />
      )}

      {previewing && (
        <Preview
          name={previewing.name}
          contentType={previewing.contentType}
          sizeBytes={previewing.sizeBytes}
          blob={previewing.file}
          meta={formatSize(previewing.sizeBytes)}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}
