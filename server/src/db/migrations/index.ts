import init from './001_init.js';
import teamAndPasskeys from './002_team_and_passkeys.js';
import orderSearch from './003_order_search.js';
import emailLoginPhone from './004_email_login_phone.js';
import defaultCategories from './005_default_categories.js';

/**
 * Ordered list of schema migrations. To change the schema, append a new
 * migration – never edit one that has already shipped.
 */
export const migrations: { id: string; sql: string }[] = [
  { id: '001_init', sql: init },
  { id: '002_team_and_passkeys', sql: teamAndPasskeys },
  { id: '003_order_search', sql: orderSearch },
  { id: '004_email_login_phone', sql: emailLoginPhone },
  { id: '005_default_categories', sql: defaultCategories },
];
