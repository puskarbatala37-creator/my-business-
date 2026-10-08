import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { service } from '../src/core/context.js';
import type { AuthService } from '../src/modules/auth/service.js';

export function setup() {
  const config = loadConfig({
    dbFile: ':memory:',
    uploadsDir: path.join(os.tmpdir(), 'slay-test-uploads'),
    appUrl: 'http://slay.test',
    webDist: '/nonexistent',
    initialUsers: '',
  });
  const created = createApp(config);
  const auth = service<AuthService>(created.ctx, 'auth');
  auth.createUser({ email: 'teza@example.com', displayName: 'Teza', password: 'password-teza', role: 'owner', phone: '9841000001' });
  auth.createUser({ email: 'partner@example.com', displayName: 'Partner', password: 'password-partner', role: 'owner', phone: '9841000002' });
  return { ...created, config };
}

/** Accounts sign in by email; a bare name like "teza" means teza@example.com. */
export const emailOf = (name: string) => (name.includes('@') ? name : `${name}@example.com`);

export async function login(app: any, name: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('x-slay', '1').send({ email: emailOf(name), password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Adds the CSRF header to every write. */
export const w = (agent: any) => ({
  post: (url: string, body?: unknown) => agent.post(url).set('x-slay', '1').send(body ?? {}),
  put: (url: string, body?: unknown) => agent.put(url).set('x-slay', '1').send(body ?? {}),
  patch: (url: string, body?: unknown) => agent.patch(url).set('x-slay', '1').send(body ?? {}),
  delete: (url: string) => agent.delete(url).set('x-slay', '1'),
  get: (url: string) => agent.get(url),
});

export async function seedCatalog(api: ReturnType<typeof w>) {
  // Kurta, Sari and Lehenga exist from the start.
  const sari = (await api.get('/api/catalog')).body.categories.find((c: any) => c.name === 'Sari');
  const prod = await api.post('/api/catalog/products', {
    category_id: sari.id,
    name: 'Banarasi Silk',
    sizes: 'Free',
    variants: [
      { color: 'Red', stock: 3, cost: 1800, price: 3500 },
      { color: 'Blue', stock: 1, cost: 1800, price: 3500 },
    ],
  });
  const tree = await api.get('/api/catalog');
  const variants = tree.body.categories.find((c: any) => c.name === 'Sari').products[0].variants;
  return {
    categoryId: sari.id as number,
    productId: prod.body.id,
    red: variants.find((v: any) => v.color === 'Red').id as number,
    blue: variants.find((v: any) => v.color === 'Blue').id as number,
  };
}
