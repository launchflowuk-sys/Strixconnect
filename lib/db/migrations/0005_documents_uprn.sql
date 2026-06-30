-- Migration: Add uprn column to documents table
-- Applied: 2026-06-22

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS uprn text;

CREATE INDEX IF NOT EXISTS idx_documents_uprn ON documents (uprn);
