/** Sample data for the demo preview: two logins, a small catalog and ~6 months of orders. */
import { addDays, todayInBusinessTz } from '@slay/shared';
import type { AppContext, AuthUser } from '../../../server/src/core/context';
import { service } from '../../../server/src/core/context';
import type { AuthService } from '../../../server/src/modules/auth/service';
import type { CatalogService } from '../../../server/src/modules/catalog/service';
import type { OrderService } from '../../../server/src/modules/orders/service';

export const DEMO_LOGINS = [
  { email: 'teza@slay.demo', password: 'demo-teza-123', name: 'Teza', phone: '9841000001' },
  { email: 'partner@slay.demo', password: 'demo-partner-123', name: 'Partner', phone: '9841000002' },
];

/** A small two-tone fabric swatch as an inline SVG image (stands in for product photos). */
const swatch = (a: string, b: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 50'><rect width='40' height='50' fill='${a}'/><path d='M0 34 40 14v10L0 44z' fill='${b}'/></svg>`,
  )}`;

const CATALOG = [
  {
    category: 'Sari',
    aliases: 'साडी',
    products: [
      {
        name: 'Banarasi Silk',
        aliases: 'बनारसी',
        sizes: 'Free',
        variants: [
          ['Red', '#b3132b', '#e8b04a', 4, 1800, 3500],
          ['Royal Blue', '#1f3f99', '#d9b45a', 2, 1800, 3500],
          ['Green', '#1d6b3a', '#e3c15b', 1, 1800, 3500],
        ],
      },
      {
        name: 'Cotton Daily',
        aliases: 'सुती',
        sizes: 'Free',
        variants: [
          ['Pink', '#e07aa0', '#fbe1ea', 6, 650, 1400],
          ['Yellow', '#e9b830', '#fff3c4', 0, 650, 1400],
        ],
      },
    ],
  },
  {
    category: 'Kurta',
    aliases: 'कुर्था',
    products: [
      {
        name: 'Kurta Set',
        aliases: '',
        sizes: 'S, M, L, XL',
        variants: [
          ['Black', '#1b1b1f', '#7a7a85', 5, 900, 1800],
          ['Maroon', '#6d1a2c', '#c9898f', 3, 900, 1800],
          ['White', '#f4f1ea', '#c8c2b4', 2, 900, 1800],
        ],
      },
    ],
  },
  {
    category: 'Lehenga',
    aliases: 'लेहेंगा',
    products: [{ name: 'Bridal Lehenga', aliases: '', sizes: 'S, M, L', variants: [['Rani Pink', '#c2185b', '#f2c94c', 1, 9000, 18500]] }],
  },
] as const;

const CUSTOMERS = [
  { name: 'Sita Sharma', phone: '9841234567', address: 'Baneshwor, Kathmandu', social_handle: 'sita.sharma' },
  { name: 'Gita Rai', phone: '9803456789', address: 'Lakeside, Pokhara', social_handle: 'gita_rai' },
  { name: 'Anjali Thapa', phone: '9812345670', address: 'Patan, Lalitpur', social_handle: 'anjali.t' },
  { name: 'Puja Gurung', phone: '9860011223', address: 'Dharan', social_handle: 'pujagurung' },
  { name: 'Rina Karki', phone: '9851098765', address: 'Bhaktapur', social_handle: 'rina.karki' },
];

export async function seedDemo(ctx: AppContext) {
  const auth = service<AuthService>(ctx, 'auth');
  const catalog = service<CatalogService>(ctx, 'catalog');
  const orders = service<OrderService>(ctx, 'orders');

  const users: AuthUser[] = DEMO_LOGINS.map((u) => {
    const { id } = auth.createUser({ email: u.email, displayName: u.name, password: u.password, role: 'owner', phone: u.phone });
    // Sample accounts start with confirmed phones so the demo opens straight away.
    ctx.db.prepare('UPDATE users SET phone_verified_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return { id, username: u.email, displayName: u.name, role: 'owner', sessionId: 0 };
  });
  const [teza, partner] = users;

  const v: Record<string, number> = {};
  for (const c of CATALOG) {
    // Kurta, Sari and Lehenga exist from the start; anything else is created.
    const cat =
      (ctx.db.prepare('SELECT id FROM categories WHERE name = ?').get(c.category) as { id: number } | undefined) ??
      (catalog.createCategory(c.category, c.aliases) as { id: number });
    for (const p of c.products) {
      // Seed with extra stock so the sample orders below can be taken from it.
      const pid = catalog.createProduct(
        {
          category_id: cat.id,
          name: p.name,
          sizes: p.sizes,
          voice_aliases: p.aliases,
          variants: p.variants.map(([color, a, b, stock, cost, price]) => ({ color, stock: stock + 6, cost, price, photo: swatch(a, b) })),
        },
        teza,
      );
      for (const row of ctx.db.prepare('SELECT id, color FROM variants WHERE product_id = ?').all(pid) as { id: number; color: string }[]) {
        v[`${p.name}/${row.color}`] = row.id;
      }
    }
  }

  const today = todayInBusinessTz();
  type Line = [string, number, number, string?];
  const sample: { daysAgo: number; c: number; items: Line[]; pay: 'paid' | 'partial' | 'unpaid'; amount?: number; method?: 'esewa' | 'cash' | 'khalti' | 'bank'; sent?: string; platform: 'instagram' | 'facebook' | 'tiktok' | 'whatsapp'; by: AuthUser; notes?: string; due?: number }[] = [
    { daysAgo: 160, c: 0, items: [['Banarasi Silk/Red', 1, 3500]], pay: 'paid', method: 'esewa', sent: 'NCM-10021', platform: 'instagram', by: teza },
    { daysAgo: 130, c: 1, items: [['Kurta Set/Black', 2, 1800, 'M']], pay: 'paid', method: 'khalti', sent: 'NCM-10388', platform: 'facebook', by: partner },
    { daysAgo: 100, c: 2, items: [['Cotton Daily/Pink', 2, 1400]], pay: 'paid', method: 'cash', sent: 'NCM-10790', platform: 'whatsapp', by: teza },
    { daysAgo: 95, c: 3, items: [['Bridal Lehenga/Rani Pink', 1, 18500, 'M']], pay: 'paid', method: 'bank', sent: 'NCM-10811', platform: 'instagram', by: teza, notes: 'Blouse stitching to measurements' },
    { daysAgo: 70, c: 4, items: [['Banarasi Silk/Royal Blue', 1, 3500], ['Kurta Set/Maroon', 1, 1800, 'L']], pay: 'paid', method: 'esewa', sent: 'NCM-11240', platform: 'instagram', by: partner },
    { daysAgo: 45, c: 0, items: [['Cotton Daily/Yellow', 3, 1400]], pay: 'paid', method: 'cash', sent: 'NCM-11702', platform: 'facebook', by: teza },
    { daysAgo: 30, c: 1, items: [['Banarasi Silk/Green', 1, 3500]], pay: 'paid', method: 'esewa', sent: 'NCM-11955', platform: 'tiktok', by: partner },
    { daysAgo: 12, c: 2, items: [['Kurta Set/White', 1, 1800, 'S']], pay: 'paid', method: 'khalti', sent: 'NCM-12233', platform: 'instagram', by: teza },
    { daysAgo: 6, c: 3, items: [['Banarasi Silk/Red', 1, 3500]], pay: 'partial', amount: 1000, method: 'esewa', platform: 'instagram', by: partner, due: 1, notes: 'Fall & pico please' },
    { daysAgo: 3, c: 4, items: [['Cotton Daily/Pink', 1, 1400], ['Kurta Set/Black', 1, 1800, 'L']], pay: 'unpaid', platform: 'whatsapp', by: teza, due: 2 },
    { daysAgo: 1, c: 0, items: [['Kurta Set/Maroon', 1, 1800, 'M']], pay: 'paid', method: 'esewa', sent: 'NCM-12510', platform: 'tiktok', by: teza },
    { daysAgo: 0, c: 1, items: [['Banarasi Silk/Royal Blue', 1, 3500]], pay: 'partial', amount: 1500, method: 'cash', platform: 'instagram', by: partner, due: 3 },
    { daysAgo: 0, c: 2, items: [['Cotton Daily/Pink', 2, 1400]], pay: 'unpaid', platform: 'tiktok', by: teza, due: 4 },
  ];
  for (const o of sample) {
    const created = orders.create(
      {
        customer: CUSTOMERS[o.c],
        order_date: addDays(today, -o.daysAgo),
        platform: o.platform,
        delivery_charge: 150,
        notes: o.notes ?? '',
        delivery_due_date: o.due !== undefined ? addDays(today, o.due) : null,
        prep_time_days: o.due !== undefined ? 1 : null,
        items: o.items.map(([key, quantity, unit_price, size]) => ({ variant_id: v[key], quantity, unit_price, size: size ?? '' })),
        payment: { status: o.pay, amount: o.amount, method: o.method ?? 'cash' },
      },
      o.by,
    );
    if (o.sent) orders.patch(created.id, { fulfillment_status: 'sent', tracking_number: o.sent }, o.by);
  }

  // Bring stock back to the intended demo levels (the sample orders above used some).
  for (const c of CATALOG)
    for (const p of c.products)
      for (const [color, , , stock] of p.variants) {
        ctx.db.prepare('UPDATE variants SET stock = ? WHERE id = ?').run(stock, v[`${p.name}/${color}`]);
      }

  const receipts: [number, string, number, string, string, string, string][] = [
    [150, 'Asan Fabric House', 42000, 'Fabric', 'Banarasi silk – 12 pieces', '#7a1f2b', '#e3c15b'],
    [60, 'Indra Chowk Thread Store', 3800, 'Thread', 'Zari thread + lining', '#3d5a80', '#e0fbfc'],
    [20, 'Bhotahity Wholesale', 16500, 'Ready-made', 'Kurta sets × 10', '#2d2d2d', '#8d8d8d'],
    [2, 'New Road Tailors', 2500, 'Stitching', 'Blouse stitching for 5 orders', '#8a5a44', '#f2d0a4'],
  ];
  for (const [daysAgo, supplier, amount, category, notes, a, b] of receipts) {
    const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    ctx.db
      .prepare('INSERT INTO receipts (photo, captured_at, supplier, amount, category, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(swatch(a, b), at, supplier, amount, category, notes, teza.id);
  }
  // Start with a clean alert list – the demo's own sign-ins will show how alerts work.
  ctx.db.exec('DELETE FROM security_alerts; DELETE FROM activity_log;');
}
