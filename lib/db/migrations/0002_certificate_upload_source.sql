-- Migration: Add 'certificate_upload' to change_source enum
-- Applied: 2026-06-22
--
-- Adds the certificate_upload value used by the AI certificate reading feature.
-- This migration is ALREADY APPLIED to the database (via drizzle-kit db push).
-- It is recorded here for audit purposes and production deployment.

ALTER TYPE change_source ADD VALUE IF NOT EXISTS 'certificate_upload';
