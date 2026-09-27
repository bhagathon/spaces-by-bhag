import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp, hashToken } from '../server/src/app.ts';
import { SqliteStore } from '../server/src/sqliteStore.ts';
import { FirestoreStore } from '../server/src/firestoreStore.ts';

/** TEST_STORE=firestore (with FIRESTORE_EMULATOR_HOST set) runs the server suites on Firestore. */
export async function startServer() {
  const store = process.env.TEST_STORE === 'firestore' ? new FirestoreStore(`demo-${randomUUID().slice(0, 8)}`) : new SqliteStore(':memory:');
  const app = createApp(store);
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const addUser = async (name: string) => {
    const token = `${name}-${randomUUID()}`;
    const id = randomUUID();
    await store.createUser({ id, name, tokenHash: hashToken(token) });
    return { id, token };
  };
  /** Simulate the server losing data without recording a deletion (bad restore, wiped database). */
  const loseAllSpaces = async () => {
    if (store instanceof SqliteStore) (store as unknown as { db: { exec(sql: string): void } }).db.exec('DELETE FROM spaces');
    else {
      const db = (store as unknown as { db: FirebaseFirestore.Firestore }).db;
      for (const d of (await db.collection('spaces').get()).docs) await d.ref.delete();
    }
  };
  return {
    store,
    url,
    addUser,
    loseAllSpaces,
    close: async () => {
      await app.close();
      await store.close();
    },
  };
}

export async function until<T>(fn: () => Promise<T> | T, pred: (v: T) => boolean = Boolean as (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out; last value: ${JSON.stringify(v)}`);
    await new Promise(r => setTimeout(r, 25));
  }
}
