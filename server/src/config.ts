import fs from 'node:fs';
import path from 'node:path';

// Load a local .env file if present (Node >= 20.12).
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile) && typeof (process as any).loadEnvFile === 'function') {
  (process as any).loadEnvFile(envFile);
}

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export interface Config {
  port: number;
  dataDir: string;
  dbFile: string;
  uploadsDir: string;
  /** Public URL the app is reachable at – used for eSewa success/failure redirects. */
  appUrl: string;
  /** Directory of the built web app to serve (production). */
  webDist: string;
  isProduction: boolean;
  trustProxy: boolean;
  cookieSecure: boolean;
  sessionDays: number;
  initialUsers: string;
  esewa: {
    mode: 'test' | 'production';
    productCode: string;
    secretKey: string;
    formUrl: string;
    statusUrl: string;
  };
  transcribe: {
    url: string;
    apiKey: string;
    model: string;
  };
  alertWebhookUrl: string;
  vapidSubject: string;
}

const ESEWA_ENDPOINTS = {
  test: {
    formUrl: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    statusUrl: 'https://rc.esewa.com.np/api/epay/transaction/status/',
    productCode: 'EPAYTEST',
    // Public sandbox secret published in eSewa's developer documentation.
    secretKey: '8gBm/:&EnhH.1/q',
  },
  production: {
    formUrl: 'https://epay.esewa.com.np/api/epay/main/v2/form',
    statusUrl: 'https://epay.esewa.com.np/api/epay/transaction/status/',
    productCode: '',
    secretKey: '',
  },
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = path.resolve(env('DATA_DIR', 'data'));
  const isProduction = env('NODE_ENV') === 'production';
  const esewaMode = env('ESEWA_MODE', 'test') === 'production' ? 'production' : 'test';
  const e = ESEWA_ENDPOINTS[esewaMode];
  const port = Number(env('PORT', '3000'));
  const cfg: Config = {
    port,
    dataDir,
    dbFile: env('DB_FILE', path.join(dataDir, 'slay.db')),
    uploadsDir: path.join(dataDir, 'uploads'),
    appUrl: env('APP_URL', `http://localhost:${isProduction ? port : 5173}`).replace(/\/$/, ''),
    webDist: path.resolve(env('WEB_DIST', path.join(process.cwd(), '../web/dist'))),
    isProduction,
    trustProxy: env('TRUST_PROXY', isProduction ? '1' : '0') === '1',
    cookieSecure: env('COOKIE_SECURE', isProduction ? '1' : '0') === '1',
    sessionDays: Number(env('SESSION_DAYS', '30')),
    initialUsers: env('INITIAL_USERS'),
    esewa: {
      mode: esewaMode,
      productCode: env('ESEWA_PRODUCT_CODE', e.productCode),
      secretKey: env('ESEWA_SECRET_KEY', e.secretKey),
      formUrl: env('ESEWA_FORM_URL', e.formUrl),
      statusUrl: env('ESEWA_STATUS_URL', e.statusUrl),
    },
    transcribe: {
      url: env('TRANSCRIBE_API_URL', 'https://api.openai.com/v1/audio/transcriptions'),
      apiKey: env('TRANSCRIBE_API_KEY'),
      model: env('TRANSCRIBE_MODEL', 'whisper-1'),
    },
    alertWebhookUrl: env('ALERT_WEBHOOK_URL'),
    vapidSubject: env('VAPID_SUBJECT', 'mailto:admin@example.com'),
    ...overrides,
  };
  return cfg;
}
