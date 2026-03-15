# SAY_EDIT Server | The Neural Core

> **The Spatial Intelligence Engine behind [SAY_EDIT](https://github.com/greatsage-raphael/say_edit)**
>
> *Handles PDF ingestion, sentence-level vector embedding, and spatial document search.*

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Core Pipelines](#core-pipelines)
  - [1. The Ingestion Pipeline](#1-the-ingestion-pipeline)
  - [2. The Vector Search Engine](#2-the-vector-search-engine)
- [Gemini Integration](#gemini-integration)
- [API Reference](#api-reference)
- [Directory Structure](#directory-structure)
- [Setup & Installation](#setup--installation)

---

## Overview

While the frontend handles real-time voice interaction, **GLYPH Server** acts as the "Neural Core" — a NestJS-based document intelligence layer. It is responsible for tasks that require heavy computational logic: parsing PDF geometry, splitting text into sentence-level chunks with tight bounding boxes, and powering vector similarity search so the AI can pinpoint *exactly* which sentence on *exactly* which page answers the user's question.

It listens for uploads from the frontend, immediately stores the PDF in Supabase Storage, and kicks off an asynchronous ingestion job that transforms the document into a spatially-aware vector store.

---

## System Architecture

The server operates as a bridge between the user's document (Supabase Storage) and Google's Generative Cloud.
```
PDF Upload → Storage → Sentence Extraction → Gemini Embeddings → Vector Store
                                                                        ↓
                              Frontend Voice Query → Embed Query → Vector Search → Spatial Chunks → AI
```

---

## Core Pipelines

### 1. The Ingestion Pipeline

**Goal:** Transform a raw PDF into a spatially-aware, sentence-level vector store.  
**Innovation:** Every chunk carries a precise `[x, y, width, height]` bounding box in PDF point coordinates, enabling the frontend to highlight the *exact* sentences the AI is referencing.

- **PDF Parser:** Uses `pdfjs-dist` in a headless Node environment (with a canvas stub to avoid display dependencies) to extract every text item with its raw transform matrix.
- **Coordinate Converter:** Flips the PDF's bottom-left Y origin to a top-left origin for compatibility with the browser's rendering coordinate system.
- **Line Grouper:** Clusters words into lines using a 4-point Y-proximity tolerance with a rolling average anchor to handle wide, uneven lines.
- **Sentence Chunker:** Merges lines into sentence-level chunks, flushing on `.`, `!`, `?` or after 300 characters. Fragments under 20 characters (headers, page numbers) are discarded.
- **Tight BBox Computer:** Computes the minimum bounding box across all words in a chunk — no padded paragraph boxes, just the exact ink region.
- **Embedding + Storage:** Each sentence chunk is embedded via `gemini-embedding-001` in rate-limit-friendly batches of 5, then stored in Supabase with its `page_number` and `bounding_box`.

### 2. The Vector Search Engine

**Goal:** Given a natural language query, return the most spatially relevant sentence chunks from a specific document.  
**Innovation:** Search is scoped strictly per-document via a dedicated Supabase RPC (`match_chunks_by_document`), preventing cross-document contamination even when multiple PDFs share similar content.

- **Query Embedding:** The user's query is embedded with `gemini-embedding-001` at search time.
- **Similarity Search:** A cosine similarity threshold of `0.3` filters out noise, returning up to 10 chunks ranked by relevance.
- **Spatial Payload:** Each result includes `page_number` and `bounding_box` — everything the frontend needs to jump to the page and draw yellow highlights.

---

## Gemini Integration

| Task | Model | Reason |
|:-----|:------|:--------|
| **Document Embedding** | `gemini-embedding-001` | High-quality semantic embeddings for sentence-level chunks |
| **Query Embedding** | `gemini-embedding-001` | Same embedding space as ingestion for accurate cosine similarity |

---

## API Reference

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/documents/upload` | Upload a PDF — triggers background ingestion |
| `GET` | `/documents/list?userId=` | List all documents for a user |
| `POST` | `/documents/query` | Vector search with `{ query, userId, documentId }` |
| `GET` | `/documents/health` | Health check |

---

## Directory Structure
```bash
/src
  /documents
    documents.controller.ts  # Endpoints: /upload, /list, /query, /health
    documents.service.ts     # Upload to Supabase Storage + DB record creation
    ingestion.service.ts     # PDF parsing, sentence chunking, bbox extraction, embedding
    search.service.ts        # Query embedding + Supabase vector RPC
    documents.module.ts      # Module wiring
  app.module.ts              # Root module + ConfigModule
  main.ts                    # Bootstrap, CORS, port config
```

---

## Setup & Installation

### Prerequisites

1. **Node.js 20+**
2. **Supabase Project** with:
   - A `documents` storage bucket (public)
   - A `documents` table (`id`, `user_id`, `name`, `file_url`, `created_at`)
   - A `document_chunks` table (`id`, `document_id`, `content`, `embedding` vector, `page_number`, `bounding_box`)
   - Two RPC functions: `match_chunks_by_document` and `match_document_chunks`
3. **Google Cloud Project** with Gemini API enabled.

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/your-repo/glyph-server.git
cd glyph-server
```

2. **Install dependencies**
```bash
npm install
```

3. **Environment variables**

Create a `.env` file in the root:
```env
# Google AI
GEMINI_API_KEY=AIza...

# Database & Storage
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Server Port
PORT=3001
```

4. **Run the server**
```bash
# Development
npm run start:dev

# Production
npm run start:prod
```

### Deploy to Google Cloud Run
```bash
gcloud run deploy glyph-server \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,GEMINI_API_KEY=..."
```