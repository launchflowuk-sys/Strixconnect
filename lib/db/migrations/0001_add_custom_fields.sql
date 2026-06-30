-- Migration: add custom field columns to compliance tables
-- Applied via: drizzle-kit push (columns already live in DB)
-- Safe to re-run: IF NOT EXISTS guards prevent errors on re-application

ALTER TABLE compliance_types
  ADD COLUMN IF NOT EXISTS custom_field_definitions jsonb;

ALTER TABLE asset_compliance_items
  ADD COLUMN IF NOT EXISTS custom_fields jsonb;

ALTER TABLE compliance_records
  ADD COLUMN IF NOT EXISTS custom_fields jsonb;
