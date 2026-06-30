import { PESO_EX_MAX, PESO_EX_MIN, PesosParcial, TOLERANCIA_PESOS } from './tipos';

/** RN-02 — El peso del examen debe estar en el intervalo cerrado [0.20, 0.70]. */
export function pesoExEnRango(pesoEX: number): boolean {
  return pesoEX >= PESO_EX_MIN && pesoEX <= PESO_EX_MAX;
}

/** Los 4 pesos (TI, TE, TA, EX) suman exactamente 1.0 (con tolerancia decimal). */
export function pesosSumanUno(pesos: PesosParcial): boolean {
  const suma = pesos.ti + pesos.te + pesos.ta + pesos.ex;
  return Math.abs(suma - 1) <= TOLERANCIA_PESOS;
}

/** La suma de los 5 criterios de una categoría iguala su peso macro. */
export function criteriosSumanMacro(criterios: number[], pesoMacro: number): boolean {
  const suma = criterios.reduce((acc, c) => acc + c, 0);
  return Math.abs(suma - pesoMacro) <= TOLERANCIA_PESOS;
}
