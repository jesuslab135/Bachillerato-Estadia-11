// Tipos y constantes del dominio. Capa pura: sin dependencias de DB ni HTTP.

export type CodigoAsistencia = 'A' | 'F' | 'R' | 'J';

/** Valor de un examen: nota numérica en [0,10] o "NP" (No Presentado). */
export type ValorExamen = number | 'NP';

/** Calificación final de un parcial usada en la cascada semestral. */
export type NotaParcial = number | 'NP';

/** Instancia de recuperación: nota, "NP", o null si la instancia no existe. */
export type InstanciaRecuperacion = number | 'NP' | null;

export interface ConteoAsistencia {
  A: number;
  F: number;
  R: number;
  J: number;
}

export interface PesosParcial {
  ti: number;
  te: number;
  ta: number;
  ex: number;
}

// ── Constantes de negocio (parametrizadas, no literales mágicos dispersos) ──

/** RN-01: 3 o más faltas no justificadas ⇒ SDE. */
export const UMBRAL_FALTAS_SDE = 3;

/** Calificación mínima aprobatoria de un parcial. */
export const CALIFICACION_APROBATORIA = 6;

/** RN-03: piso institucional para calificación cruda en [5,6). */
export const PISO_INSTITUCIONAL = 5;

/** RN-02: rango cerrado permitido para el peso del examen. */
export const PESO_EX_MIN = 0.2;
export const PESO_EX_MAX = 0.7;

export const CALIF_MIN = 0;
export const CALIF_MAX = 10;

/** Tolerancia para comparaciones de sumas de pesos (decimales). */
export const TOLERANCIA_PESOS = 1e-9;
