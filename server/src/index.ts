import { createApp } from './app.ts';
import { FirestoreStore } from './firestoreStore.ts';
import { SqliteStore } from './sqliteStore.ts';
import type { ServerStore } from './store.ts';

export function storeFromEnv(): ServerStore {
  return process.env.STORE === 'firestore' ? new FirestoreStore() : new SqliteStore(process.env.SQLITE_PATH ?? 'spaces.db');
}

if (import.meta.main) {
  const store = storeFromEnv();
  const app = createApp(store, { log: true });
  const port = Number(process.env.PORT ?? 8080);
  app.server.listen(port, () => console.log(`spaces-server listening on :${port} (store: ${process.env.STORE ?? 'sqlite'})`));
  const shutdown = async () => {
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
