import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { config } from '../config/index.js';
import { outputsRoot } from '../shared/paths.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import { sceneRoutes } from './routes/scenes.js';
import { imageRoutes } from './routes/images.js';
import { catalogRoutes } from './routes/catalog.js';
import { nodeRoutes } from './routes/nodes.js';
import { scheduleRoutes } from './routes/schedules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare module 'fastify' {
  interface Session {
    userId?: number;
    login?: string;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isProd
      ? true
      : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    trustProxy: true, // atrás de nginx/cloudflared
    bodyLimit: 16 * 1024 * 1024, // workflows do ComfyUI podem ser grandes
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 64 * 1024 * 1024 } });
  await app.register(session, {
    secret: config.web.sessionSecret,
    cookie: {
      secure: config.web.sessionSecure,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    },
    saveUninitialized: false,
  });

  // exige sessão autenticada para tudo sob /api, exceto /api/auth/*
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url.startsWith('/api/auth/')) return;
    if (req.url === '/api/health') return;
    if (!req.session.userId) {
      return reply.code(401).send({ error: 'nao_autenticado' });
    }
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(projectRoutes, { prefix: '/api' });
  await app.register(sceneRoutes, { prefix: '/api' });
  await app.register(imageRoutes, { prefix: '/api' });
  await app.register(catalogRoutes, { prefix: '/api' });
  await app.register(nodeRoutes, { prefix: '/api' });
  await app.register(scheduleRoutes, { prefix: '/api' });

  // mídia das saídas (vídeos/frames) — sob /api/media, protegida pela sessão
  await app.register(fastifyStatic, {
    root: outputsRoot(),
    prefix: '/api/media/',
    decorateReply: false,
    index: false,
  });

  // UI estática: vanilla (management) + app React (galeria) buildado em web/app
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '../../web'),
    prefix: '/',
  });

  return app;
}
