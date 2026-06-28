// Configuração do Knex (CommonJS para o CLI carregar sem loader de TS).
// As migrations ficam em ./migrations como .cjs — robusto em dev e em produção.
require('dotenv').config();

/** @type {import('knex').Knex.Config} */
const config = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'wan',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wan_studio',
    charset: 'utf8mb4',
    timezone: 'Z',
  },
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './migrations',
    loadExtensions: ['.cjs'],
    tableName: 'knex_migrations',
  },
};

module.exports = config;
