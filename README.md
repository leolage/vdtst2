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

## Estado atual: Fase 1 (fundação)
Já funciona: servidor Fastify, login único, migrations de **todo** o schema, esqueletos
de worker e agente, guardrails de entrada do agente + teste de regressão, e configs de
deploy (systemd / nginx / cloudflared). Próximas fases no roadmap em `docs/ARCHITECTURE.md`.

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
npm ci && npm run build
npm run migrate
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl enable --now wan-web wan-worker wan-agent wan-cron wan-tunnel
```

Passo a passo completo em [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
