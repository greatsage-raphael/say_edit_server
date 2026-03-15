import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // Essential for your React frontend
  await app.listen(process.env.PORT || 3001);
  console.log(`GLYPH Server running on: ${await app.getUrl()}`);
}
bootstrap();
