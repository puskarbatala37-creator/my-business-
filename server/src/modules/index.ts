import type { AppModule } from '../core/context.js';
import { authModule } from './auth/index.js';
import { catalogModule } from './catalog/index.js';
import { customersModule } from './customers/index.js';
import { dashboardModule } from './dashboard/index.js';
import { liveModule } from './live/index.js';
import { messagingModule } from './messaging/index.js';
import { ordersModule } from './orders/index.js';
import { payModule, paymentsModule } from './payments/index.js';
import { receiptsModule } from './receipts/index.js';
import { securityModule } from './security/index.js';
import { systemModule } from './system/index.js';
import { uploadsModule } from './uploads/index.js';
import { voiceModule } from './voice/index.js';

/**
 * Every feature of the app. Order matters only for `init` (services other
 * modules depend on come first). New features – e.g. returns & exchanges –
 * are added as a new module here.
 */
export const modules: AppModule[] = [
  messagingModule,
  securityModule,
  authModule,
  catalogModule,
  customersModule,
  ordersModule,
  paymentsModule,
  payModule,
  receiptsModule,
  dashboardModule,
  voiceModule,
  uploadsModule,
  liveModule,
  systemModule,
];
