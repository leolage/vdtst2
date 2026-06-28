# Arquitetura — WAN Studio

Gestor de criação de vídeos em lote com **WAN 2.2** rodando dentro do **ComfyUI**.
Você homologa workflows manualmente no ComfyUI, sobe para o sistema, e ele dispara
geração em lote — cada workflow vira um projeto; cada projeto tem cenas; cada cena
tem prompts, imagens (por categoria), LoRAs e segmentos.

## Visão geral

```
Você (externo) ─HTTPS─► Cloudflare ──túnel saída──► cloudflared (VM LAN)
                                                         │ http://127.0.0.1
                                                    nginx local ─► wan-web (Fastify)
                                                         │
        ┌────────────────────────────────────────────────┴───────────────┐
        │  Base de código TypeScript / Node 20                            │
        │                                                                 │
        │  wan-web     API REST + WebSocket + UI (galeria, agenda)        │
        │  wan-worker  monta workflow, submete ao ComfyUI, stitch ffmpeg  │
        │  wan-agent   supervisor LLM (decisões com guardrails)           │
        │  wan-tunnel  cloudflared                                        │
        └───────────────┬─────────────────────────────────┬──────────────┘
                        │ SSH (túnel + controle)           │
              ┌─────────▼─────────┐                  ┌─────▼──────┐
              │ ComfyUI remoto    │  (N servidores)  │  MariaDB   │
              │ WAN 2.2 / GPU     │                  └────────────┘
              └───────────────────┘
      Saídas → /var/lib/wan-studio/outputs  (servidas pela galeria na UI)
```

## Decisões de projeto

| Tema | Decisão | Motivo |
|------|---------|--------|
| Linguagem | Node 20 + TypeScript | Sistema é orquestração/cola; o trabalho pesado roda na GPU do ComfyUI. |
| Web | Fastify | Leve, rápido, WebSocket nativo, serve estáticos. |
| Banco | MariaDB via Knex | Migrations versionadas + query builder sem o peso de um ORM grande. |
| Fila | Tabela `jobs` no MariaDB (`FOR UPDATE SKIP LOCKED`) | Sem Redis/Docker; menos peças móveis. Migra para BullMQ só se o volume exigir. |
| Acesso externo | Cloudflare Tunnel (`cloudflared`) | VM em LAN sem IP público; sem port-forward; TLS na borda da Cloudflare. |
| GPUs | N servidores ComfyUI remotos | Acesso por túnel SSH; controle de processo por SSH. |
| Agente | LLM (Claude) com decisões + guardrails em código | Flexível, mas conteúdo (prompts/imagens) nunca entra no contexto do LLM. |
| Auth | Login único | Uso pessoal; reforçável com Cloudflare Access na borda. |
| Saídas | Disco local + galeria na UI | Player, thumbnails, aprovar/reprovar. |
| Deploy | systemd + nginx local + cloudflared | Linux puro, sem Docker. |

## Serviços (unidades systemd)

- **wan-web** — API + UI. Único processo que escuta HTTP (em `127.0.0.1`, atrás do nginx).
- **wan-worker** — consome `jobs`, monta o workflow a partir do template + bindings,
  submete ao nó ComfyUI escolhido, acompanha progresso por WebSocket, baixa a saída e
  concatena os segmentos com ffmpeg.
- **wan-agent** — loop de supervisão. Lê estado **redigido** (sem conteúdo), decide ações
  via tool-use do Claude, e o executor valida cada ação contra uma allowlist.
- **wan-cron** — tarefas agendadas. Hoje envia ao Telegram o **status da fila de hora em
  hora**; notificações de vídeo pronto e de erro são por evento (worker/agente).
- **wan-tunnel** — `cloudflared`, expõe o app pela Cloudflare.

## Modelo de domínio

```
users            (id, login, senha_hash)

projects         (id, nome, workflow_json, node_bindings_json, status)
scenes           (id, project_id, nome, ordem, categoria_id, segmentos, dur_segmento)
scene_loras      (id, scene_id, lora_nome, peso)
prompts          (id, scene_id, texto_pos, texto_neg, ordem)        -- CONTEÚDO
image_categories (id, nome, descricao)
images           (id, category_id, path, thumb_path, tags_json,
                  origem_output_id, origem_frame)                   -- CONTEÚDO + linhagem
                  -- origem_*: imagem promovida de um frame golden (encadeamento de cenas)
scene_images     (id, scene_id, image_id)                           -- seleção por cena

comfy_nodes      (id, nome, ssh_host, ssh_port, ssh_user, ssh_key_ref,
                  comfy_port, status, max_concurrent, vram_total, vram_free,
                  queue_len, modelos_json, loras_json, ultimo_health)

jobs             (id, project_id, scene_id, prompt_id, image_id, segmento_idx,
                  params_json, overrides_json, status[+waiting], prioridade, node_id,
                  comfy_prompt_id, output_path, erro_categoria, traceback,
                  tentativas, nota, observacao,            -- catálogo
                  chain_key, depende_de,                   -- encadeamento de segmentos
                  agendado_para, criado_em, iniciado_em, terminado_em)
schedules        (id, project_id, regra_json, ativo)
outputs          (id, job_id, scene_id, tipo, path, thumb_path, aprovado,
                  golden, frames_dir, frames_count, criado_em)
agent_decisions  (id, acao, alvo_json, motivo, custo_tokens, criado_em)
agent_events     (id, tipo, mensagem, job_id, criado_em)
```

**Um job = uma combinação** (cena × prompt × imagem × segmento). Agendar um projeto
"explode" automaticamente em dezenas de jobs — é o lote estilo novela.

Campos marcados **CONTEÚDO** (`prompts.texto_*`, `images.path`) nunca entram no
contexto do agente. Ver [AGENT-GUARDRAILS.md](./AGENT-GUARDRAILS.md).

## Multi-nó ComfyUI (SSH)

- A API HTTP/WebSocket do ComfyUI remoto é alcançada por **túnel SSH** (`ssh -L`),
  evitando expor a porta na rede.
- Health-poller combina `GET /system_stats` + `/queue` (pela API) com `nvidia-smi`
  (por SSH) para saber VRAM/saúde real.
- Controle de processo por SSH: `systemctl restart comfyui`, `tail` de log — permite ao
  agente **reiniciar** um nó travado, não só pausar.
- Roteamento: escolhe nó `up` com fila `< max_concurrent` **e** que possua o
  checkpoint/LoRA exigido pela cena (capacidade lida de `/object_info`). Sem capacidade →
  job fica `blocked` com motivo claro, em vez de falhar na GPU.
- Chaves SSH guardadas **cifradas at-rest**; `ssh_key_ref` aponta para o segredo.

## Armazenamento e extração de frames

Cada vídeo gerado é **baixado do ComfyUI** para uma pasta estruturada na VM, e dele são
**extraídos frames automaticamente** numa subpasta. Os frames servem para montar a
sequência/continuidade do vídeo (ex.: último frame de um segmento alimenta o próximo).

Layout (`src/shared/paths.ts`):

```
<DATA_DIR>/outputs/proj-<id>/scene-<id>/job-<id>/
    video.mp4              vídeo final (ou do segmento)
    segments/seg-NNN.mp4   segmentos brutos antes do stitch (opcional)
    frames/frame-NNNN.png  frames extraídos automaticamente
```

**A extração roda no servidor ComfyUI**, que é mais parrudo que a VM do sistema
(`FRAME_EXTRACT_ON_NODE=true`). Pipeline do worker (Fase 4):

1. submeter o workflow ao nó ComfyUI (via túnel SSH);
2. ao concluir, o vídeo está no host do ComfyUI;
3. por **SSH**, rodar `ffmpeg` no próprio host para extrair os frames para um diretório
   temporário (amostragem controlada por `FRAME_EXTRACT_FPS`; vazio = todos os frames);
4. **baixar** vídeo + frames para a pasta estruturada na VM (scp/rsync sobre SSH);
5. registrar em `outputs` (`path`, `frames_dir`, `frames_count`, `tipo`).

Isso mantém o trabalho pesado de ffmpeg na GPU/CPU do servidor remoto e deixa a VM só
com orquestração e armazenamento. (Fallback `FRAME_EXTRACT_ON_NODE=false` extrai na VM.)

## Fluxo de homologação do workflow

Resumo (detalhe em [WORKFLOW-BINDING.md](./WORKFLOW-BINDING.md)):

1. No ComfyUI: *Save (API Format)* exporta o workflow como JSON de nós.
2. Upload no sistema → vira um **Project (template)**.
3. Auto-detecção de nós editáveis por `class_type` (`CLIPTextEncode`, `LoadImage`,
   `LoraLoader*`, nós de frames/duração do WAN).
4. Você confirma o **binding** (qual nó é prompt+, prompt−, imagem, loras, frames).
5. Ao rodar, o worker clona o JSON e injeta os valores da cena/prompt/imagem/segmento.

## Roadmap

1. **Fundação** — TS/Fastify, Knex+migrations, login único, systemd/nginx/cloudflared, README. ← *esta fase*
2. **Ingestão de workflow** — upload, parser, auto-detecção, tela de binding.
3. **Domínio** — CRUD projects/scenes/prompts, biblioteca de imagens por categoria,
   explosão em jobs, catálogo (nota/observação), tela de debug com **reenvio ajustado**,
   e **encadeamento por frame golden** (promover frame → biblioteca → input da próxima cena).
4. **Multi-nó SSH + worker** ✅ — registro de nós (chave cifrada), túnel, health, roteamento,
   submissão, **extração de frames no nó remoto**, download para a pasta estruturada e
   notificação Telegram (vídeo pronto / erro).
5. **Galeria** ✅ — React/Vite em `/app`: player, golden, aprovar/reprovar, frames +
   promoção; mídia servida sob `/api/media` (protegida pela sessão).
6. **Agente LLM** ✅ — loop de decisão (Claude tool-use), allowlist de ações validada em
   código, health determinístico dos nós, auditoria em `agent_decisions`.
7. **Agendamento** ✅ — schedules por projeto (uma vez / intervalo), geração no tempo com
   `stagger` (espaçamento) e `max_fila` (teto), avaliados pelo `wan-cron` a cada minuto.
