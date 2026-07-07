import { describe, expect, it } from 'vitest';
import { fechaLocalISO, TZ_PLANTELES } from '../../src/domain';

describe('fechaLocalISO (FB-B-10 — "hoy" en la zona del plantel)', () => {
  it('usa America/Mexico_City por defecto', () => {
    expect(TZ_PLANTELES).toBe('America/Mexico_City');
    expect(fechaLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('de 18:00 a 00:00 locales el día NO salta al siguiente (UTC-6, sin DST desde 2022)', () => {
    // 2026-01-15T05:59Z = 2026-01-14 23:59 en CDMX
    expect(fechaLocalISO(TZ_PLANTELES, new Date('2026-01-15T05:59:00Z'))).toBe('2026-01-14');
    // 2026-01-15T06:00Z = 2026-01-15 00:00 en CDMX
    expect(fechaLocalISO(TZ_PLANTELES, new Date('2026-01-15T06:00:00Z'))).toBe('2026-01-15');
  });

  it('acepta una zona horaria explícita', () => {
    expect(fechaLocalISO('UTC', new Date('2026-01-15T05:59:00Z'))).toBe('2026-01-15');
    expect(fechaLocalISO('Asia/Tokyo', new Date('2026-01-15T23:00:00Z'))).toBe('2026-01-16');
  });
});
