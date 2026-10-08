import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { service } from './core/context.js';
import type { AuthService } from './modules/auth/service.js';

const config = loadConfig();
const { app, ctx, start } = createApp(config);
const setupCode = service<AuthService>(ctx, 'auth').setupCode;

app.listen(config.port, () => {
  start();
  console.log(`Slay is running on http://localhost:${config.port} (eSewa: ${config.esewa.mode} mode)`);
  if (setupCode) {
    console.log(`No accounts yet. Open the app and create the first owner account with setup code: ${setupCode}`);
    console.log('(or from the command line: npm run user:create -- <email> "<Name>" owner <phone>)');
  }
});
