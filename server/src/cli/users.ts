/**
 * Manage logins from the command line (normally done in the app under More → Team):
 *   npm run user:create -- teza@gmail.com "Teza"                     (first account is an owner)
 *   npm run user:create -- sita@gmail.com "Sita" member 98XXXXXXXX   (owner | member, optional phone)
 *   npm run user:password -- teza@gmail.com
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
  const [cmd, email, displayName, roleArg, phone] = process.argv.slice(2);
  const config = loadConfig();
  const db = openDatabase(config.dbFile);
  const auth = new AuthService({ config, db, bus: new EventBus(), services: {} });
  if (!cmd || !email || !['create', 'password'].includes(cmd)) {
    console.log('Usage: users.ts create <email> "<Name>" [owner|member] [phone] | users.ts password <email>');
    process.exit(1);
  }
  const password = process.env.SLAY_PASSWORD || (await ask(`Password for ${email} (min 8 chars): `));
  if (cmd === 'create') {
    const role = roleArg === 'member' || roleArg === 'owner' ? roleArg : auth.userCount() === 0 ? 'owner' : 'member';
    auth.createUser({ email, displayName: displayName || email.split('@')[0], password, role, phone: phone || null });
    console.log(`Created login ${email} (${role}).`);
  } else {
    const u = auth.findByLogin(email);
    if (!u) throw new Error(`No account with ${email}`);
    auth.setPassword(u.id, password);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    console.log(`Password updated for ${email} and their devices were signed out.`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
