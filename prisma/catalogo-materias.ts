// Catálogo de las 33 materias del plan de estudios (bachillerato general militarizado,
// 6 semestres). FABRICADO como base operativa — sustituible por el plan oficial.
// Fuente única de verdad: la consume tanto el seed como su prueba.

export interface MateriaSeed {
  clave: string;
  nombre: string;
  semestreAplicable: number;
}

export const MATERIAS: MateriaSeed[] = [
  // Semestre 1
  { clave: 'MAT-1', nombre: 'Matemáticas I', semestreAplicable: 1 },
  { clave: 'QUI-1', nombre: 'Química I', semestreAplicable: 1 },
  { clave: 'ETI-1', nombre: 'Ética y Valores I', semestreAplicable: 1 },
  { clave: 'MET-1', nombre: 'Metodología de la Investigación', semestreAplicable: 1 },
  { clave: 'ING-1', nombre: 'Lengua Adicional al Español I', semestreAplicable: 1 },
  { clave: 'TIC-1', nombre: 'Tecnologías de la Información I', semestreAplicable: 1 },
  { clave: 'FME-1', nombre: 'Formación Militar I', semestreAplicable: 1 },

  // Semestre 2
  { clave: 'MAT-2', nombre: 'Matemáticas II', semestreAplicable: 2 },
  { clave: 'QUI-2', nombre: 'Química II', semestreAplicable: 2 },
  { clave: 'ETI-2', nombre: 'Ética y Valores II', semestreAplicable: 2 },
  { clave: 'CSO-1', nombre: 'Introducción a las Ciencias Sociales', semestreAplicable: 2 },
  { clave: 'ING-2', nombre: 'Lengua Adicional al Español II', semestreAplicable: 2 },
  { clave: 'FME-2', nombre: 'Formación Militar II', semestreAplicable: 2 },

  // Semestre 3
  { clave: 'MAT-3', nombre: 'Matemáticas III', semestreAplicable: 3 },
  { clave: 'FIS-1', nombre: 'Física I', semestreAplicable: 3 },
  { clave: 'BIO-1', nombre: 'Biología I', semestreAplicable: 3 },
  { clave: 'HMX-1', nombre: 'Historia de México I', semestreAplicable: 3 },
  { clave: 'LIT-1', nombre: 'Literatura I', semestreAplicable: 3 },
  { clave: 'ING-3', nombre: 'Lengua Adicional al Español III', semestreAplicable: 3 },

  // Semestre 4
  { clave: 'MAT-4', nombre: 'Matemáticas IV', semestreAplicable: 4 },
  { clave: 'FIS-2', nombre: 'Física II', semestreAplicable: 4 },
  { clave: 'BIO-2', nombre: 'Biología II', semestreAplicable: 4 },
  { clave: 'HMX-2', nombre: 'Historia de México II', semestreAplicable: 4 },
  { clave: 'LIT-2', nombre: 'Literatura II', semestreAplicable: 4 },
  { clave: 'ING-4', nombre: 'Lengua Adicional al Español IV', semestreAplicable: 4 },

  // Semestre 5
  { clave: 'CAL-1', nombre: 'Cálculo Diferencial', semestreAplicable: 5 },
  { clave: 'GEO-1', nombre: 'Geografía', semestreAplicable: 5 },
  { clave: 'HUC-1', nombre: 'Historia Universal Contemporánea', semestreAplicable: 5 },
  { clave: 'ING-5', nombre: 'Lengua Adicional al Español V', semestreAplicable: 5 },
  { clave: 'ESM-1', nombre: 'Estructura Socioeconómica de México', semestreAplicable: 5 },

  // Semestre 6
  { clave: 'CAL-2', nombre: 'Cálculo Integral', semestreAplicable: 6 },
  { clave: 'FIL-1', nombre: 'Filosofía', semestreAplicable: 6 },
  { clave: 'ECO-1', nombre: 'Ecología y Medio Ambiente', semestreAplicable: 6 },
];
