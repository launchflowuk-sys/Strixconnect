---
name: Import mapping direction
description: The column-mapping convention for the Excel/CSV import pipeline — which direction the mapping object flows between frontend and backend.
---

## The Rule
The mapping object is always `{ spreadsheetHeader: assetField }` — spreadsheet column name as key, asset field name as value.

## Why
The frontend builds the mapping by iterating headers and letting the user pick an asset field for each:
```javascript
setMapping(m => ({ ...m, [header]: assetField }))
```
So `mapping["Property Reference No"] = "assetReference"`.

## How to Apply
The backend `mapRow` function must iterate in the correct direction:
```typescript
function mapRow(rawRow, mapping) {
  const mapped = {};
  for (const [srcCol, assetField] of Object.entries(mapping)) {
    // srcCol = spreadsheet header, assetField = DB field name
    if (assetField && rawRow[srcCol] !== undefined) {
      mapped[assetField] = String(rawRow[srcCol]);
    }
  }
  return mapped;
}
```

Reversed keys (`[assetField, srcCol]`) produce empty `mapped` objects — every import would silently create assets with null fields.

**Why:** The original code was written with the keys backwards (`[assetField, srcCol]` destructuring), causing every import to produce completely empty mapped data. This went undetected because validation only checks `mapped.assetType`, which would be empty and trigger a validation error — but the error message "assetType is required" didn't make the root cause obvious.
