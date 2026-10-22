// The key a file is stored under (D-F1-81): staging/{owner}/{fileId}/{safe name}. The last part is the file's own name, so a
// browser that shows a PDF with no title of its own (Chrome's viewer names the tab after the last part of the link) shows the name.
// The file id stays in the key, so nothing that finds a file by its id changes. Older objects are staging/{owner}/{fileId}
// and keep their keys: every reader takes the key from the database row, never builds it.

/** The most characters of the name kept in a key. */
const NAME_MAX = 100;

/**
 * The name made safe for a key: only letters, digits, space, dot, dash, underscore and brackets stay (anything else, such as a slash,
 * a control character, a quote or a letter outside ASCII, becomes an underscore), no leading dots or spaces, and cut to a sensible
 * length with the extension kept. Never empty.
 */
export function safeKeyName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/^[. ]+/, '').trim();
  if (cleaned === '') return 'file';
  if (cleaned.length <= NAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return `${cleaned.slice(0, NAME_MAX - extension.length)}${extension}`;
}

/** The key of a new upload. */
export const objectKey = (ownerUserId: string, fileId: string, name: string): string => `staging/${ownerUserId}/${fileId}/${safeKeyName(name)}`;
