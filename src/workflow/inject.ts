/**
 * Injeção dos valores efetivos nos nós do workflow.
 *
 * Recebe o template (formato API), os bindings (mapa papel→nó/input) e os parâmetros
 * efetivos do job; devolve um NOVO workflow pronto para POST /prompt no ComfyUI.
 * Função pura, testada.
 */
import type { ApiWorkflow, Bindings } from './parse.js';

export interface InjectParams {
  texto_pos: string;
  texto_neg: string | null;
  imageName: string | null;        // nome do arquivo já enviado ao ComfyUI (LoadImage)
  loras: Array<{ lora_nome: string; peso: number }>;
  frames: number | null;
  fps: number | null;
}

function setInput(wf: ApiWorkflow, node: string | undefined, input: string | undefined, value: unknown) {
  if (!node || !input) return;
  if (!wf[node]) return;
  wf[node].inputs[input] = value as never;
}

export function buildPrompt(template: ApiWorkflow, bindings: Bindings, p: InjectParams): ApiWorkflow {
  const wf: ApiWorkflow = JSON.parse(JSON.stringify(template)); // clone profundo

  setInput(wf, bindings.prompt_pos?.node, bindings.prompt_pos?.input, p.texto_pos);
  if (p.texto_neg != null) setInput(wf, bindings.prompt_neg?.node, bindings.prompt_neg?.input, p.texto_neg);
  if (p.imageName) setInput(wf, bindings.image?.node, bindings.image?.input, p.imageName);
  if (p.frames != null) setInput(wf, bindings.frames?.node, bindings.frames?.input, p.frames);
  if (p.fps != null) setInput(wf, bindings.fps?.node, bindings.fps?.input, p.fps);

  // LoRAs: aplica por índice sobre os loaders mapeados (até o menor comprimento).
  const loraBindings = bindings.loras ?? [];
  for (let i = 0; i < Math.min(loraBindings.length, p.loras.length); i++) {
    const lb = loraBindings[i];
    const spec = p.loras[i];
    setInput(wf, lb.node, lb.name_input, spec.lora_nome);
    setInput(wf, lb.node, lb.weight_input, spec.peso);
  }

  return wf;
}
