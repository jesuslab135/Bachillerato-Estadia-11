import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configurarApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`SGA-Militar API escuchando en http://localhost:${port}/api`);
}

void bootstrap();
