import { buildApp } from './app.js';
import { config } from '../config/index.js';
import { closeDb } from '../db/knex.js';

async function main() {
  const app = await buildApp();

  const shutdown = async (sig: string) => {
    app.log.info({ sig }, 'encerrando wan-web');
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ host: config.web.host, port: config.web.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
