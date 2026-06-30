import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, tokenFor } from './app';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

const LOGIN = 'e2e.login@sga.local';
const MUSTCHANGE = 'e2e.mustchange@sga.local';
const LOCK = 'e2e.lock@sga.local';
const EMAILS = [LOGIN, MUSTCHANGE, LOCK];
const PASS = 'Passw0rd!';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function crearUsuario(email: string, debeCambiar: boolean) {
  return prisma.usuario.create({
    data: {
      email,
      nombreCompleto: email,
      rol: 'Docente',
      hashContrasena: await bcrypt.hash(PASS, 12),
      debeCambiarContrasena: debeCambiar,
    },
  });
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());
  await prisma.usuario.deleteMany({ where: { email: { in: EMAILS } } });
  await crearUsuario(LOGIN, false);
  await crearUsuario(MUSTCHANGE, true);
  await crearUsuario(LOCK, false);
});

afterAll(async () => {
  await prisma.usuario.deleteMany({ where: { email: { in: EMAILS } } });
  await app.close();
});

describe('POST /api/auth/login (RF-AUTH-01)', () => {
  it('credenciales válidas ⇒ token + flag de cambio', async () => {
    const res = await http.post('/api/auth/login').send({ email: LOGIN, password: PASS }).expect(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.debeCambiarContrasena).toBe(false);
  });

  it('contraseña incorrecta ⇒ 401', async () => {
    await http.post('/api/auth/login').send({ email: LOGIN, password: 'mala' }).expect(401);
  });

  it('email inexistente ⇒ 401', async () => {
    await http.post('/api/auth/login').send({ email: 'nadie@sga.local', password: PASS }).expect(401);
  });

  it('registra el login exitoso en auditoría (RF-AUTH-06)', async () => {
    const user = await prisma.usuario.findUniqueOrThrow({ where: { email: LOGIN } });
    const evento = await prisma.auditLog.findFirst({
      where: { usuarioId: user.id, tipoEvento: 'LOGIN_OK' },
    });
    expect(evento).not.toBeNull();
  });
});

describe('Bloqueo por intentos fallidos (RF-AUTH-05)', () => {
  it('5 fallos bloquean la cuenta y el desbloqueo por Coordinador la restaura', async () => {
    for (let i = 0; i < 5; i++) {
      await http.post('/api/auth/login').send({ email: LOCK, password: 'mala' }).expect(401);
    }
    // Bloqueada: ni con la contraseña correcta entra.
    await http.post('/api/auth/login').send({ email: LOCK, password: PASS }).expect(423);

    const bloqueada = await prisma.usuario.findUniqueOrThrow({ where: { email: LOCK } });
    expect(bloqueada.bloqueadoHasta).not.toBeNull();

    // Un Docente NO puede desbloquear.
    await http
      .post('/api/auth/desbloquear')
      .set(auth(tokenFor(app, { rol: 'Docente' })))
      .send({ email: LOCK })
      .expect(403);

    // El Coordinador sí.
    await http
      .post('/api/auth/desbloquear')
      .set(auth(tokenFor(app, { rol: 'Coordinador' })))
      .send({ email: LOCK })
      .expect(200);

    await http.post('/api/auth/login').send({ email: LOCK, password: PASS }).expect(200);
  });
});

describe('Primer ingreso obliga a cambiar contraseña (RF-AUTH-04)', () => {
  it('bloquea el acceso hasta cambiar, luego permite', async () => {
    const login = await http.post('/api/auth/login').send({ email: MUSTCHANGE, password: PASS }).expect(200);
    expect(login.body.debeCambiarContrasena).toBe(true);
    const token = login.body.accessToken as string;

    // Con cambio pendiente, una ruta protegida responde 403.
    await http.get('/api/materias').set(auth(token)).expect(403);

    // Contraseña actual incorrecta ⇒ 401.
    await http
      .post('/api/auth/change-password')
      .set(auth(token))
      .send({ actual: 'mala', nueva: 'NuevaClave123' })
      .expect(401);

    // Cambio correcto ⇒ nuevo token sin pendiente.
    const cambio = await http
      .post('/api/auth/change-password')
      .set(auth(token))
      .send({ actual: PASS, nueva: 'NuevaClave123' })
      .expect(200);
    expect(cambio.body.debeCambiarContrasena).toBe(false);

    // Con el nuevo token ya accede.
    await http.get('/api/materias').set(auth(cambio.body.accessToken)).expect(200);
  });
});
