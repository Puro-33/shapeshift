import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './store/index.js';
import { createApp } from './app.js';

// Minimal .env loader (no dotenv dependency)
const envFile = path.resolve('.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const port = Number(process.env.PORT || 8787);
const store = await openStore(process.env);
const handler = createApp({ store, env: process.env });
const server = http.createServer(handler);
server.requestTimeout = 180_000;
server.listen(port, () => {
  console.log(`Shapeshift listening on :${port} (store: ${process.env.DATABASE_URL ? 'postgres' : 'file'})`);
});

const shutdown = async () => {
  server.close();
  await store.close?.();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
