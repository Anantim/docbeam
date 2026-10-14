import { SignJWT } from 'jose';
import { JWT_AUDIENCE } from '@docbeam/shared';
import type { SigningKey } from './keys.js';

/** Access tokens and service tokens last 15 minutes (ADR-013, ADR-015). */
export const ACCESS_TOKEN_SECONDS = 900;

export interface TokenIssuer {
  user(user: { id: string; email: string; name: string }): Promise<string>;
  service(clientId: string, scopes: string[]): Promise<string>;
}

export function createTokenIssuer(key: SigningKey, issuer: string): TokenIssuer {
  const sign = (claims: Record<string, unknown>, subject: string): Promise<string> =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(JWT_AUDIENCE)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
      .sign(key.privateKey);

  return {
    user: (user) => sign({ email: user.email, name: user.name, token_use: 'user' }, user.id),
    service: (clientId, scopes) => sign({ scope: scopes.join(' '), token_use: 'service' }, clientId),
  };
}
