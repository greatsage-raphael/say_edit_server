import { Injectable, Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────────────
interface TextItem {
  str: string;
  transform: number[];  // [scaleX, skewX, skewY, scaleY, x, y]
  width: number;
  height: number;
}

interface Word {
  str: string;
  x: number;
  y: number;      // top-left origin (converted from PDF bottom-left)
  width: number;
  height: number;
}

interface SentenceChunk {
  text: string;
  pageNumber: number;
  boundingBox: [number, number, number, number]; // [x, y, width, height]
}

// ─── Load pdfjs with canvas mock (must happen before any require of pdfjs) ──
// pdfjs-dist legacy build optionally requires 'canvas' — we stub it out
// so it doesn't crash in a Node/NestJS environment without a display.
function loadPdfjs(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module') as any;
  const origLoad = Module._load;

  // Intercept require('canvas') and return an empty stub instead of crashing
  Module._load = function (id: string, ...args: any[]) {
    if (id === 'canvas') {
      return { createCanvas: () => ({}), loadImage: async () => ({}) };
    }
    return origLoad.call(this, id, ...args);
  };

  let pdfjsLib: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  } finally {
    Module._load = origLoad; // always restore
  }

  // Unwrap default export if needed (some bundler configs wrap it)
  if (typeof pdfjsLib.getDocument !== 'function' && pdfjsLib.default) {
    pdfjsLib = pdfjsLib.default;
  }

  if (typeof pdfjsLib.getDocument !== 'function') {
    throw new Error(
      `pdfjs getDocument not found. Available keys: ${Object.keys(pdfjsLib).join(', ')}`
    );
  }

  return pdfjsLib;
}

// Load once at module init time — safe because the canvas mock is applied
// before the require and removed immediately after.
const pdfjsLib = loadPdfjs();

// ─── Service ─────────────────────────────────────────────────────────────────
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  async ingestDocument(documentId: string, fileUrl: string): Promise<void> {
    this.logger.log(`🔍 Starting sentence-level ingestion for doc: ${documentId}`);

    try {
      // 1. Fetch PDF bytes from Supabase Storage URL
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();

      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        disableWorker: true,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;

      this.logger.log(`📄 PDF loaded: ${pdf.numPages} pages`);

      // 2. Extract sentence-level chunks with tight bounding boxes
      const allChunks: SentenceChunk[] = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const pageHeight = viewport.height;

        const textContent = await page.getTextContent();
        const items = textContent.items as TextItem[];

        const words: Word[] = items
          .filter(item => item.str && item.str.trim().length > 0)
          .map(item => ({
            str: item.str,
            x: item.transform[4],
            // Convert PDF bottom-left Y origin → top-left origin
            y: pageHeight - item.transform[5] - (item.height || 10),
            width: Math.abs(item.width),
            height: Math.abs(item.height) || 10,
          }));

        if (words.length === 0) continue;

        const lines = groupWordsIntoLines(words, 4);
        const sentences = groupLinesIntoSentences(lines, pageNum);
        allChunks.push(...sentences);

        this.logger.log(`  Page ${pageNum}: ${words.length} words → ${sentences.length} sentences`);
      }

      this.logger.log(`✅ Extracted ${allChunks.length} total sentence chunks`);

      // 3. Delete old chunks for this document
      const { error: deleteError } = await this.supabase
        .from('document_chunks')
        .delete()
        .eq('document_id', documentId);

      if (deleteError) {
        this.logger.warn(`Could not delete old chunks: ${deleteError.message}`);
      }

      // 4. Embed and store in batches of 5 (rate limit friendly)
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

      const BATCH_SIZE = 5;
      let stored = 0;

      for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (chunk) => {
            try {
              const embResult = await ai.models.embedContent({
                model: 'gemini-embedding-001',
                contents: chunk.text,
              });

              const values = embResult.embeddings?.[0]?.values;
              if (!values) {
                this.logger.warn(`No embedding returned for: "${chunk.text.substring(0, 40)}"`);
                return;
              }

              const { error } = await this.supabase.from('document_chunks').insert({
                document_id: documentId,
                content: chunk.text,
                embedding: values,
                page_number: chunk.pageNumber,
                bounding_box: chunk.boundingBox,
              });

              if (error) this.logger.warn(`Insert error: ${error.message}`);
              else stored++;
            } catch (e: any) {
              this.logger.warn(`Chunk embed/insert failed: ${e.message}`);
            }
          })
        );

        this.logger.log(`  💾 ${Math.min(i + BATCH_SIZE, allChunks.length)}/${allChunks.length} chunks stored...`);

        // Brief pause between batches to respect embedding API rate limits
        if (i + BATCH_SIZE < allChunks.length) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      this.logger.log(`✅ Ingestion complete: ${stored}/${allChunks.length} sentence chunks stored for doc ${documentId}`);

    } catch (err: any) {
      this.logger.error(`💥 Ingestion failed: ${err.message}`, err.stack);
      throw err;
    }
  }
}

// ─── Text extraction helpers ─────────────────────────────────────────────────

/**
 * Group words into lines based on Y proximity.
 * Words within `tolerance` PDF points vertically are considered the same line.
 */
function groupWordsIntoLines(words: Word[], tolerance: number): Word[][] {
  const sorted = [...words].sort((a, b) =>
    Math.abs(a.y - b.y) <= tolerance ? a.x - b.x : a.y - b.y
  );

  const lines: Word[][] = [];
  let currentLine: Word[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    if (Math.abs(word.y - currentY) <= tolerance) {
      currentLine.push(word);
      // Rolling average Y keeps the line anchor stable across wide lines
      currentY = currentLine.reduce((s, w) => s + w.y, 0) / currentLine.length;
    } else {
      lines.push(currentLine);
      currentLine = [word];
      currentY = word.y;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  return lines;
}

/**
 * Merge lines into sentence-level chunks.
 * A new sentence starts after . ! ? or when accumulated text exceeds MAX_CHARS.
 * Short fragments (headers, labels) below MIN_CHARS are skipped.
 */
function groupLinesIntoSentences(lines: Word[][], pageNumber: number): SentenceChunk[] {
  const chunks: SentenceChunk[] = [];
  let currentWords: Word[] = [];
  let currentText = '';

  const SENTENCE_END = /[.!?]["']?\s*$/;
  const MIN_CHARS = 20;
  const MAX_CHARS = 300;

  const flush = () => {
    const text = currentText.trim();
    if (text.length >= MIN_CHARS && currentWords.length > 0) {
      chunks.push({
        text,
        pageNumber,
        boundingBox: computeTightBBox(currentWords),
      });
    }
    currentWords = [];
    currentText = '';
  };

  for (const line of lines) {
    const lineText = line.map(w => w.str).join(' ').trim();
    if (!lineText) continue;

    currentWords.push(...line);
    currentText += (currentText ? ' ' : '') + lineText;

    if (SENTENCE_END.test(lineText) || currentText.length >= MAX_CHARS) {
      flush();
    }
  }
  flush(); // flush any trailing text at page end

  return chunks;
}

/**
 * Compute the tightest possible bounding box from a set of words.
 * Returns [x, y, width, height] in PDF points, top-left origin.
 */
function computeTightBBox(words: Word[]): [number, number, number, number] {
  const minX = Math.min(...words.map(w => w.x));
  const minY = Math.min(...words.map(w => w.y));
  const maxX = Math.max(...words.map(w => w.x + w.width));
  const maxY = Math.max(...words.map(w => w.y + w.height));

  return [
    Math.round(minX),
    Math.round(minY),
    Math.round(maxX - minX),
    Math.round(maxY - minY),
  ];
}