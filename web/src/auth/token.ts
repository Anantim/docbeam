/** What the page shows about the signed-in person, read from the access token (not checked here: the services check it). */
export interface Claims {
  sub: string;
  email: string;
  name: string;
  /** Seconds since 1970. */
  exp: number;
}

export function decodeClaims(token: string): Claims | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
    const c = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Claims>;
    if (typeof c.sub !== 'string' || typeof c.exp !== 'number') return null;
    return { sub: c.sub, email: c.email ?? '', name: c.name ?? '', exp: c.exp };
  } catch {
    return null;
  }
}

/** The app swaps the refresh token a minute before the access token expires (ADR-015). */
export const REFRESH_LEAD_MS = 60_000;

export function msUntilRefresh(expSeconds: number, nowMs: number): number {
  return Math.max(0, expSeconds * 1000 - REFRESH_LEAD_MS - nowMs);
}

export function isUsable(token: string, nowMs: number, marginMs = 5_000): boolean {
  const claims = decodeClaims(token);
  return claims !== null && claims.exp * 1000 - nowMs > marginMs;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}
