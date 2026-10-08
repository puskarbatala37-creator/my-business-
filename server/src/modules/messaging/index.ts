import type { AppModule } from '../../core/context.js';
import { MailService } from './mail.js';
import { SmsService } from './sms.js';

/** Outgoing messages (SMS recovery codes, notification emails). Must come before modules that send. */
export const messagingModule: AppModule = {
  name: 'messaging',
  init(ctx) {
    ctx.services.sms = new SmsService(ctx.config.sms);
    ctx.services.mail = new MailService(ctx.config.mail);
  },
};
