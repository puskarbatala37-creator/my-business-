/** No-op browser stand-ins for node-only packages the demo doesn't need. */
const passThrough = () => (_req: unknown, _res: unknown, next: () => void) => next();

export function multer() {
  return { single: passThrough };
}
multer.memoryStorage = () => ({});
multer.diskStorage = () => ({});

export const webpush = {
  generateVAPIDKeys: () => ({ publicKey: 'demo', privateKey: 'demo' }),
  setVapidDetails: () => {},
  sendNotification: async () => {},
};

export const fs = { mkdirSync: () => {}, existsSync: () => false };
export const path = {
  dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '/',
  join: (...p: string[]) => p.join('/'),
  resolve: (...p: string[]) => p.join('/'),
};
