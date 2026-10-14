import { teamColour } from '../destinations/colour.js';
import { formatSize, typeLabel } from '../distribute/files.js';
import { describeDestination, isUsable, type Mapping } from '../distribute/mapping.js';
import type { PageFile } from '../upload/manager.js';

interface Props {
  files: readonly PageFile[];
  mapping: Mapping;
  onPreview: (id: string) => void;
  onRemoveFolder: (key: string) => void;
  onRemoveFromFolder: (fileId: string, key: string) => void;
}

/** Every folder and the files going to it. Preview a file, or remove it from that folder with the cross. */
export function Review({ files, mapping, onPreview, onRemoveFolder, onRemoveFromFolder }: Props) {
  const usable = files.filter(isUsable);
  const folders = Object.entries(mapping.destinations)
    .map(([key, destination]) => ({ key, destination, files: usable.filter((f) => mapping.files[f.id]?.includes(key)) }))
    .filter((f) => f.files.length > 0);
  const deliveries = folders.reduce((n, f) => n + f.files.length, 0);

  return (
    <section aria-label="Review" className="card review">
      <div className="review-head">
        <div className="review-title">
          <h2>Review</h2>
          <span className="lead">Every folder and the files going to it. Preview a file, or remove it with the cross.</span>
        </div>
        <div className="count-text">
          {folders.length} {folders.length === 1 ? 'destination' : 'destinations'}, {deliveries} {deliveries === 1 ? 'delivery' : 'deliveries'}
        </div>
      </div>
      {folders.length === 0 ? (
        <div className="empty-line">Tick folders in Destinations. Each folder you choose appears here with the files going to it.</div>
      ) : (
        <div className="review-grid">
          {folders.map(({ key, destination, files: inside }) => {
            const { team, name } = describeDestination(destination.path);
            return (
              <div className="review-card" key={key}>
                <div className="review-card-head">
                  <span className="teamsq" style={{ background: teamColour(team) }} title={team}>
                    {team.charAt(0).toUpperCase()}
                  </span>
                  <div className="grow" title={destination.path}>
                    <div className="rc-name">{name}</div>
                    <div className="rc-path">{destination.path}</div>
                  </div>
                  <span className="count-pill">{inside.length === 1 ? '1 file' : `${inside.length} files`}</span>
                  <button className="icon small" type="button" aria-label={`Remove ${destination.path}`} title="Remove this folder" onClick={() => onRemoveFolder(key)}>
                    ✕
                  </button>
                </div>
                {inside.map((f) => (
                  <div className="review-file" key={f.id}>
                    <span className="typetile">{typeLabel(f.contentType)}</span>
                    <span className="grow ellipsis" title={f.name}>
                      {f.name}
                    </span>
                    <span className="size">{formatSize(f.sizeBytes)}</span>
                    <button className="icon small" type="button" aria-label={`Preview ${f.name} in ${name}`} title="Preview" onClick={() => onPreview(f.id)}>
                      👁
                    </button>
                    <button
                      className="icon small"
                      type="button"
                      aria-label={`Remove ${f.name} from ${name}`}
                      title="Remove from this folder"
                      onClick={() => onRemoveFromFolder(f.id, key)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
