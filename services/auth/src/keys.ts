import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { calculateJwkThumbprint, exportJWK, type JWK } from 'jose';

export interface SigningKey {
  /** RFC 7638 thumbprint of the public key. */
  kid: string;
  privateKey: KeyObject;
  /** The public key as a JWKS entry. */
  publicJwk: JWK;
}

/** Loads the RS256 key from a PEM. A PEM in an env file may carry `\n` for newlines. */
export async function loadSigningKey(pem: string): Promise<SigningKey> {
  const privateKey = createPrivateKey(pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem);
  if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('The signing key must be an RSA key');
  const jwk = await exportJWK(createPublicKey(privateKey));
  const kid = await calculateJwkThumbprint(jwk, 'sha256');
  return { kid, privateKey, publicJwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}
