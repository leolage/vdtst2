import { describe, it, expect } from 'vitest';
import {
  projectJobForAgent,
  sanitizeTraceback,
  classifyError,
  type RawJobRow,
} from '../src/agent/context';

// Conteúdo criativo que JAMAIS pode vazar para o agente.
const PROMPT_POS = 'uma mulher num piquenique ao pôr do sol, fotorrealista, 8k';
const PROMPT_NEG = 'borrado, baixa qualidade, deformado';
const IMAGE_PATH = '/var/lib/wan-studio/inputs/igreja/foto-secreta-001.png';

const rawJob: RawJobRow = {
  id: 412,
  scene_id: 77,
  status: 'error',
  node_id: 3,
  tentativas: 2,
  prioridade: 100,
  erro_categoria: null,
  // simula o pior caso: o prompt e o caminho da imagem acabaram dentro do traceback
  traceback: `RuntimeError: CUDA out of memory ao processar "${PROMPT_POS}" usando ${IMAGE_PATH}`,
};

function payloadContemConteudo(obj: unknown): boolean {
  const s = JSON.stringify(obj);
  return s.includes(PROMPT_POS) || s.includes(PROMPT_NEG) || s.includes(IMAGE_PATH);
}

describe('guardrails de entrada do agente', () => {
  it('a visão segura do job NÃO contém prompt nem caminho de imagem', () => {
    const view = projectJobForAgent(rawJob);
    expect(payloadContemConteudo(view)).toBe(false);
    // mas mantém os metadados úteis
    expect(view.id).toBe(412);
    expect(view.scene_ref).toBe('s-77');
    expect(view.erro_categoria).toBe('OOM_VRAM');
    // scene_ref é opaco: não carrega o id cru exposto como número de cena
    expect(JSON.stringify(view)).not.toContain('"scene_id"');
  });

  it('classifica categorias de erro corretamente', () => {
    expect(classifyError('RuntimeError: CUDA out of memory')).toBe('OOM_VRAM');
    expect(classifyError('FileNotFoundError: checkpoint not found')).toBe('MODELO_AUSENTE');
    expect(classifyError('Error: connect ECONNREFUSED 127.0.0.1:8188')).toBe('NODE_OFFLINE');
    expect(classifyError('asyncio.TimeoutError: timed out')).toBe('TIMEOUT');
    expect(classifyError('algo estranho aconteceu')).toBe('DESCONHECIDO');
    expect(classifyError(null)).toBe(null);
  });

  it('o sanitizador remove prompts conhecidos e strings citadas longas', () => {
    const limpo = sanitizeTraceback(rawJob.traceback, [PROMPT_POS, PROMPT_NEG]);
    expect(limpo).not.toContain(PROMPT_POS);
    expect(limpo).toContain('«redigido»');
    // ainda informa a natureza do erro
    expect(limpo.toLowerCase()).toContain('out of memory');
  });
});
