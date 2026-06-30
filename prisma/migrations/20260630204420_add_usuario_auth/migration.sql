-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "bloqueado_hasta" TIMESTAMP(3),
ADD COLUMN     "debe_cambiar_contrasena" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "intentos_fallidos" INTEGER NOT NULL DEFAULT 0;
