import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { MATERIAS } from './catalogo-materias';

const prisma = new PrismaClient();

// Contraseña temporal de arranque. El primer ingreso obliga a cambiarla (RF-AUTH-04).
const PASSWORD_TEMPORAL = process.env.SEED_PASSWORD ?? 'SgaTemporal2026!';
const BCRYPT_COST = 12; // modelo.md: cost ≥ 12

async function main() {
  const planteles = [
    { clave: 'BM', nombre: 'Bordes Mangel' },
    { clave: 'BC', nombre: 'Bonilla Colmenero' },
  ];

  for (const p of planteles) {
    await prisma.plantel.upsert({
      where: { clave: p.clave },
      update: { nombre: p.nombre },
      create: { clave: p.clave, nombre: p.nombre, activo: true },
    });
  }

  for (const m of MATERIAS) {
    await prisma.materia.upsert({
      where: { clave: m.clave },
      update: { nombre: m.nombre, semestreAplicable: m.semestreAplicable },
      create: m,
    });
  }

  const bm = await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } });
  const bc = await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BC' } });

  // Roles base: un Operador global + un Coordinador por plantel.
  const usuarios = [
    { email: 'operador@sga.local', nombre: 'Operador del Sistema', rol: 'Operador' as const, plantelId: null },
    { email: 'coord.bm@sga.local', nombre: 'Coordinación Bordes Mangel', rol: 'Coordinador' as const, plantelId: bm.id },
    { email: 'coord.bc@sga.local', nombre: 'Coordinación Bonilla Colmenero', rol: 'Coordinador' as const, plantelId: bc.id },
  ];

  const hashTemporal = await bcrypt.hash(PASSWORD_TEMPORAL, BCRYPT_COST);
  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        nombreCompleto: u.nombre,
        rol: u.rol,
        plantelId: u.plantelId,
        hashContrasena: hashTemporal,
        debeCambiarContrasena: true,
        activo: true,
      },
    });
  }

  const [nPlanteles, nMaterias] = await Promise.all([
    prisma.plantel.count(),
    prisma.materia.count(),
  ]);
  console.log(`Seed completo: ${nPlanteles} planteles, ${nMaterias} materias.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
