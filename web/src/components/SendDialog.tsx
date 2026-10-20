import { plural } from '../text.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface Props {
  files: number;
  folders: number;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
}

const n = plural;

/**
 * The question before a distribution goes out (D-F1-8, D-F1-23): the title says how many files go to how many folders,
 * one line says they cannot be recalled, then Cancel (where the focus starts) and Send. It lists no files and no
 * folders (the page shows them) and no count of deliveries or teams.
 */
export function SendDialog({ files, folders, busy, onSend, onCancel }: Props) {
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
      <p>Delivered files can't be recalled.</p>
    </ConfirmDialog>
  );
}
