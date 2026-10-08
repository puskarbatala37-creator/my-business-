import init from './001_init.js';
import teamAndPasskeys from './002_team_and_passkeys.js';

/**
 * Ordered list of schema migrations. To change the schema, append a new
 * migration – never edit one that has already shipped.
 */
export const migrations: { id: string; sql: string }[] = [
  { id: '001_init', sql: init },
  { id: '002_team_and_passkeys', sql: teamAndPasskeys },
];
