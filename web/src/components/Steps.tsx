const LABELS = ['Add files', 'Map destinations', 'Review and send'];

/** Which step the user is on: 0 no files yet, 1 files but not every file mapped, 2 ready to review. */
export function currentStep(hasFiles: boolean, allMapped: boolean): number {
  if (!hasFiles) return 0;
  return allMapped ? 2 : 1;
}

export function Steps({ current }: { current: number }) {
  return (
    <ol className="steps" aria-label="Steps">
      {LABELS.map((label, i) => {
        const done = i < current;
        return (
          <li key={label} className={`${i === current ? 'cur' : ''} ${done ? 'done' : ''}`} aria-current={i === current ? 'step' : undefined}>
            <span className="num">{done ? '✓' : i + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
