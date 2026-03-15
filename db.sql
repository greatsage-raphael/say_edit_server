-- 1. Enable necessary extensions
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- 2. Create the Documents Table
create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null, -- The Clerk User ID
  name text not null,    -- Original filename
  file_url text not null, -- Supabase Storage Public URL
  created_at timestamp with time zone default now()
);

-- 3. Create the Document Chunks Table (The Spatial Data)
create table if not exists document_chunks (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid references documents(id) on delete cascade,
  content text not null,      -- The paragraph text
  embedding vector(768),     -- Optimized for Gemini text-embedding-004
  page_number int not null,
  bounding_box float8[] not null, -- [x, y, width, height]
  created_at timestamp with time zone default now()
);

-- 4. Create a High-Performance Vector Index
-- This makes similarity searches much faster as your library grows
create index on document_chunks using hnsw (embedding vector_cosine_ops);


CREATE OR REPLACE FUNCTION match_chunks_by_document (
  query_embedding vector(3072),
  match_threshold float,
  match_count int,
  filter_document_id uuid
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  page_number int,
  bounding_box float8[],
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    dc.page_number,
    dc.bounding_box,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE dc.document_id = filter_document_id
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;