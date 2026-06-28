# Guardrails do Agente — o supervisor NÃO lê prompts nem imagens

Requisito central: o agente LLM monitora jobs e dispara/reinicia trabalho, mas **nunca**
vê o conteúdo criativo (prompts, prompts negativos, imagens). A garantia é dada por
**código e teste de CI**, não por confiança no modelo.

## Quatro camadas

### (a) Projeção de entrada (allowlist)
Uma única função, `buildAgentContext()`, monta tudo que vai ao LLM a partir de uma
**allowlist de colunas sem conteúdo**. Os campos `prompts.texto_pos`, `prompts.texto_neg`
e `images.path` **nunca são selecionados**. Para o agente, um job é:

```json
{ "id": 412, "scene_ref": "s-77", "status": "error", "node_id": 3,
  "tentativas": 2, "erro_categoria": "OOM_VRAM", "traceback": "<sanitizado>" }
```

`scene_ref` é um identificador opaco — não carrega nome nem conteúdo da cena.

### (b) Sanitizador de traceback
Tracebacks do ComfyUI raramente contêm o prompt, mas por segurança todo texto de erro
passa por `sanitizeTraceback()` antes de chegar ao LLM:
- remove qualquer substring que case com um prompt conhecido do banco;
- remove strings citadas longas (heurística para texto livre);
- classifica o erro numa **categoria** (`OOM_VRAM`, `MODELO_AUSENTE`, `NODE_OFFLINE`,
  `TIMEOUT`, `DESCONHECIDO`). O agente decide pela categoria, não pelo texto cru.

### (c) Saída travada (allowlist de ações)
O LLM só pode escolher dentro de um conjunto fixo de ações; o executor **rejeita**
qualquer coisa fora dele:

```
dispatch_job(job_id, node_id)   retry_job(job_id)        mark_failed(job_id)
reprioritize(job_id, prioridade) pause_node(node_id)     resume_node(node_id)
restart_node(node_id)            escalate(mensagem)
```

Nenhuma ação aceita texto de prompt ou caminho de imagem como argumento. Toda decisão é
registrada em `agent_decisions` (ação, alvo, motivo, custo de tokens).

### (d) Teste de regressão no CI
`test/agent-guardrails.test.ts` roda a projeção sobre fixtures que contêm prompts e
caminhos de imagem reais e **falha o build** se qualquer um vazar para o payload. É a
trava que impede quebrar a garantia sem querer no futuro.

## Modelo
- Decisões via **Claude Opus 4.8** (`claude-opus-4-8`) por padrão, configurável em
  `AGENT_DECISION_MODEL` (troque por `claude-sonnet-4-6`/`claude-haiku-4-5` para reduzir
  custo). O health-check dos nós é **determinístico** (sem LLM): SSH + nvidia-smi +
  object_info, rodando na cadência `AGENT_HEALTH_MS`.

## Fluxo de decisão (Fase 6)
1. `buildAgentContext()` monta o estado redigido (sem conteúdo).
2. `decideActions()` envia ao Claude com tool-use; o modelo escolhe ações.
3. `validateAction()` rejeita ação fora da allowlist ou com qualquer chave estranha.
4. `executeAction()` aplica (DB/SSH) e registra em `agent_decisions`.

## Onde está no código
- `src/agent/context.ts` — `projectJobForAgent()`, `sanitizeTraceback()`, `buildAgentContext()`.
- `src/agent/claude.ts` — chamada ao Claude (tool-use), system prompt restritivo.
- `src/agent/actions.ts` — allowlist `ACTION_TOOLS`, `validateAction()`, `executeAction()`.
- `test/agent-guardrails.test.ts` — não-vazamento na entrada.
- `test/agent-actions.test.ts` — allowlist de saída barra ações/campos de conteúdo.
