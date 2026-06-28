import { describe, it, expect } from 'vitest';
import { isApiFormat, detectBindings, type ApiWorkflow } from '../src/workflow/parse';

// Workflow WAN 2.2 image-to-video reduzido, no formato API.
const wf: ApiWorkflow = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'wan2.2.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'mulher num piquenique', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'borrado, feio', clip: ['4', 1] } },
  '10': { class_type: 'LoadImage', inputs: { image: 'ref.png' } },
  '12': {
    class_type: 'LoraLoaderModelOnly',
    inputs: { lora_name: 'estilo.safetensors', strength_model: 0.8, model: ['4', 0] },
  },
  '20': {
    class_type: 'WanVideoSampler',
    inputs: {
      seed: 42,
      num_frames: 81,
      fps: 16,
      positive: ['6', 0],
      negative: ['7', 0],
      model: ['12', 0],
      image: ['10', 0],
    },
  },
};

describe('parser de workflow', () => {
  it('reconhece o formato API e rejeita o formato de UI', () => {
    expect(isApiFormat(wf)).toBe(true);
    expect(isApiFormat({ nodes: [], links: [], last_node_id: 0 })).toBe(false);
    expect(isApiFormat({})).toBe(false);
    expect(isApiFormat([])).toBe(false);
  });

  it('detecta prompts seguindo as conexões do sampler', () => {
    const { suggested } = detectBindings(wf);
    expect(suggested.prompt_pos).toEqual({ node: '6', input: 'text' });
    expect(suggested.prompt_neg).toEqual({ node: '7', input: 'text' });
  });

  it('detecta imagem, lora (nome+peso) e frames/fps', () => {
    const { suggested } = detectBindings(wf);
    expect(suggested.image).toEqual({ node: '10', input: 'image' });
    expect(suggested.loras).toEqual([
      { node: '12', name_input: 'lora_name', weight_input: 'strength_model' },
    ]);
    expect(suggested.frames).toEqual({ node: '20', input: 'num_frames' });
    expect(suggested.fps).toEqual({ node: '20', input: 'fps' });
  });

  it('lista nós com seus inputs editáveis (literais)', () => {
    const { nodes } = detectBindings(wf);
    const sampler = nodes.find((n) => n.id === '20')!;
    const names = sampler.editableInputs.map((i) => i.name);
    expect(names).toContain('num_frames');
    expect(names).toContain('fps');
    expect(names).not.toContain('positive'); // conexão, não literal
  });

  it('workflow só de imagem (sem frames) gera aviso, não erro', () => {
    const flux: ApiWorkflow = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux.safetensors' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'um gato', clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'feio', clip: ['1', 1] } },
      '4': {
        class_type: 'KSampler',
        inputs: { positive: ['2', 0], negative: ['3', 0], model: ['1', 0] },
      },
    };
    const { suggested, warnings } = detectBindings(flux);
    expect(suggested.prompt_pos).toEqual({ node: '2', input: 'text' });
    expect(suggested.frames).toBeUndefined();
    expect(warnings.some((w) => /frames/i.test(w))).toBe(true);
  });
});
