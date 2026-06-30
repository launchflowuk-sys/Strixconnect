-- Migration: Add parsed_data jsonb column to compliance_records
-- Applied: 2026-06-22
--
-- Stores the full AI-extracted payload (all fields + confidence map) from
-- the certificate upload feature, enabling complete audit trail queries.
-- This migration is ALREADY APPLIED to the database (via drizzle-kit db push).
-- It is recorded here for audit purposes and production deployment.

ALTER TABLE compliance_records
  ADD COLUMN IF NOT EXISTS parsed_data jsonb;
