import { describe, it, expect } from 'vitest';
import { deveRodar, proximoRun, staggerTimes, type Regra } from '../src/domain/schedule';

const t = (s: string) => new Date(s);

describe('agendamento', () => {
  it('once: roda uma vez após o início, depois nunca mais', () => {
    const r: Regra = { tipo: 'once', inicio: '2026-06-28T10:00:00Z' };
    expect(deveRodar(r, null, t('2026-06-28T09:59:00Z'))).toBe(false); // antes
    expect(deveRodar(r, null, t('2026-06-28T10:00:00Z'))).toBe(true);  // na hora
    expect(deveRodar(r, t('2026-06-28T10:00:00Z'), t('2026-06-28T11:00:00Z'))).toBe(false); // já rodou
    expect(proximoRun(r, t('2026-06-28T10:00:00Z'), t('2026-06-28T11:00:00Z'))).toBeNull();
  });

  it('interval: respeita cada_min a partir do último run', () => {
    const r: Regra = { tipo: 'interval', inicio: '2026-06-28T10:00:00Z', cada_min: 30 };
    expect(deveRodar(r, null, t('2026-06-28T10:00:00Z'))).toBe(true);   // primeira vez
    expect(deveRodar(r, t('2026-06-28T10:00:00Z'), t('2026-06-28T10:20:00Z'))).toBe(false); // só 20min
    expect(deveRodar(r, t('2026-06-28T10:00:00Z'), t('2026-06-28T10:30:00Z'))).toBe(true);  // 30min
    expect(proximoRun(r, t('2026-06-28T10:00:00Z'), t('2026-06-28T10:30:00Z')))
      .toEqual(t('2026-06-28T10:30:00Z'));
  });

  it('stagger espaça os jobs; sem stagger é imediato (null)', () => {
    const base = t('2026-06-28T10:00:00Z');
    expect(staggerTimes(3, 0, base)).toEqual([null, null, null]);
    const s = staggerTimes(3, 10, base);
    expect(s[0]).toEqual(base);
    expect(s[2]).toEqual(t('2026-06-28T10:20:00Z'));
  });
});
