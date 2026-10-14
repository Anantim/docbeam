import { TransportError, type Transport, type TransportResult } from './transport.js';

function send(
  method: 'POST' | 'PUT',
  url: string,
  body: Blob | FormData,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<TransportResult> {
  // XMLHttpRequest, because fetch has no upload progress.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      resolve({ status: xhr.status, body: xhr.responseText, etag: xhr.getResponseHeader('ETag') ?? undefined });
    xhr.onerror = () => reject(new TransportError('The connection to storage failed.'));
    xhr.ontimeout = () => reject(new TransportError('The connection to storage timed out.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    if (signal.aborted) xhr.abort();
    else xhr.send(body);
  });
}

export const browserTransport: Transport = {
  post({ url, fields, file, onProgress, signal }) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append('file', file);
    return send('POST', url, form, {}, onProgress, signal);
  },
  put({ url, body, sha256Base64, onProgress, signal }) {
    return send('PUT', url, body, { 'x-amz-checksum-sha256': sha256Base64 }, onProgress, signal);
  },
  async abort(url) {
    await fetch(url, { method: 'DELETE' }).catch(() => undefined);
  },
};
