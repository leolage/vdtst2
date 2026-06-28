/**
 * Camada de decisão do agente: envia o contexto SEGURO (sem conteúdo) ao Claude e
 * recebe ações via tool-use. As ações são validadas pela allowlist em actions.ts antes
 * de executar — esta camada só obtém a intenção do modelo.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { ACTION_TOOLS } from './actions.js';
import type { AgentContext } from './context.js';

const SYSTEM = [
  'Você é o supervisor de uma fila de geração de vídeos em ComfyUI.',
  'Você recebe APENAS metadados (ids, status, categorias de erro, saúde dos nós).',
  'Você NUNCA vê nem altera prompts, imagens ou qualquer conteúdo criativo — e não deve pedir isso.',
  'Seu objetivo: manter o trabalho fluindo com segurança. Aja de forma conservadora.',
  'Use as ferramentas para: liberar jobs bloqueados quando houver capacidade, dar retry em',
  'erros transitórios (OOM_VRAM, TIMEOUT), pausar/reiniciar nós offline ou travados, e',
  'escalar ao humano o que for ambíguo. Se nada precisa ser feito, não chame ferramenta alguma.',
].join(' ');

export interface DecisionResult {
  actions: Array<{ name: string; input: unknown }>;
  tokens: number;
}

export async function decideActions(ctx: AgentContext): Promise<DecisionResult> {
  if (!config.agent.apiKey) return { actions: [], tokens: 0 };
  const client = new Anthropic({ apiKey: config.agent.apiKey });

  const res = await client.messages.create({
    model: config.agent.decisionModel,
    max_tokens: 2048,
    system: SYSTEM,
    tools: ACTION_TOOLS as unknown as Anthropic.Tool[],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `Estado atual da fila e dos nós (sem conteúdo):\n${JSON.stringify(ctx)}` }],
  });

  const actions = res.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ name: b.name, input: b.input }));
  const tokens = (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0);
  return { actions, tokens };
}
