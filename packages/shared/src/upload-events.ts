export interface UploadedObject {
  bucket: string;
  key: string;
  fileId: string;
}

const KEY = /^staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

interface S3EventBody {
  Event?: string;
  Records?: { eventName?: string; s3?: { bucket?: { name?: string }; object?: { key?: string } } }[];
}

/**
 * The objects named by one queue message. S3 sends a test event when the notification is set up, and the
 * bucket may in future hold other prefixes: anything that is not `staging/{owner}/{fileId}` is left out.
 */
export function parseUploadEvents(body: string): UploadedObject[] {
  let parsed: S3EventBody;
  try {
    parsed = JSON.parse(body) as S3EventBody;
  } catch {
    return [];
  }
  const found: UploadedObject[] = [];
  for (const r of parsed.Records ?? []) {
    const bucket = r.s3?.bucket?.name;
    const raw = r.s3?.object?.key;
    if (!bucket || !raw || !r.eventName?.startsWith('ObjectCreated:')) continue;
    // S3 puts the key in the event URL-encoded, with spaces as plus signs.
    const key = decodeURIComponent(raw.replaceAll('+', ' '));
    const match = KEY.exec(key);
    if (match?.[1]) found.push({ bucket, key, fileId: match[1].toLowerCase() });
  }
  return found;
}
