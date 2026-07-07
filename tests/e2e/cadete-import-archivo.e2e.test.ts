import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

let coordA: string;
let docA: string;
let grupoA: string;
const matriculas: string[] = [];
const grupoIds: string[] = [];

let n = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${n++}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const track = (m: string) => {
  matriculas.push(m);
  return m;
};

const CSV_MAT = track(uniq('CSVF'));
const XLSX_MAT = track(uniq('XLSF'));
const DEF_MAT = track(uniq('DEFG'));
const QUOTE_MAT = track(uniq('QCSV'));

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  const plantelA = (await prisma.plantel.findUniqueOrThrow({ where: { clave: 'BM' } })).id;
  coordA = tokenFor(app, { rol: 'Coordinador', plantelId: plantelA });
  docA = tokenFor(app, { rol: 'Docente', plantelId: plantelA });
  grupoA = (await prisma.grupo.create({ data: { plantelId: plantelA, nombre: uniq('GA'), semestre: 1 } })).id;
  grupoIds.push(grupoA);
});

afterAll(async () => {
  await prisma.cadete.deleteMany({ where: { matricula: { in: matriculas } } });
  await prisma.grupo.deleteMany({ where: { id: { in: grupoIds } } });
  await app.close();
});

describe('POST /cadetes/import/archivo (RF-CAT-07)', () => {
  it('importa desde un archivo .csv subido', async () => {
    const csv = `matricula,nombreCompleto,grupoId\n${CSV_MAT},Desde Archivo CSV,${grupoA}`;
    const res = await http
      .post('/api/cadetes/import/archivo')
      .set(auth(coordA))
      .attach('archivo', Buffer.from(csv, 'utf-8'), 'cadetes.csv')
      .expect(201);
    expect(res.body.insertados).toBe(1);
    const cad = await prisma.cadete.findUnique({ where: { matricula: CSV_MAT } });
    expect(cad?.nombreCompleto).toBe('Desde Archivo CSV');
  });

  it('importa desde un archivo .xlsx subido', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([{ matricula: XLSX_MAT, nombreCompleto: 'Desde XLSX', grupoId: grupoA }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Cadetes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const res = await http
      .post('/api/cadetes/import/archivo')
      .set(auth(coordA))
      .attach('archivo', buffer, 'cadetes.xlsx')
      .expect(201);
    expect(res.body.insertados).toBe(1);
    const cad = await prisma.cadete.findUnique({ where: { matricula: XLSX_MAT } });
    expect(cad?.nombreCompleto).toBe('Desde XLSX');
  });

  it('usa el grupo por defecto (?grupoId) cuando la fila no trae grupoId (FB-B-2)', async () => {
    const csv = `matricula,nombreCompleto\n${DEF_MAT},Sin Grupo En CSV`;
    const res = await http
      .post(`/api/cadetes/import/archivo?grupoId=${grupoA}`)
      .set(auth(coordA))
      .attach('archivo', Buffer.from(csv, 'utf-8'), 'cadetes.csv')
      .expect(201);
    expect(res.body.insertados).toBe(1);
    const cad = await prisma.cadete.findUnique({ where: { matricula: DEF_MAT } });
    expect(cad?.grupoActualId).toBe(grupoA);
  });

  it('parsea campos entrecomillados con comas (RFC 4180): "Pérez, Juan" (FB-B-7)', async () => {
    const csv = `matricula,nombreCompleto,grupoId\n${QUOTE_MAT},"Pérez, Juan",${grupoA}`;
    const res = await http
      .post('/api/cadetes/import/archivo')
      .set(auth(coordA))
      .attach('archivo', Buffer.from(csv, 'utf-8'), 'cadetes.csv')
      .expect(201);
    expect(res.body.insertados).toBe(1);
    const cad = await prisma.cadete.findUnique({ where: { matricula: QUOTE_MAT } });
    expect(cad?.nombreCompleto).toBe('Pérez, Juan');
  });

  it('rechaza un formato no soportado (400)', async () => {
    await http
      .post('/api/cadetes/import/archivo')
      .set(auth(coordA))
      .attach('archivo', Buffer.from('hola', 'utf-8'), 'datos.txt')
      .expect(400);
  });

  it('rechaza un .xlsx falso (texto renombrado, sin firma PK) (400, FB-B-5)', async () => {
    await http
      .post('/api/cadetes/import/archivo')
      .set(auth(coordA))
      .attach('archivo', Buffer.from('matricula,nombreCompleto\nX,Texto Plano', 'utf-8'), 'cadetes.xlsx')
      .expect(400);
  });

  it('rechaza un .csv con contenido binario (400, FB-B-5)', async () => {
    await http
      .post('/api/cadetes/import/archivo')
      .set(auth(coordA))
      .attach('archivo', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]), 'cadetes.csv')
      .expect(400);
  });

  it('un Docente no puede importar por archivo (403)', async () => {
    await http
      .post('/api/cadetes/import/archivo')
      .set(auth(docA))
      .attach('archivo', Buffer.from('x', 'utf-8'), 'cadetes.csv')
      .expect(403);
  });
});
