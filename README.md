# WAN Studio

Gestor de criação de vídeos em lote com **WAN 2.2** rodando no **ComfyUI**.

Você homologa workflows manualmente no ComfyUI, sobe para o sistema, e ele dispara a
geração em lote: cada workflow é um **projeto**; cada projeto tem **cenas**; cada cena
tem **prompts**, **imagens** (organizadas por categoria), **LoRAs** (nome + peso) e
**segmentos** (quantidade e duração). Um agente LLM supervisiona os jobs e dispara/
reinicia trabalho — sem nunca ler prompts ou imagens.

> **Documentação de arquitetura:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
> · Guardrails do agente: [`docs/AGENT-GUARDRAILS.md`](docs/AGENT-GUARDRAILS.md)
> · Binding de workflow: [`docs/WORKFLOW-BINDING.md`](docs/WORKFLOW-BINDING.md)
> · Deploy na VM: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
> · Domínio (cenas/catálogo/encadeamento): [`docs/DOMAIN.md`](docs/DOMAIN.md)
> · Melhorias futuras: [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Stack
Node 20 + TypeScript · Fastify · MariaDB (Knex) · fila no próprio banco · Cloudflare
Tunnel para acesso externo · nós ComfyUI remotos via SSH · systemd · nginx local.

## Serviços
| systemd | entry | função |
|---------|-------|--------|
| `wan-web`    | `dist/server/index.js` | API REST + WebSocket + UI |
| `wan-worker` | `dist/worker/index.js` | executa jobs no ComfyUI |
| `wan-agent`  | `dist/agent/index.js`  | supervisor LLM (guardrails) |
| `wan-cron`   | `dist/notify/cron.js`  | notificações Telegram (status da fila/hora) |
| `wan-tunnel` | `cloudflared`          | acesso externo via Cloudflare |

## Estado atual: Fases 1–3
- **Fase 1** — Fastify, login único, migrations, esqueletos de worker/agente, guardrails + CI.
- **Fase 2** — upload de workflow (formato API), parser e auto-detecção, tela de binding.
- **Fase 3** — cenas/prompts/LoRAs, biblioteca de imagens por categoria, explosão de jobs,
  catálogo com nota, tela de **debug + reenvio ajustado** e **encadeamento por frame golden**.
- **Fase 4** — multi-nó SSH (chave cifrada, túnel, health por nvidia-smi/object_info),
  roteamento por capacidade/carga, worker que injeta no workflow, submete ao ComfyUI,
  baixa o vídeo, **extrai frames no nó remoto** e notifica o Telegram (vídeo/erro).
- **Fase 5** — galeria em **React/Vite** (`/app`): player, ⭐golden, aprovar/reprovar,
  tira de frames com promoção para a biblioteca; mídia servida sob `/api/media`.
- **Fase 6** — agente LLM (Claude tool-use) que dispara/retry/reprioriza jobs e
  pausa/reinicia nós, com **allowlist de ações validada em código** (nunca toca conteúdo)
  e auditoria; health dos nós determinístico.

Próxima: **Fase 7** (agendamento automático estilo novela).
Detalhes em `docs/ARCHITECTURE.md`.

### Desenvolvimento do frontend
`npm run dev:ui` sobe o Vite (proxy de `/api` para `127.0.0.1:3000`); `npm run build:ui`
gera `web/app` servido pelo Fastify.

## Desenvolvimento

```bash
npm install
cp .env.example .env        # ajuste DB_* e SESSION_SECRET
npm run migrate             # cria as tabelas no MariaDB
npm run create-user -- admin minhaSenha
npm run dev:web             # http://127.0.0.1:3000
npm test                    # roda o teste de guardrails
```

## Produção (resumo)

```bash
npm ci && npm run build && npm run build:ui   # servidor + galeria React (web/app)
npm run migrate
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl enable --now wan-web wan-worker wan-agent wan-cron wan-tunnel
```

Passo a passo completo em [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
