import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',

  web: {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000),
    sessionSecret: req('SESSION_SECRET', 'dev-secret-troque-isto-em-producao-aaaaaaaa'),
    sessionSecure: (process.env.SESSION_SECURE || 'false') === 'true',
  },

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'wan',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wan_studio',
  },

  paths: {
    dataDir: process.env.DATA_DIR || '/var/lib/wan-studio',
  },

  worker: {
    pollMs: Number(process.env.WORKER_POLL_MS || 2000),
  },

  agent: {
    decisionMs: Number(process.env.AGENT_DECISION_MS || 45000),
    healthMs: Number(process.env.AGENT_HEALTH_MS || 10000),
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    decisionModel: process.env.AGENT_DECISION_MODEL || 'claude-sonnet-4-6',
    healthModel: process.env.AGENT_HEALTH_MODEL || 'claude-haiku-4-5-20251001',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
};
