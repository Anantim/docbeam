// Secrets for Lambdas (D-M2-5). On AWS the function environment holds only an ARN (`<NAME>_ARN`);
// the value is read with GetSecretValue once per cold start and kept. Locally `.env` gives the
// plain value under `<NAME>`.

export type SecretFetcher = (secretId: string) => Promise<string>;

/** Reads a secret string with the AWS SDK. The SDK is loaded only when it is needed. */
export const fetchAwsSecret: SecretFetcher = async (secretId) => {
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({});
  const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (out.SecretString === undefined) throw new Error('The secret has no string value.');
  return out.SecretString;
};

export interface SecretReader {
  /** The plain value of `<name>`, or the secret named by `<name>_ARN`. Throws if neither is set. */
  read(name: string): Promise<string>;
  /** Like `read`, but for a JSON secret, returning one field. */
  readField(name: string, field: string): Promise<string>;
}

export function createSecretReader(
  env: Record<string, string | undefined> = process.env,
  fetcher: SecretFetcher = fetchAwsSecret,
): SecretReader {
  const cache = new Map<string, Promise<string>>();

  function read(name: string): Promise<string> {
    const plain = env[name];
    if (plain) return Promise.resolve(plain);
    const arn = env[`${name}_ARN`];
    if (!arn) return Promise.reject(new Error(`Neither ${name} nor ${name}_ARN is set.`));
    let pending = cache.get(arn);
    if (!pending) {
      pending = fetcher(arn);
      // A failed read must be tried again on the next call, not cached.
      pending.catch(() => cache.delete(arn));
      cache.set(arn, pending);
    }
    return pending;
  }

  return {
    read,
    async readField(name, field) {
      const value = await read(name);
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const found = parsed[field];
      if (typeof found !== 'string') throw new Error(`The secret ${name} has no string field ${field}.`);
      return found;
    },
  };
}
