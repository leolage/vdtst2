# Roadmap de melhorias futuras

Itens além das 7 fases de construção descritas em [ARCHITECTURE.md](./ARCHITECTURE.md).
Ordenados por valor/esforço aproximado, não é compromisso de cronograma.

## Notificações (Telegram) — **em andamento**
Bot que envia ao seu grupo:
- **Vídeo novo** assim que um job conclui (evento, disparado pelo worker — Fase 4/6).
- **Erros de job** quando um job falha (evento, disparado pelo agente — Fase 6).
- **Status da fila de hora em hora** (cron — `wan-cron`, já no esqueleto).

Já entregue nesta etapa: módulo `src/notify/telegram.ts` (sendMessage/sendVideo +
atalhos `notify.videoPronto/erroJob/statusFila`), serviço `wan-cron` com o resumo
horário alinhado ao início da hora, config (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) e
unidade systemd `wan-cron.service`. Falta só **plugar os gatilhos de evento** quando
worker (Fase 4) e agente (Fase 6) existirem, e criar o bot no @BotFather.

Evoluções possíveis: botões inline para **aprovar/reprovar** vídeo direto no Telegram;
escolher quais eventos notificar; digest diário; outros canais (e-mail, Discord, webhook).

## Geração de imagens com Flux (ideia)
Um modo para gerar imagens com **Flux** dentro do mesmo sistema. Encaixa no modelo atual:
é só mais um workflow do ComfyUI (upload → binding de nós → jobs em lote), então o
core (projects/workflow_json/node_bindings/jobs/agente/multi-nó) **não precisa mudar**.

Pontos de design a manter em mente desde já, para não fechar a porta:
- **Tipo de projeto**: marcar projeto/workflow como `video` ou `imagem` (ex.: coluna
  `tipo` em `projects`). O worker pula o stitch ffmpeg e a lógica de segmentos quando for
  imagem.
- **Saída**: `outputs` ganha um `tipo` (`video`/`imagem`); a galeria já lista os dois.
- **Binding genérico**: o parser de nós (Fase 2) deve ser agnóstico ao modelo — detectar
  `CLIPTextEncode`/`LoadImage`/sampler funciona igual para Flux; só os nós de frames/fps
  do WAN ficam ausentes (binding opcional).
- **Sinergia forte**: imagens geradas pelo Flux podem **popular a biblioteca por
  categoria** e virar input das cenas de vídeo WAN — fechar o ciclo "gerar referência →
  animar". Vale prever um destino "salvar na categoria X" para a saída de imagem.

Por enquanto é só ideia; nenhuma tabela muda agora. Quando desenvolvermos a Fase 2/3,
seguimos esses ganchos para o suporte a Flux sair quase de graça.

## Painel de observabilidade
Métricas de throughput (vídeos/hora por nó), tempo médio por segmento, taxa de erro por
categoria, ocupação de GPU. Gráficos na UI + export Prometheus opcional.

## Resiliência e custos do agente
- Cache de decisões repetidas para reduzir chamadas ao LLM.
- Modo "degradado" 100% por regras se a API do Claude estiver indisponível.
- Orçamento de tokens por dia com alerta.

## Biblioteca de imagens mais rica
- Upload em lote + geração de thumbnails automática.
- Tags e busca; deduplicação por hash.
- Seleção ponderada por tag dentro da categoria (ex.: 70% "dia", 30% "noite").

## Workflows e templates
- Versionamento de workflow (homologar v2 sem quebrar projetos da v1).
- Presets de LoRA reutilizáveis entre cenas/projetos.
- Validação prévia: checar se os nós exigidos existem em pelo menos um servidor.

## Pós-processamento de vídeo
- Trilha sonora / narração por cena.
- Legendas automáticas.
- Upscale/interpolação opcional como etapa final do pipeline.
- Montagem final concatenando cenas num episódio (a "novela" completa).

## Escala e operação
- Auto-descoberta de nós ComfyUI e drain/cordon para manutenção.
- Retentativa inteligente por categoria de erro (OOM → reduzir resolução/segmento).
- Backups automáticos do MariaDB e dos outputs.

## Segurança
- 2FA na borda (Cloudflare Access já cobre parte).
- Rotação das chaves SSH cifradas.
- Auditoria de ações do agente exposta na UI.
