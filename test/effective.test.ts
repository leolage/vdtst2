import { describe, it, expect } from 'vitest';
import { resolveEffective, type GenBase } from '../src/domain/effective';

const base: GenBase = {
  texto_pos: 'homem abre a porta do carro',
  texto_neg: 'borrado',
  image_id: 100,
  loras: [{ lora_nome: 'estilo', peso: 0.8 }],
  frames: 81,
  fps: 16,
  segmento_idx: 0,
};

describe('parâmetros efetivos (base + overrides)', () => {
  it('sem overrides devolve a base', () => {
    expect(resolveEffective(base, null)).toEqual(base);
  });

  it('override troca prompt e peso de lora, mantém o resto', () => {
    const eff = resolveEffective(base, {
      texto_pos: 'mulher saindo do carro',
      loras: [{ lora_nome: 'estilo', peso: 1.0 }],
    });
    expect(eff.texto_pos).toBe('mulher saindo do carro');
    expect(eff.loras[0].peso).toBe(1.0);
    expect(eff.frames).toBe(81); // intacto
  });

  it('override pode zerar texto_neg e trocar imagem (encadeamento por frame)', () => {
    const eff = resolveEffective(base, { texto_neg: null, image_id: 250 });
    expect(eff.texto_neg).toBeNull();
    expect(eff.image_id).toBe(250);
  });
});
