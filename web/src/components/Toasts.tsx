export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <i />
          {t.text}
        </div>
      ))}
    </div>
  );
}
