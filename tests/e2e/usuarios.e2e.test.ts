import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let coordA: string;
let coordB: string;
let docToken: string;
let docenteId: string;

let nn = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${nn++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  const plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  const plantelB = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BC' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });
  coordB = tokenFor(app, { rol: 'Coordinador', plantelId: plantelB });
  docToken = tokenFor(app, { rol: 'Docente', plantelId: plantelA });

  docenteId = (
    await prisma.usuario.create({
      data: { email: uniq('doc') + '@sga.local', nombreCompleto: 'Docente Uno', rol: 'Docente', plantelId: plantelA, hashContrasena: 'secreto' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.usuario.deleteMany({ where: { id: docenteId } });
  await app.close();
});

describe('GET /usuarios', () => {
  it('lista docentes del plantel sin exponer el hash', async () => {
    const res = await http.get('/api/usuarios?rol=Docente').set(auth(coordA)).expect(200);
    const doc = res.body.find((u: { id: string }) => u.id === docenteId);
    expect(doc).toBeTruthy();
    expect(doc.hashContrasena).toBeUndefined();
    expect(doc.rol).toBe('Docente');
  });

  it('no incluye usuarios de otro plantel', async () => {
    const res = await http.get('/api/usuarios?rol=Docente').set(auth(coordB)).expect(200);
    expect(res.body.find((u: { id: string }) => u.id === docenteId)).toBeUndefined();
  });

  it('un Docente no puede listar usuarios (403)', async () => {
    await http.get('/api/usuarios').set(auth(docToken)).expect(403);
  });
});
