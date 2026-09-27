import path from 'node:path';
import { MemoryStore } from './memory.js';

export async function openStore(env = process.env) {
  if (env.DATABASE_URL) {
    const { PgStore } = await import('./pg.js');
    return PgStore.connect(env.DATABASE_URL);
  }
  const file = env.STORE_FILE === 'none' ? null : (env.STORE_FILE || path.resolve('data/dev.json'));
  return new MemoryStore({ file });
}

export { MemoryStore };
