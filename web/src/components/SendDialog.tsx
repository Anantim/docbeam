import { plural } from '../text.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface Props {
  files: number;
  folders: number;
  deliveries: number;
  teams: number;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
}

const n = plural;

/** The question before a distribution goes out (D-F1-8). It lists no files and no folders: the page already shows them. */
export function SendDialog({ files, folders, deliveries, teams, busy, onSend, onCancel }: Props) {
  return (
    <ConfirmDialog
      title={`Send ${n(files, 'file', 'files')} to ${n(folders, 'folder', 'folders')}?`}
      confirmLabel="Send"
      cancelLabel="Cancel"
      tone="primary"
      busy={busy}
      onConfirm={onSend}
      onCancel={onCancel}
    >
      <p>
        {n(deliveries, 'delivery', 'deliveries')} to {n(teams, 'team', 'teams')}.
      </p>
      <p>Delivered files can't be recalled.</p>
    </ConfirmDialog>
  );
}
