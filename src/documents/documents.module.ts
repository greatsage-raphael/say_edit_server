import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IngestionService } from './ingestion.service';
import { SearchService } from './search.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, IngestionService, SearchService],
})
export class DocumentsModule {}