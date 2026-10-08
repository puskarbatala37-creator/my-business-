/**
 * Manage logins from the command line:
 *   npm run user:create -- teza "Teza"            (first account is an owner)
 *   npm run user:create -- sita "Sita" member     (owner | member)
 *   npm run user:password -- teza
 */
import readline from 'node:readline';
import { loadConfig } from '../config.js';
import { EventBus } from '../core/events.js';
import { openDatabase } from '../db/index.js';
import { AuthService } from '../modules/auth/service.js';

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a))));
}

async function main() {
  const [cmd, username, displayName, roleArg] = process.argv.slice(2);
  const config = loadConfig();
  const db = openDatabase(config.dbFile);
  const auth = new AuthService({ config, db, bus: new EventBus(), services: {} });
  if (!cmd || !username || !['create', 'password'].includes(cmd)) {
    console.log('Usage: users.ts create <username> "<Display Name>" [owner|member] | users.ts password <username>');
    process.exit(1);
  }
  const password = process.env.SLAY_PASSWORD || (await ask(`Password for ${username} (min 8 chars): `));
  if (cmd === 'create') {
    const role = roleArg === 'member' || roleArg === 'owner' ? roleArg : auth.userCount() === 0 ? 'owner' : 'member';
    auth.createUser(username, displayName || username, password, role);
    console.log(`Created login "${username}" (${role}).`);
  } else {
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (!u) throw new Error(`No user called ${username}`);
    auth.setPassword(u.id, password);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    console.log(`Password updated for "${username}" and their devices were signed out.`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
