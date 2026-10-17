import { LiveClient } from './socket.js';

/**
 * The WebSocket address is set when the web app is built (VITE_WS_URL, from the Terraform output `ws_url`).
 * Locally it is the ws-local container on the same host as the page.
 */
const url: string =
  import.meta.env.VITE_WS_URL ?? `ws://${typeof location === 'undefined' ? 'localhost' : location.hostname}:3004`;

/** One connection for the page, opened when someone is signed in and moved to a new one after every token refresh. */
export const liveClient = new LiveClient({ url });
