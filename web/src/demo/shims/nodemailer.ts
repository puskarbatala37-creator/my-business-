/** The demo never sends email. */
export type Transporter = { sendMail: (m: unknown) => Promise<void> };
export default { createTransport: (): Transporter => ({ sendMail: async () => {} }) };
