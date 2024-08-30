import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule as CustomConfigModule } from './config/config.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [CustomConfigModule, ConfigModule.forRoot()],
  controllers: [AppController],
  providers: [AppService],
})

export class AppModule {}
