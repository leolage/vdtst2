# Domínio: cenas, jobs, catálogo e encadeamento

## Explosão de cena em jobs (lote "novela")
Uma cena tem N prompts, M imagens e S segmentos. Ao **gerar jobs**, o sistema cria
`N × max(M,1) × S` jobs — cada um uma combinação (prompt × imagem × segmento). Sem imagem,
é uma passada text-to-video. Lógica pura em `src/domain/jobs.ts` (`explodeScene`).

## Catálogo (o que deu certo e o que não)
Cada **job** pode receber `nota` (1–5) e `observacao`. A view `/api/catalog` reúne os jobs
avaliados ou com erro, ordenados por nota — seu histórico do que funciona. Erros já entram
no catálogo automaticamente (via `erro_categoria`).

## Cenas golden e encadeamento por frame
Quando um vídeo fica perfeito, marque o **output como `golden`**. Para continuar a história
a partir dele:

1. **Promover um frame** do vídeo golden para a biblioteca de imagens
   (`POST /api/outputs/:id/promote-frame` com o nome do frame, ex.: `frame-0042.png`).
   A imagem criada guarda a **linhagem** (`origem_output_id`, `origem_frame`).
2. **Usar essa imagem** como input de uma nova cena (seleção de imagens da cena).
3. Gerar o próximo vídeo com o novo prompt.

### Exemplo (casal)
- Cena 1: "homem abre a porta do carro para a mulher" → fica golden.
- Promovo um frame dela em pé ao lado do carro → vira imagem na biblioteca.
- Cena 2 usa esse frame como input, prompt "mulher saindo do carro" → novo vídeo.
- Promovo um frame da cena 2 → input da Cena 3, prompt "mulher entrando no prédio".

O encadeamento reaproveita a biblioteca de imagens — nenhum mecanismo paralelo.

## Tela de debug + reenvio ajustado
Cada job tem um **detalhe** (`GET /api/jobs/:id/detail`) com tudo da geração: projeto,
bindings do workflow, cena, prompt, imagem, LoRAs e os **parâmetros efetivos**
(base da cena/prompt sobreposta por `overrides_json`).

Para iterar, **reenvie com ajustes** (`POST /api/jobs/:id/resubmit`): você muda prompt,
pesos de LoRA, frames/fps ou troca a imagem, e o sistema cria um **novo job** (o original e
sua nota ficam preservados no catálogo). A fusão base+overrides é pura e testada em
`src/domain/effective.ts`.
