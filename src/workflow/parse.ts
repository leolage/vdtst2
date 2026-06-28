/**
 * Parser de workflows do ComfyUI no formato **API** (Save (API Format)).
 *
 * O formato API é um mapa { node_id: { class_type, inputs } }. Um input cujo valor é um
 * array [node_id, slot] é uma *conexão*; um valor escalar é um *widget* (valor literal).
 *
 * Aqui detectamos os nós editáveis e propomos um binding inicial. Tudo são funções puras,
 * cobertas por test/workflow-parse.test.ts.
 */

export interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}
export type ApiWorkflow = Record<string, ApiNode>;

export interface NodeRef {
  node: string;
  input: string;
}
export interface LoraBinding {
  node: string;
  name_input: string;
  weight_input: string;
}
export interface Bindings {
  prompt_pos?: NodeRef;
  prompt_neg?: NodeRef;
  image?: NodeRef;
  loras: LoraBinding[];
  frames?: NodeRef;
  fps?: NodeRef;
}

export interface EditableInput {
  name: string;
  value: string | number | boolean;
}
export interface NodeSummary {
  id: string;
  class_type: string;
  title?: string;
  editableInputs: EditableInput[];
}

export interface ParseResult {
  nodes: NodeSummary[];
  suggested: Bindings;
  warnings: string[];
}

const FRAME_INPUTS = ['num_frames', 'frames', 'frame_count', 'length', 'video_length', 'num_frame'];
const FPS_INPUTS = ['fps', 'frame_rate', 'framerate'];

function isLink(v: unknown): v is [string, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
}
function isLiteral(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** Verifica se o JSON é mesmo formato API (e não o formato de UI com nodes[]/links[]). */
export function isApiFormat(obj: unknown): obj is ApiWorkflow {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  if ('nodes' in o && 'links' in o) return false; // formato de UI
  const entries = Object.entries(o);
  if (entries.length === 0) return false;
  return entries.every(
    ([, v]) => v && typeof v === 'object' && 'class_type' in (v as object) && 'inputs' in (v as object),
  );
}

/** Sobe pelas conexões a partir de um nó até achar o CLIPTextEncode mais próximo. */
function findPromptNode(wf: ApiWorkflow, startId: string): string | undefined {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id) || depth > 10) continue;
    visited.add(id);
    const node = wf[id];
    if (!node) continue;
    if (/CLIPTextEncode/i.test(node.class_type)) return id;
    for (const v of Object.values(node.inputs)) {
      if (isLink(v)) queue.push({ id: v[0], depth: depth + 1 });
    }
  }
  return undefined;
}

function editableInputs(node: ApiNode): EditableInput[] {
  const out: EditableInput[] = [];
  for (const [name, value] of Object.entries(node.inputs)) {
    if (isLiteral(value)) out.push({ name, value });
  }
  return out;
}

/** Detecta bindings sugeridos e monta o resumo dos nós. */
export function detectBindings(wf: ApiWorkflow): ParseResult {
  const warnings: string[] = [];
  const suggested: Bindings = { loras: [] };

  // 1) Samplers: nós com inputs 'positive' e 'negative' conectados (robusto ao nome da classe).
  const samplers = Object.entries(wf).filter(
    ([, n]) => isLink(n.inputs.positive) && isLink(n.inputs.negative),
  );
  if (samplers.length === 0) {
    warnings.push('Nenhum sampler com positive/negative encontrado; prompts não detectados automaticamente.');
  } else {
    if (samplers.length > 1) warnings.push(`Mais de um sampler (${samplers.length}); usando o primeiro.`);
    const [, sampler] = samplers[0];
    const posStart = (sampler.inputs.positive as [string, number])[0];
    const negStart = (sampler.inputs.negative as [string, number])[0];
    const posNode = findPromptNode(wf, posStart);
    const negNode = findPromptNode(wf, negStart);
    if (posNode) suggested.prompt_pos = { node: posNode, input: 'text' };
    else warnings.push('Prompt positivo não localizado a partir do sampler.');
    if (negNode) suggested.prompt_neg = { node: negNode, input: 'text' };
    else warnings.push('Prompt negativo não localizado a partir do sampler.');
  }

  // 2) Imagem de entrada
  const imageNode = Object.entries(wf).find(
    ([, n]) => /LoadImage/i.test(n.class_type) && 'image' in n.inputs,
  );
  if (imageNode) suggested.image = { node: imageNode[0], input: 'image' };

  // 3) LoRAs (nome + peso)
  for (const [id, n] of Object.entries(wf)) {
    if (!/Lora/i.test(n.class_type)) continue;
    const nameInput = 'lora_name' in n.inputs ? 'lora_name' : Object.keys(n.inputs).find((k) => /name/i.test(k));
    const weightInput =
      'strength_model' in n.inputs ? 'strength_model' : Object.keys(n.inputs).find((k) => /strength|weight/i.test(k));
    if (nameInput && weightInput) {
      suggested.loras.push({ node: id, name_input: nameInput, weight_input: weightInput });
    }
  }

  // 4) Frames e fps (por nome do input literal)
  for (const [id, n] of Object.entries(wf)) {
    if (!suggested.frames) {
      const f = FRAME_INPUTS.find((k) => k in n.inputs && typeof n.inputs[k] === 'number');
      if (f) suggested.frames = { node: id, input: f };
    }
    if (!suggested.fps) {
      const f = FPS_INPUTS.find((k) => k in n.inputs && typeof n.inputs[k] === 'number');
      if (f) suggested.fps = { node: id, input: f };
    }
  }
  if (!suggested.frames) {
    warnings.push('Nó de frames/duração não detectado (normal em workflows só de imagem, ex.: Flux).');
  }

  const nodes: NodeSummary[] = Object.entries(wf).map(([id, n]) => ({
    id,
    class_type: n.class_type,
    title: n._meta?.title,
    editableInputs: editableInputs(n),
  }));

  return { nodes, suggested, warnings };
}
