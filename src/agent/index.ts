/**
 * wan-agent — supervisor (esqueleto da Fase 1).
 *
 * Nesta fase apenas monta o contexto SEGURO e o registra. As decisões via LLM (tool-use)
 * e a allowlist de ações entram na Fase 6, mas os guardrails de entrada já estão ativos:
 * o contexto aqui jamais contém prompts ou imagens.
 */
import { db, closeDb } from '../db/knex.js';
import { config } from '../config/index.js';
import { makeLogger } from '../shared/logger.js';
import { buildAgentContext } from './context.js';

const log = makeLogger('wan-agent');
let parar = false;

async function tick() {
  // nowIso injetado de fora: Date é permitido em runtime do app (só não em workflows).
  const ctx = await buildAgentContext(db(), new Date().toISOString());
  log.info({ resumo: ctx.resumo, nodes: ctx.nodes.length }, 'contexto do agente (sem conteúdo)');
  // Fase 6: enviar ctx ao Claude e executar ações validadas.
}

async function main() {
  log.info({ decisionMs: config.agent.decisionMs }, 'wan-agent iniciado');
  const stop = () => { parar = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  while (!parar) {
    try {
      await tick();
    } catch (err) {
      log.error({ err }, 'falha no tick do agente');
    }
    await new Promise((r) => setTimeout(r, config.agent.decisionMs));
  }
  await closeDb();
  process.exit(0);
}

void main();
