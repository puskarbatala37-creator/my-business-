import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../../config.js';

/** Email via any SMTP server (Gmail, Zoho, Mailgun, your host…). Off unless SMTP_URL is set. */
export class MailService {
  private transport: Transporter | null;

  constructor(private cfg: Config['mail']) {
    this.transport = cfg.smtpUrl ? nodemailer.createTransport(cfg.smtpUrl) : null;
  }

  get configured() {
    return !!this.transport;
  }

  async send(to: string[], subject: string, text: string) {
    if (!this.transport || !to.length) return;
    await this.transport.sendMail({ from: this.cfg.from, bcc: to, subject, text });
  }
}
