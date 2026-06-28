# Homologação e binding de workflows WAN 2.2

Esta é a parte mais sensível: transformar um workflow homologado no ComfyUI em um
template parametrizável.

## 1. Exportar do ComfyUI
No ComfyUI, habilite *Settings → Enable Dev mode options* e use **Save (API Format)**.
Isso gera um JSON onde cada chave é um `node_id` e o valor tem `class_type` + `inputs`:

```json
{
  "6":  { "class_type": "CLIPTextEncode",  "inputs": { "text": "...", "clip": ["4", 1] } },
  "7":  { "class_type": "CLIPTextEncode",  "inputs": { "text": "...", "clip": ["4", 1] } },
  "10": { "class_type": "LoadImage",       "inputs": { "image": "ref.png" } },
  "12": { "class_type": "LoraLoaderModelOnly", "inputs": { "lora_name": "x.safetensors", "strength_model": 1.0 } },
  "20": { "class_type": "WanVideoSampler", "inputs": { "num_frames": 81, "...": "..." } }
}
```

> O formato *API* é diferente do *workflow* salvo normal (que guarda layout do grafo).
> Sempre use o **API format** para subir ao sistema.

## 2. Upload → Project
O JSON é guardado em `projects.workflow_json`. O sistema roda o **parser**
(`src/workflow/parse.ts`, Fase 2) que lista os nós e propõe um binding inicial por
`class_type`.

## 3. Auto-detecção
| Papel | `class_type` típico | Campo do input |
|-------|---------------------|----------------|
| Prompt positivo | `CLIPTextEncode` (1º / mais conectado ao positivo) | `text` |
| Prompt negativo | `CLIPTextEncode` (conectado ao negativo do sampler) | `text` |
| Imagem de entrada | `LoadImage`, `VHS_LoadImagePath` | `image` |
| LoRA + peso | `LoraLoader`, `LoraLoaderModelOnly` | `lora_name`, `strength_model` |
| Nº de frames / duração | `WanVideoSampler` / nó de length do WAN | `num_frames`, `fps` |

Como dois `CLIPTextEncode` são indistinguíveis só pela classe, a detecção segue as
conexões do sampler (`positive`/`negative`) para decidir qual é qual. O resultado é uma
sugestão — você confirma.

## 4. Binding (confirmação)
O `node_bindings_json` final mapeia papéis → `node_id` + caminho do input:

```json
{
  "prompt_pos": { "node": "6",  "input": "text" },
  "prompt_neg": { "node": "7",  "input": "text" },
  "image":      { "node": "10", "input": "image" },
  "loras":      [ { "node": "12", "name_input": "lora_name", "weight_input": "strength_model" } ],
  "frames":     { "node": "20", "input": "num_frames" },
  "fps":        { "node": "20", "input": "fps" }
}
```

## 5. Render (injeção)
Ao processar um job, o worker (Fase 4):
1. clona `workflow_json`;
2. injeta `prompt.texto_pos` em `bindings.prompt_pos`, etc.;
3. injeta a imagem da cena, os LoRAs (nome+peso) e os frames do segmento;
4. submete em `POST /prompt` do nó ComfyUI escolhido;
5. acompanha por WebSocket; ao terminar, baixa de `/history/{prompt_id}`.

## Segmentos
- `scenes.segmentos` = quantas execuções; `scenes.dur_segmento` define os frames por
  execução (frames = `dur_segmento * fps`).
- Para vídeo encadeado, o workflow deve aceitar a continuidade (ex.: último frame do
  segmento anterior como imagem de entrada do próximo) — isso é decidido no desenho do
  workflow durante a homologação.
- No fim, **ffmpeg** concatena os segmentos no vídeo final da cena.
