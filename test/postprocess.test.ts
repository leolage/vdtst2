import { describe, it, expect } from 'vitest';
import { addAudioArgs, burnSubsArgs, scaleArgs, interpolateArgs, stepArgs } from '../src/worker/postprocess';

describe('construtores de pós-processamento', () => {
  it('muxa áudio mantendo o vídeo (copy)', () => {
    const a = addAudioArgs('/v/final.mp4', '/a/trilha.mp3', '/v/out.mp4');
    expect(a).toContain('-shortest');
    expect(a.join(' ')).toContain('-c:v copy');
    expect(a.join(' ')).toContain('-c:a aac');
  });

  it('queima legendas', () => {
    expect(burnSubsArgs('/v/f.mp4', '/s/legenda.srt', '/v/o.mp4').join(' ')).toContain('-vf subtitles=/s/legenda.srt');
  });

  it('upscale com h=-2 mantém proporção', () => {
    expect(scaleArgs('/v/f.mp4', 1920, -2, '/v/o.mp4').join(' ')).toContain('-vf scale=1920:-2');
  });

  it('interpolação de fps', () => {
    expect(interpolateArgs('/v/f.mp4', 60, '/v/o.mp4').join(' ')).toContain('minterpolate=fps=60');
  });

  it('stepArgs despacha por tipo', () => {
    expect(stepArgs('/v/f.mp4', { tipo: 'scale', w: 1280, h: 720 }, '/v/o.mp4').join(' ')).toContain('scale=1280:720');
    expect(stepArgs('/v/f.mp4', { tipo: 'audio', asset: '/a/x.mp3' }, '/v/o.mp4')).toContain('/a/x.mp3');
  });
});
