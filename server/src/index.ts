import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app, ctx, start } = createApp(config);
const users = (ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

app.listen(config.port, () => {
  start();
  console.log(`Slay is running on http://localhost:${config.port} (eSewa: ${config.esewa.mode} mode)`);
  if (users === 0) {
    console.log('No users yet. Create the two logins with:  npm run user:create -- <username> "<Display Name>"');
  }
});
