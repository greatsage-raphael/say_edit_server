import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  private ai: any;

  async findRelevantSection(query: string, userId: string, documentId?: string) {
    this.logger.log(`🔍 Searching: "${query}" | User: ${userId} | Doc: ${documentId ?? 'ALL'}`);

    try {
      if (!this.ai) {
        const { GoogleGenAI } = await import('@google/genai');
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      }

      const embResult = await this.ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: query,
      });

      const values = embResult.embeddings?.[0]?.values;
      if (!values) {
        this.logger.error('❌ No embedding values returned from Gemini');
        throw new InternalServerErrorException('Embedding generation failed');
      }

      this.logger.log(`✅ Embedding generated. Querying vector store...`);

      let data: any[], error: any;

      if (documentId) {
        // ✅ Strict single-document search — most precise
        ({ data, error } = await this.supabase.rpc('match_chunks_by_document', {
          query_embedding: values,
          match_threshold: 0.3,
          match_count: 10,
          filter_document_id: documentId,
        }));
      } else {
        // Fallback: search all docs for this user
        ({ data, error } = await this.supabase.rpc('match_document_chunks', {
          query_embedding: values,
          match_threshold: 0.3,
          match_count: 10,
          filter_user_id: userId,
        }));
      }

      if (error) {
        this.logger.error(`❌ RPC Error: ${error.message}`);
        throw new InternalServerErrorException(error.message);
      }

      this.logger.log(`✅ Found ${data?.length ?? 0} spatial chunks.`);
      return data ?? [];

    } catch (e: any) {
      this.logger.error(`💥 Search Failure: ${e.message}`);
      throw new InternalServerErrorException(e.message);
    }
  }
}