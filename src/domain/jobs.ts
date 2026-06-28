/**
 * Explosão de uma cena em jobs — o lote "estilo novela".
 *
 * Um job = uma combinação (prompt × imagem × segmento). Com várias prompts e imagens,
 * uma cena explode em dezenas de jobs automaticamente. Função pura, testada.
 *
 * Sobre segmentos: para a mesma combinação (prompt, imagem) geramos `segmentos` jobs com
 * `segmento_idx` 0..N-1. Eles rodam em sequência no worker (Fase 4), onde o último frame
 * de um segmento alimenta o próximo (continuidade). Aqui só semeamos as linhas.
 */

export interface ExplodeInput {
  projectId: number;
  sceneId: number;
  segmentos: number;
  promptIds: number[];
  imageIds: number[];
  prioridade?: number;
}

export interface JobSeed {
  project_id: number;
  scene_id: number;
  prompt_id: number;
  image_id: number | null;
  segmento_idx: number;
  prioridade: number;
  status: 'queued';
}

export function explodeScene(input: ExplodeInput): JobSeed[] {
  const segmentos = Math.max(1, Math.floor(input.segmentos || 1));
  const prioridade = input.prioridade ?? 100;
  if (input.promptIds.length === 0) return []; // sem prompt não há o que gerar
  // sem imagem → uma passada text-to-video (image_id null)
  const images: Array<number | null> = input.imageIds.length ? input.imageIds : [null];

  const jobs: JobSeed[] = [];
  for (const promptId of input.promptIds) {
    for (const imageId of images) {
      for (let seg = 0; seg < segmentos; seg++) {
        jobs.push({
          project_id: input.projectId,
          scene_id: input.sceneId,
          prompt_id: promptId,
          image_id: imageId,
          segmento_idx: seg,
          prioridade,
          status: 'queued',
        });
      }
    }
  }
  return jobs;
}

/** Quantidade prevista de jobs sem materializar (para prévia na UI). */
export function countJobs(input: Pick<ExplodeInput, 'segmentos' | 'promptIds' | 'imageIds'>): number {
  if (input.promptIds.length === 0) return 0;
  const imgs = input.imageIds.length || 1;
  return input.promptIds.length * imgs * Math.max(1, Math.floor(input.segmentos || 1));
}
