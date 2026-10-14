import { generateKeyPairSync } from 'node:crypto';
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

// One-time task (D-M0-1, D-G11): writes a new RS256 private key into the empty signing-key secret.
// It never replaces a key that is already there, so running it twice is safe and Terraform never sees the value.
const secretId = process.env.SIGNING_KEY_SECRET_ID;
if (!secretId) {
  console.error('SIGNING_KEY_SECRET_ID is not set');
  process.exit(1);
}

const client = new SecretsManagerClient({});
let exists = false;
try {
  const current = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  exists = Boolean(current.SecretString);
} catch (err) {
  // A secret with no version yet answers ResourceNotFoundException.
  if (!(err instanceof ResourceNotFoundException)) throw err;
}

if (exists) {
  console.log(JSON.stringify({ level: 'info', msg: 'signing key already present, nothing written' }));
} else {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  await client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: pem }));
  console.log(JSON.stringify({ level: 'info', msg: 'signing key written' }));
}
