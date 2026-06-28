/**
 * Lógica de agendamento (pura, testada).
 *
 * Uma regra descreve QUANDO gerar jobs de um projeto e COMO espalhá-los no tempo —
 * é o que permite "agendar a novela": soltar cenas aos poucos, sem inundar a fila.
 */

export interface Regra {
  tipo: 'once' | 'interval';
  inicio: string;          // ISO — quando começa
  cada_min?: number;       // intervalo (tipo=interval)
  scene_ids?: number[];    // cenas-alvo; vazio = todas as cenas do projeto
  stagger_min?: number;    // espaçamento entre jobs gerados (agendado_para)
  max_fila?: number;       // não gera se a fila já tiver >= isso
}

/** Deve disparar agora? (agora e ultimoRun são injetados — funções puras.) */
export function deveRodar(regra: Regra, ultimoRun: Date | null, agora: Date): boolean {
  const inicio = new Date(regra.inicio);
  if (Number.isNaN(inicio.getTime())) return false;
  if (agora < inicio) return false;
  if (regra.tipo === 'once') return ultimoRun === null;
  if (regra.tipo === 'interval') {
    if (!regra.cada_min || regra.cada_min <= 0) return false;
    if (ultimoRun === null) return true;
    return agora.getTime() - ultimoRun.getTime() >= regra.cada_min * 60_000;
  }
  return false;
}

/** Próxima execução prevista (para exibir/registrar). null se não há próxima. */
export function proximoRun(regra: Regra, ultimoRun: Date | null, agora: Date): Date | null {
  const inicio = new Date(regra.inicio);
  if (Number.isNaN(inicio.getTime())) return null;
  if (regra.tipo === 'once') return ultimoRun ? null : inicio;
  if (regra.tipo === 'interval' && regra.cada_min && regra.cada_min > 0) {
    if (ultimoRun === null) return agora >= inicio ? agora : inicio;
    return new Date(ultimoRun.getTime() + regra.cada_min * 60_000);
  }
  return null;
}

/** Horários `agendado_para` para N jobs, espaçados por stagger_min a partir de agora. */
export function staggerTimes(count: number, staggerMin: number, agora: Date): Array<Date | null> {
  if (!staggerMin || staggerMin <= 0) return Array.from({ length: count }, () => null); // imediato
  return Array.from({ length: count }, (_, i) => new Date(agora.getTime() + i * staggerMin * 60_000));
}
