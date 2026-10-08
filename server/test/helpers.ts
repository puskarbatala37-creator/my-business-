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
  auth.createUser('teza', 'Teza', 'password-teza');
  auth.createUser('partner', 'Partner', 'password-partner');
  return { ...created, config };
}

export async function login(app: any, username: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('x-slay', '1').send({ username, password });
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
  const cat = await api.post('/api/catalog/categories', { name: 'Sari', voice_aliases: '' });
  const prod = await api.post('/api/catalog/products', {
    category_id: cat.body.id,
    name: 'Banarasi Silk',
    sizes: 'Free',
    variants: [
      { color: 'Red', stock: 3, cost: 1800, price: 3500 },
      { color: 'Blue', stock: 1, cost: 1800, price: 3500 },
    ],
  });
  const tree = await api.get('/api/catalog');
  const variants = tree.body.categories[0].products[0].variants;
  return {
    categoryId: cat.body.id,
    productId: prod.body.id,
    red: variants.find((v: any) => v.color === 'Red').id as number,
    blue: variants.find((v: any) => v.color === 'Blue').id as number,
  };
}
