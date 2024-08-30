import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import cluster from 'cluster';

export async function bootstrap(port = 80) {
  const app = await NestFactory.create(AppModule);

  if (process.env.PORT) {
    port = parseInt(process.env.PORT);
  }

  if (!cluster.isPrimary) {
    port = parseInt(process.env.WORKER_ID) + 1 + port;
  }

  try {
    await app.listen(port);
    Logger.log(`Service started on port ${port}`);
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      Logger.error(`Port ${port} is in use, trying another one...`);
      bootstrap(port + 1);
    }
  }
}
