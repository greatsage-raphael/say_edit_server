import { Controller, Post, Get, Body, UploadedFile, UseInterceptors, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { SearchService } from './search.service';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly searchService: SearchService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
    return this.documentsService.handleUpload(file, userId);
  }

  @Get('list')
  async listDocs(@Query('userId') userId: string) {
    return this.documentsService.getUserDocuments(userId);
  }

  @Post('query')
  async queryDocs(
    @Body() body: { query: string; userId: string; documentId?: string }
  ) {
    // documentId is now passed through — strict per-document search
    return this.searchService.findRelevantSection(body.query, body.userId, body.documentId);
  }

  @Get('health')
health() {
  return { status: 'ok', timestamp: new Date().toISOString() };
}
}