-- CreateIndex
CREATE INDEX "actividad_parcial_id_idx" ON "actividad"("parcial_id");

-- CreateIndex
CREATE INDEX "asistencia_curso_id_fecha_idx" ON "asistencia"("curso_id", "fecha");

-- CreateIndex
CREATE INDEX "cadete_grupo_actual_id_idx" ON "cadete"("grupo_actual_id");

-- CreateIndex
CREATE INDEX "calificacion_actividad_id_idx" ON "calificacion"("actividad_id");

-- CreateIndex
CREATE INDEX "examen_parcial_id_idx" ON "examen"("parcial_id");
