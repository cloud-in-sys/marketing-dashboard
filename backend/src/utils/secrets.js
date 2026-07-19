// @ts-check
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();
const cache = new Map();

export async function getSecret(name) {
  if (cache.has(name)) return cache.get(name);
  const project = process.env.GCP_PROJECT_ID;
  if (!project) throw new Error('GCP_PROJECT_ID not set');
  const [version] = await client.accessSecretVersion({
    name: `projects/${project}/secrets/${name}/versions/latest`,
  });
  // 実体は Buffer (Uint8Array)。型は string も含む union なので Buffer と明示する。
  const value = /** @type {Buffer} */ (version.payload.data).toString('utf8');
  cache.set(name, value);
  return value;
}
