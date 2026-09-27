/**
 * Admin CLI. Uses the same store as the server (STORE=firestore for GCP).
 *   node src/cli.ts add-user <name>                    → prints the user's token (shown once)
 *   node src/cli.ts list-users
 *   node src/cli.ts create-team <id> <name> <owner>
 *   node src/cli.ts set-role <workspaceId> <user> <owner|editor|viewer|none>
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './app.ts';
import { storeFromEnv } from './index.ts';
import type { Role } from '../../src/shared/types.ts';

const [cmd, ...args] = process.argv.slice(2);
const store = storeFromEnv();

async function userOrDie(name: string) {
  const u = await store.userByName(name);
  if (!u) throw new Error(`No user named ${name}`);
  return u;
}

try {
  switch (cmd) {
    case 'add-user': {
      const [name] = args;
      if (!name) throw new Error('usage: add-user <name>');
      const token = randomBytes(32).toString('base64url');
      await store.createUser({ id: randomUUID(), name, tokenHash: hashToken(token) });
      console.log(`Created ${name}. Token (store it now, it is not recoverable):\n${token}`);
      break;
    }
    case 'list-users':
      for (const u of await store.listUsers()) console.log(`${u.name}\t${u.id}`);
      break;
    case 'create-team': {
      const [id, name, owner] = args;
      if (!id || !name || !owner || id === 'personal') throw new Error('usage: create-team <id> <name> <ownerName>');
      await store.putWorkspace({ id, name });
      await store.setRole(id, (await userOrDie(owner)).id, 'owner');
      console.log(`Created team workspace ${id}`);
      break;
    }
    case 'set-role': {
      const [wid, name, role] = args;
      if (!['owner', 'editor', 'viewer', 'none'].includes(role)) throw new Error('usage: set-role <workspaceId> <user> <owner|editor|viewer|none>');
      if (!(await store.getWorkspace(wid))) throw new Error(`No workspace ${wid}`);
      await store.setRole(wid, (await userOrDie(name)).id, role === 'none' ? null : (role as Role));
      console.log(`${name} is now ${role} in ${wid}`);
      break;
    }
    default:
      console.log('commands: add-user, list-users, create-team, set-role');
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await store.close();
}
