import { describe, it, expect } from 'vitest';
import { ACTION_TOOLS, validateAction } from '../src/agent/actions';

const FORBIDDEN = ['texto_pos', 'texto_neg', 'image', 'image_id', 'path', 'prompt', 'workflow'];

describe('guardrail de saída do agente (allowlist de ações)', () => {
  it('nenhum schema de ação expõe campo de conteúdo', () => {
    for (const tool of ACTION_TOOLS) {
      const props = Object.keys(tool.input_schema.properties);
      for (const f of FORBIDDEN) expect(props).not.toContain(f);
    }
  });

  it('aceita ações válidas só com metadados', () => {
    expect(validateAction('retry_job', { job_id: 5, motivo: 'OOM transitório' }).ok).toBe(true);
    expect(validateAction('reprioritize', { job_id: 5, prioridade: 10 }).ok).toBe(true);
    expect(validateAction('escalate', { mensagem: 'nó 3 offline há 10min' }).ok).toBe(true);
  });

  it('rejeita ação desconhecida', () => {
    const r = validateAction('rewrite_prompt', { job_id: 1 });
    expect(r.ok).toBe(false);
  });

  it('rejeita qualquer tentativa de passar conteúdo, mesmo numa ação válida', () => {
    for (const f of FORBIDDEN) {
      const r = validateAction('retry_job', { job_id: 1, [f]: 'algo' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('não permitido');
    }
  });
});
