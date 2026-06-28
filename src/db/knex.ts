import { createRequire } from 'node:module';
import KnexFactory, { type Knex } from 'knex';

// Reaproveita a mesma configuração do CLI (knexfile.cjs) para não duplicar conexão.
const require = createRequire(import.meta.url);
const knexConfig = require('../../knexfile.cjs') as Knex.Config;

let instance: Knex | null = null;

export function db(): Knex {
  if (!instance) instance = KnexFactory(knexConfig);
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}
