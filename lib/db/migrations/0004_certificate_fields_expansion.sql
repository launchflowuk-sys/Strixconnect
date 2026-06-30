-- Migration: Expand certificate field columns across service_records,
-- compliance_records, and asset_compliance_items
-- Applied: 2026-06-22
--
-- Adds dedicated columns for every field the AI extracts from a certificate
-- so data is queryable rather than buried in parsed_data JSON.
-- This migration is ALREADY APPLIED to the database (via drizzle-kit db push).
-- It is recorded here for audit purposes and production deployment.

-- service_records: add all missing extracted fields
ALTER TABLE service_records
  ADD COLUMN IF NOT EXISTS next_due_date         date,
  ADD COLUMN IF NOT EXISTS engineer_licence_number text,
  ADD COLUMN IF NOT EXISTS contractor            text,
  ADD COLUMN IF NOT EXISTS certificate_type      text,
  ADD COLUMN IF NOT EXISTS certificate_type_code text,
  ADD COLUMN IF NOT EXISTS condition             text,
  ADD COLUMN IF NOT EXISTS follow_on_required    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS observations          text[],
  ADD COLUMN IF NOT EXISTS uprn                  text,
  ADD COLUMN IF NOT EXISTS property_address      text;

-- compliance_records: add all missing extracted fields
ALTER TABLE compliance_records
  ADD COLUMN IF NOT EXISTS engineer_name         text,
  ADD COLUMN IF NOT EXISTS engineer_licence_number text,
  ADD COLUMN IF NOT EXISTS outcome               text,
  ADD COLUMN IF NOT EXISTS certificate_type      text,
  ADD COLUMN IF NOT EXISTS certificate_type_code text,
  ADD COLUMN IF NOT EXISTS observations          text[],
  ADD COLUMN IF NOT EXISTS uprn                  text,
  ADD COLUMN IF NOT EXISTS property_address      text;

-- asset_compliance_items: add engineer/certificate context columns + raw outcome + observations
ALTER TABLE asset_compliance_items
  ADD COLUMN IF NOT EXISTS engineer_name         text,
  ADD COLUMN IF NOT EXISTS engineer_licence_number text,
  ADD COLUMN IF NOT EXISTS outcome               text,
  ADD COLUMN IF NOT EXISTS certificate_type      text,
  ADD COLUMN IF NOT EXISTS certificate_type_code text,
  ADD COLUMN IF NOT EXISTS observations          text[];
