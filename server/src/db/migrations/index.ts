import init from './001_init.js';

/**
 * Ordered list of schema migrations. To change the schema, append a new
 * migration – never edit one that has already shipped.
 */
export const migrations: { id: string; sql: string }[] = [{ id: '001_init', sql: init }];
