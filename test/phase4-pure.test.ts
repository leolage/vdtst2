import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/shared/crypto';
import { buildPrompt } from '../src/workflow/inject';
import { selectNode, type NodeState } from '../src/worker/router';
import { extractFramesArgs, concatListContent, toShellCommand } from '../src/worker/ffmpeg';
import type { ApiWorkflow, Bindings } from '../src/workflow/parse';

const KEY = '414c704210ec666a90a6dd2893d22e183a4748b4c5f8f6ed64abd82422b877c5';

describe('cripto das chaves SSH', () => {
  it('round-trip encrypt/decrypt', () => {
    const secret = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----';
    const blob = encryptSecret(secret, KEY);
    expect(blob).not.toContain('BEGIN');
    expect(decryptSecret(blob, KEY)).toBe(secret);
  });
  it('chave errada falha (GCM autentica)', () => {
    const blob = encryptSecret('x', KEY);
    const outra = '0'.repeat(64);
    expect(() => decryptSecret(blob, outra)).toThrow();
  });
});

describe('injeção no workflow', () => {
  const template: ApiWorkflow = {
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'velho', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'neg', clip: ['4', 1] } },
    '10': { class_type: 'LoadImage', inputs: { image: 'antiga.png' } },
    '12': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'a', strength_model: 0.5 } },
    '20': { class_type: 'WanVideoSampler', inputs: { num_frames: 49, fps: 12, positive: ['6', 0], negative: ['7', 0] } },
  };
  const bindings: Bindings = {
    prompt_pos: { node: '6', input: 'text' },
    prompt_neg: { node: '7', input: 'text' },
    image: { node: '10', input: 'image' },
    loras: [{ node: '12', name_input: 'lora_name', weight_input: 'strength_model' }],
    frames: { node: '20', input: 'num_frames' },
    fps: { node: '20', input: 'fps' },
  };

  it('injeta prompts, imagem, lora, frames e fps sem mutar o template', () => {
    const wf = buildPrompt(template, bindings, {
      texto_pos: 'mulher saindo do carro', texto_neg: 'ruim', imageName: 'frame-0042.png',
      loras: [{ lora_nome: 'estilo', peso: 0.9 }], frames: 81, fps: 16,
    });
    expect(wf['6'].inputs.text).toBe('mulher saindo do carro');
    expect(wf['7'].inputs.text).toBe('ruim');
    expect(wf['10'].inputs.image).toBe('frame-0042.png');
    expect(wf['12'].inputs.lora_name).toBe('estilo');
    expect(wf['12'].inputs.strength_model).toBe(0.9);
    expect(wf['20'].inputs.num_frames).toBe(81);
    expect(wf['20'].inputs.fps).toBe(16);
    // template intacto
    expect(template['6'].inputs.text).toBe('velho');
  });
});

describe('roteamento de nó', () => {
  const base: NodeState = { id: 1, status: 'up', max_concurrent: 2, queue_len: 0, vram_free: 24000, loras: ['estilo'], modelos: ['wan2.2'] };
  it('escolhe nó up, capaz e com vaga; menor fila', () => {
    const nodes: NodeState[] = [
      { ...base, id: 1, queue_len: 2 },
      { ...base, id: 2, queue_len: 0 },
    ];
    const r = selectNode(nodes, { loras: ['estilo'], modelo: 'wan2.2' });
    expect(r).toEqual({ ok: true, nodeId: 2 });
  });
  it('bloqueia por falta de lora', () => {
    const r = selectNode([base], { loras: ['inexistente'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.categoria).toBe('SEM_CAPACIDADE');
  });
  it('bloqueia quando todos offline', () => {
    const r = selectNode([{ ...base, status: 'down' }], { loras: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.categoria).toBe('NODE_OFFLINE');
  });
});

describe('comandos ffmpeg', () => {
  it('extração com fps de amostragem', () => {
    expect(extractFramesArgs({ input: '/v/video.mp4', outDir: '/v/frames', fps: 8, format: 'png' }))
      .toEqual(['-y', '-i', '/v/video.mp4', '-vf', 'fps=8', '/v/frames/frame-%04d.png']);
  });
  it('extração sem fps pega todos os frames', () => {
    const a = extractFramesArgs({ input: '/v/v.mp4', outDir: '/v/f' });
    expect(a).not.toContain('-vf');
  });
  it('lista de concat e shell-quote', () => {
    expect(concatListContent(['/a/seg-000.mp4', '/a/seg-001.mp4'])).toContain("file '/a/seg-000.mp4'");
    expect(toShellCommand('ffmpeg', ['-i', '/com espaço/v.mp4'])).toContain("'/com espaço/v.mp4'");
  });
});
