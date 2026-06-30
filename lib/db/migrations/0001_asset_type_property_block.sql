-- Migration: Restructure asset_type enum to property/block model
-- Applied: 2026-06-21
--
-- Before: asset_type enum had 12 values: house, flat, block, maisonette,
--         bungalow, commercial, garage, communal, land, hmo, traveller_site, other
--
-- After:  asset_type enum has 2 values: property, block
--         Dwelling-level types (house, flat, etc.) move to the property_subtype text column
--
-- This migration is ALREADY APPLIED to the database. It is recorded here for audit purposes.

-- Step 1: Add 'property' to the existing enum (non-blocking in Postgres)
ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'property';

-- Step 2: Migrate all non-block assets — copy old asset_type value to property_subtype,
--         then set asset_type = 'property' for all non-block rows
UPDATE assets
SET
  property_subtype = COALESCE(NULLIF(property_subtype, ''), asset_type::text),
  asset_type = 'property'
WHERE asset_type NOT IN ('block', 'property');

-- Step 3: Create the replacement enum with only the two top-level values
CREATE TYPE asset_type_new AS ENUM ('property', 'block');

-- Step 4: Change the column to use the new enum
ALTER TABLE assets
  ALTER COLUMN asset_type TYPE asset_type_new
  USING asset_type::text::asset_type_new;

-- Step 5: Drop the old enum and rename the new one to take its place
DROP TYPE asset_type;
ALTER TYPE asset_type_new RENAME TO asset_type;
