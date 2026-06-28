import { describe, it, expect } from 'vitest';
import { parseCapabilities, findOutputFile } from '../src/comfy/client';

describe('parse de capacidades (/object_info)', () => {
  it('extrai loras e checkpoints das listas de opções', () => {
    const info = {
      LoraLoader: { input: { required: { lora_name: [['a.safetensors', 'b.safetensors'], {}] } } },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['wan2.2.safetensors'], {}] } } },
    };
    const cap = parseCapabilities(info);
    expect(cap.loras).toEqual(['a.safetensors', 'b.safetensors']);
    expect(cap.modelos).toContain('wan2.2.safetensors');
  });
  it('nó ausente → listas vazias, sem quebrar', () => {
    expect(parseCapabilities({})).toEqual({ loras: [], modelos: [] });
  });
});

describe('localização do arquivo de saída (/history)', () => {
  it('acha vídeo em videos/gifs', () => {
    const entry = { outputs: { '9': { gifs: [{ filename: 'wan_0001.mp4', subfolder: 'video', type: 'output' }] } } };
    expect(findOutputFile(entry)).toEqual({ filename: 'wan_0001.mp4', subfolder: 'video', type: 'output' });
  });
  it('sem saída → null', () => {
    expect(findOutputFile({ outputs: {} })).toBeNull();
    expect(findOutputFile({})).toBeNull();
  });
});
