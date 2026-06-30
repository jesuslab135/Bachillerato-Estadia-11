-- CreateEnum
CREATE TYPE "EstatusCadete" AS ENUM ('Activo', 'BajaTemporal', 'BajaDefinitiva');

-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('Docente', 'Coordinador', 'Operador');

-- CreateEnum
CREATE TYPE "EstadoParcial" AS ENUM ('Borrador', 'CerradoDocente', 'Validado', 'Reabierto');

-- CreateEnum
CREATE TYPE "TipoCategoria" AS ENUM ('TI', 'TE', 'TA');

-- CreateEnum
CREATE TYPE "CodigoAsistencia" AS ENUM ('A', 'F', 'R', 'J');

-- CreateEnum
CREATE TYPE "TipoExamen" AS ENUM ('Parcial', 'Ordinario', 'Extraordinario', 'TDS');

-- CreateEnum
CREATE TYPE "EstatusExamen" AS ENUM ('PRESENTADO', 'NP');

-- CreateTable
CREATE TABLE "Plantel" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Plantel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materia" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "semestre_aplicable" INTEGER NOT NULL,

    CONSTRAINT "materia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grupo" (
    "id" TEXT NOT NULL,
    "plantel_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "semestre" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "grupo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periodo" (
    "id" TEXT NOT NULL,
    "plantel_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "periodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadete" (
    "matricula" TEXT NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "plantel_id" TEXT NOT NULL,
    "grupo_actual_id" TEXT,
    "estatus" "EstatusCadete" NOT NULL DEFAULT 'Activo',
    "fecha_baja" DATE,

    CONSTRAINT "cadete_pkey" PRIMARY KEY ("matricula")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" TEXT NOT NULL,
    "plantel_id" TEXT,
    "nombre_completo" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hash_contrasena" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_ultimo_acceso" TIMESTAMP(3),

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curso" (
    "id" TEXT NOT NULL,
    "materia_id" TEXT NOT NULL,
    "grupo_id" TEXT NOT NULL,
    "docente_id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'Activo',

    CONSTRAINT "curso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcial" (
    "id" TEXT NOT NULL,
    "curso_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" "EstadoParcial" NOT NULL DEFAULT 'Borrador',
    "peso_ti" DECIMAL(4,3) NOT NULL,
    "peso_te" DECIMAL(4,3) NOT NULL,
    "peso_ta" DECIMAL(4,3) NOT NULL,
    "peso_ex" DECIMAL(4,3) NOT NULL,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,

    CONSTRAINT "parcial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criterio" (
    "id" TEXT NOT NULL,
    "parcial_id" TEXT NOT NULL,
    "tipo" "TipoCategoria" NOT NULL,
    "orden" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "peso" DECIMAL(5,4) NOT NULL,

    CONSTRAINT "criterio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actividad" (
    "id" TEXT NOT NULL,
    "parcial_id" TEXT NOT NULL,
    "tipo" "TipoCategoria" NOT NULL,
    "orden" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "fecha" DATE,
    "criterio_id" TEXT,

    CONSTRAINT "actividad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asistencia" (
    "id" TEXT NOT NULL,
    "cadete_matricula" TEXT NOT NULL,
    "curso_id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "codigo" "CodigoAsistencia" NOT NULL,
    "capturada_por" TEXT NOT NULL,
    "capturada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asistencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calificacion" (
    "id" TEXT NOT NULL,
    "cadete_matricula" TEXT NOT NULL,
    "actividad_id" TEXT NOT NULL,
    "valor" DECIMAL(4,2),
    "capturada_por" TEXT NOT NULL,
    "capturada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examen" (
    "id" TEXT NOT NULL,
    "cadete_matricula" TEXT NOT NULL,
    "parcial_id" TEXT NOT NULL,
    "tipo" "TipoExamen" NOT NULL,
    "valor" DECIMAL(4,2),
    "estatus" "EstatusExamen" NOT NULL DEFAULT 'PRESENTADO',
    "capturado_por" TEXT NOT NULL,

    CONSTRAINT "examen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punto_extra" (
    "id" TEXT NOT NULL,
    "cadete_matricula" TEXT NOT NULL,
    "parcial_id" TEXT NOT NULL,
    "aplica" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT,

    CONSTRAINT "punto_extra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acta" (
    "id" TEXT NOT NULL,
    "curso_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "generada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firmada_docente_en" TIMESTAMP(3),
    "firmada_coordinacion_en" TIMESTAMP(3),
    "hash_pdf" TEXT,
    "url_almacenamiento" TEXT,

    CONSTRAINT "acta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" TEXT,
    "ip" TEXT,
    "tipo_evento" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "valor_anterior_json" JSONB,
    "valor_nuevo_json" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_event" (
    "id" TEXT NOT NULL,
    "parcial_id" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "motivo" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plantel_clave_key" ON "Plantel"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "materia_clave_key" ON "materia"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "grupo_plantel_id_nombre_key" ON "grupo"("plantel_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "periodo_plantel_id_codigo_key" ON "periodo"("plantel_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "curso_materia_id_grupo_id_docente_id_periodo_id_key" ON "curso"("materia_id", "grupo_id", "docente_id", "periodo_id");

-- CreateIndex
CREATE UNIQUE INDEX "parcial_curso_id_numero_key" ON "parcial"("curso_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "criterio_parcial_id_tipo_orden_key" ON "criterio"("parcial_id", "tipo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "actividad_parcial_id_tipo_orden_key" ON "actividad"("parcial_id", "tipo", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "asistencia_cadete_matricula_curso_id_fecha_key" ON "asistencia"("cadete_matricula", "curso_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "calificacion_cadete_matricula_actividad_id_key" ON "calificacion"("cadete_matricula", "actividad_id");

-- CreateIndex
CREATE UNIQUE INDEX "examen_cadete_matricula_parcial_id_tipo_key" ON "examen"("cadete_matricula", "parcial_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "punto_extra_cadete_matricula_parcial_id_key" ON "punto_extra"("cadete_matricula", "parcial_id");

-- CreateIndex
CREATE UNIQUE INDEX "acta_curso_id_version_key" ON "acta"("curso_id", "version");

-- CreateIndex
CREATE INDEX "audit_log_entidad_entidad_id_idx" ON "audit_log"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "audit_log_usuario_id_idx" ON "audit_log"("usuario_id");

-- CreateIndex
CREATE INDEX "workflow_event_parcial_id_idx" ON "workflow_event"("parcial_id");

-- AddForeignKey
ALTER TABLE "grupo" ADD CONSTRAINT "grupo_plantel_id_fkey" FOREIGN KEY ("plantel_id") REFERENCES "Plantel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periodo" ADD CONSTRAINT "periodo_plantel_id_fkey" FOREIGN KEY ("plantel_id") REFERENCES "Plantel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadete" ADD CONSTRAINT "cadete_plantel_id_fkey" FOREIGN KEY ("plantel_id") REFERENCES "Plantel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadete" ADD CONSTRAINT "cadete_grupo_actual_id_fkey" FOREIGN KEY ("grupo_actual_id") REFERENCES "grupo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_plantel_id_fkey" FOREIGN KEY ("plantel_id") REFERENCES "Plantel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curso" ADD CONSTRAINT "curso_materia_id_fkey" FOREIGN KEY ("materia_id") REFERENCES "materia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curso" ADD CONSTRAINT "curso_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "grupo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curso" ADD CONSTRAINT "curso_docente_id_fkey" FOREIGN KEY ("docente_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curso" ADD CONSTRAINT "curso_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "periodo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcial" ADD CONSTRAINT "parcial_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "curso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criterio" ADD CONSTRAINT "criterio_parcial_id_fkey" FOREIGN KEY ("parcial_id") REFERENCES "parcial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actividad" ADD CONSTRAINT "actividad_parcial_id_fkey" FOREIGN KEY ("parcial_id") REFERENCES "parcial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actividad" ADD CONSTRAINT "actividad_criterio_id_fkey" FOREIGN KEY ("criterio_id") REFERENCES "criterio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia" ADD CONSTRAINT "asistencia_cadete_matricula_fkey" FOREIGN KEY ("cadete_matricula") REFERENCES "cadete"("matricula") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asistencia" ADD CONSTRAINT "asistencia_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "curso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calificacion" ADD CONSTRAINT "calificacion_cadete_matricula_fkey" FOREIGN KEY ("cadete_matricula") REFERENCES "cadete"("matricula") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calificacion" ADD CONSTRAINT "calificacion_actividad_id_fkey" FOREIGN KEY ("actividad_id") REFERENCES "actividad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examen" ADD CONSTRAINT "examen_cadete_matricula_fkey" FOREIGN KEY ("cadete_matricula") REFERENCES "cadete"("matricula") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examen" ADD CONSTRAINT "examen_parcial_id_fkey" FOREIGN KEY ("parcial_id") REFERENCES "parcial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punto_extra" ADD CONSTRAINT "punto_extra_cadete_matricula_fkey" FOREIGN KEY ("cadete_matricula") REFERENCES "cadete"("matricula") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punto_extra" ADD CONSTRAINT "punto_extra_parcial_id_fkey" FOREIGN KEY ("parcial_id") REFERENCES "parcial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acta" ADD CONSTRAINT "acta_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "curso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_event" ADD CONSTRAINT "workflow_event_parcial_id_fkey" FOREIGN KEY ("parcial_id") REFERENCES "parcial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Restricciones de dominio NO expresables en el schema Prisma (SQL crudo).
-- ============================================================================

-- Parcial: número ∈ {1,2,3} (restricción estructural: exactamente 3 por curso).
ALTER TABLE "parcial" ADD CONSTRAINT "parcial_numero_rango" CHECK ("numero" BETWEEN 1 AND 3);

-- Parcial: cada peso individual ∈ [0,1].
ALTER TABLE "parcial" ADD CONSTRAINT "parcial_pesos_unitarios" CHECK (
  "peso_ti" BETWEEN 0 AND 1 AND "peso_te" BETWEEN 0 AND 1 AND
  "peso_ta" BETWEEN 0 AND 1 AND "peso_ex" BETWEEN 0 AND 1
);

-- Parcial cerrado/validado: los 4 pesos suman exactamente 1.0.
-- Borrador y Reabierto están exentos (edición en curso).
ALTER TABLE "parcial" ADD CONSTRAINT "parcial_pesos_suman_uno" CHECK (
  "estado" NOT IN ('CerradoDocente', 'Validado')
  OR ("peso_ti" + "peso_te" + "peso_ta" + "peso_ex") = 1.0
);

-- RN-02: peso_ex ∈ [0.20, 0.70] como invariante del parcial cerrado/validado.
ALTER TABLE "parcial" ADD CONSTRAINT "parcial_peso_ex_rango" CHECK (
  "estado" NOT IN ('CerradoDocente', 'Validado')
  OR ("peso_ex" >= 0.20 AND "peso_ex" <= 0.70)
);

-- Criterio: orden ∈ 1..5 (5 por tipo → 15 por parcial); peso ≥ 0.
ALTER TABLE "criterio" ADD CONSTRAINT "criterio_orden_rango" CHECK ("orden" BETWEEN 1 AND 5);
ALTER TABLE "criterio" ADD CONSTRAINT "criterio_peso_no_negativo" CHECK ("peso" >= 0);

-- Actividad: orden ∈ 1..30 (máximo 30 por (parcial, tipo)).
ALTER TABLE "actividad" ADD CONSTRAINT "actividad_orden_rango" CHECK ("orden" BETWEEN 1 AND 30);

-- Calificación: valor ∈ [0,10] o NULL.
ALTER TABLE "calificacion" ADD CONSTRAINT "calificacion_valor_rango" CHECK (
  "valor" IS NULL OR ("valor" BETWEEN 0 AND 10)
);

-- Examen: valor ∈ [0,10] o NULL; y NP ⇔ valor IS NULL.
ALTER TABLE "examen" ADD CONSTRAINT "examen_valor_rango" CHECK (
  "valor" IS NULL OR ("valor" BETWEEN 0 AND 10)
);
ALTER TABLE "examen" ADD CONSTRAINT "examen_np_sii_valor_null" CHECK (
  ("estatus" = 'NP') = ("valor" IS NULL)
);

-- Periodo: solo un periodo activo por plantel (índice único parcial).
CREATE UNIQUE INDEX "periodo_un_activo_por_plantel" ON "periodo" ("plantel_id") WHERE "activo";

-- Append-only: audit_log y workflow_event rechazan UPDATE y DELETE.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % no admite la operación %', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER "workflow_event_append_only"
  BEFORE UPDATE OR DELETE ON "workflow_event"
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
