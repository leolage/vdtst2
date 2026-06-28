/**
 * Resolve os parâmetros EFETIVOS de geração de um job = base da cena/prompt sobreposta
 * pelos overrides do reenvio. É o que a tela de detalhe mostra e o que o worker (Fase 4)
 * injeta no workflow. Função pura, testada.
 */

export interface LoraSpec {
  lora_nome: string;
  peso: number;
}

export interface GenBase {
  texto_pos: string;
  texto_neg: string | null;
  image_id: number | null;
  loras: LoraSpec[];
  frames: number | null;
  fps: number | null;
  segmento_idx: number;
}

export interface GenOverrides {
  texto_pos?: string;
  texto_neg?: string | null;
  image_id?: number | null;
  loras?: LoraSpec[];      // substitui o conjunto inteiro quando presente
  frames?: number | null;
  fps?: number | null;
  segmento_idx?: number;
}

export function resolveEffective(base: GenBase, overrides?: GenOverrides | null): GenBase {
  const o = overrides ?? {};
  return {
    texto_pos: o.texto_pos ?? base.texto_pos,
    texto_neg: o.texto_neg !== undefined ? o.texto_neg : base.texto_neg,
    image_id: o.image_id !== undefined ? o.image_id : base.image_id,
    loras: o.loras !== undefined ? o.loras : base.loras,
    frames: o.frames !== undefined ? o.frames : base.frames,
    fps: o.fps !== undefined ? o.fps : base.fps,
    segmento_idx: o.segmento_idx ?? base.segmento_idx,
  };
}
