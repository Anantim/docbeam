import { formatSize } from '../distribute/files.js';
import { describeDestination, isUsable, type Mapping } from '../distribute/mapping.js';
import type { PageFile } from '../upload/manager.js';
import { PreviewButton } from './FileActions.js';
import { ChevronIcon, CloseIcon } from './Icons.js';
import { TypeBadge } from './TypeBadge.js';

interface Props {
  files: readonly PageFile[];
  mapping: Mapping;
  onPreview: (id: string) => void;
  onRemoveFolder: (key: string) => void;
  onRemoveFromFolder: (fileId: string, key: string) => void;
}

/** Every folder with its files, one row each. A row opens to show the files going there (details on demand). */
export function Review({ files, mapping, onPreview, onRemoveFolder, onRemoveFromFolder }: Props) {
  const usable = files.filter(isUsable);
  const folders = Object.entries(mapping.destinations)
    .map(([key, destination]) => ({ key, destination, files: usable.filter((f) => mapping.files[f.id]?.includes(key)) }))
    .filter((f) => f.files.length > 0);
  if (folders.length === 0) return null;

  return (
    <section aria-label="Review" className="card review">
      <div className="card-head">
        <h2>Review</h2>
      </div>
      <div className="review-list">
        {folders.map(({ key, destination, files: inside }) => {
          const { name } = describeDestination(destination.path);
          return (
            <details className="review-item" key={key}>
              <summary>
                <span className="chev" aria-hidden="true">
                  <ChevronIcon open={false} size={14} />
                </span>
                <span className="grow" title={destination.path}>
                  <span className="rc-name">{name}</span> <span className="rc-path">{destination.path}</span>
                </span>
                <span className="size">{inside.length === 1 ? '1 file' : `${inside.length} files`}</span>
                <button
                  className="icon small"
                  type="button"
                  aria-label={`Remove ${destination.path}`}
                  title={`Remove ${destination.path}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onRemoveFolder(key);
                  }}
                >
                  <CloseIcon />
                </button>
              </summary>
              {inside.map((f) => (
                <div className="review-file" key={f.id}>
                  <TypeBadge contentType={f.contentType} />
                  <span className="grow ellipsis" title={f.name}>
                    {f.name}
                  </span>
                  <span className="size">{formatSize(f.sizeBytes)}</span>
                  <PreviewButton name={`${f.name} in ${name}`} small onClick={() => onPreview(f.id)} />
                  <button
                    className="icon small"
                    type="button"
                    aria-label={`Remove ${f.name} from ${name}`}
                    title={`Remove ${f.name} from ${name}`}
                    onClick={() => onRemoveFromFolder(f.id, key)}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </details>
          );
        })}
      </div>
    </section>
  );
}
