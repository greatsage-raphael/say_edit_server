import { Injectable, Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { IngestionService } from './ingestion.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  constructor(private readonly ingestionService: IngestionService) {}

  // ── Upload PDF → Supabase Storage → DB record → background ingestion ───────
  async handleUpload(file: Express.Multer.File, userId: string) {
    this.logger.log(`📤 Uploading "${file.originalname}" for user ${userId}`);

    // 1. Upload file to Supabase Storage
    const fileName = `${userId}/${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;

    const { data: storageData, error: storageError } = await this.supabase.storage
      .from('documents')
      .upload(fileName, file.buffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (storageError) {
      this.logger.error(`Storage upload failed: ${storageError.message}`);
      throw new Error(`Storage upload failed: ${storageError.message}`);
    }

    // 2. Get public URL
    const { data: { publicUrl } } = this.supabase.storage
      .from('documents')
      .getPublicUrl(fileName);

    // 3. Insert document record into DB
    const { data: doc, error: dbError } = await this.supabase
      .from('documents')
      .insert({
        user_id: userId,
        name: file.originalname,
        file_url: publicUrl,
      })
      .select()
      .single();

    if (dbError || !doc) {
      this.logger.error(`DB insert failed: ${dbError?.message}`);
      throw new Error(`DB insert failed: ${dbError?.message}`);
    }

    this.logger.log(`✅ Document record created: ${doc.id}`);

    // 4. Kick off sentence-level ingestion in the background
    // ─── FIXED: was processPdf(), now correctly calls ingestDocument() ────────
    this.ingestionService.ingestDocument(doc.id, publicUrl).catch(err => {
      this.logger.error(`Background ingestion failed for ${doc.id}: ${err.message}`);
    });

    return doc;
  }

  // ── List all documents for a user ──────────────────────────────────────────
  async getUserDocuments(userId: string) {
    const { data, error } = await this.supabase
      .from('documents')
      .select('id, name, file_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }
}