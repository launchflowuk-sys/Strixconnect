import path from "path";
import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { randomUUID } from "crypto";
import type { Response } from "express";

const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? path.join(process.cwd(), "uploads");

export async function ensureTenantDir(tenantId: string, sub: string = "documents"): Promise<string> {
  const dir = path.join(UPLOAD_ROOT, tenantId, sub);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function tenantPath(tenantId: string, sub: string, filename: string): string {
  return path.join(UPLOAD_ROOT, tenantId, sub, filename);
}

export function relativePath(tenantId: string, sub: string, filename: string): string {
  return `${tenantId}/${sub}/${filename}`;
}

export function absolutePath(rel: string): string {
  return path.join(UPLOAD_ROOT, rel);
}

export function assertWithinTenant(resolved: string, tenantId: string): void {
  const tenantRoot = path.resolve(UPLOAD_ROOT, tenantId);
  if (!resolved.startsWith(tenantRoot + path.sep) && resolved !== tenantRoot) {
    throw new Error("Path traversal detected");
  }
}

export async function saveFile(
  tenantId: string,
  sub: string,
  originalName: string,
  data: Buffer,
): Promise<{ relativePath: string; storedName: string }> {
  const safe = path.basename(originalName).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_") || "upload";
  const storedName = `${randomUUID()}_${safe}`;
  const dir = await ensureTenantDir(tenantId, sub);
  const dest = path.join(dir, storedName);
  const resolved = path.resolve(dest);
  assertWithinTenant(resolved, tenantId);
  await fs.writeFile(dest, data);
  return { relativePath: relativePath(tenantId, sub, storedName), storedName };
}

/**
 * Save a file to an exact path {tenantId}/{subPath}/{filename} (no UUID prefix).
 * Used for UPRN-keyed certificate storage: {tenantId}/{uprn}/{filename}.
 * If a file already exists at that path it is overwritten.
 */
export async function saveFileExact(
  tenantId: string,
  subPath: string,
  filename: string,
  data: Buffer,
): Promise<{ relativePath: string }> {
  const safe = path.basename(filename).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_") || "upload";
  const dir = path.join(UPLOAD_ROOT, tenantId, subPath);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, safe);
  const resolved = path.resolve(dest);
  assertWithinTenant(resolved, tenantId);
  await fs.writeFile(dest, data);
  return { relativePath: `${tenantId}/${subPath}/${safe}` };
}

export async function deleteFile(rel: string): Promise<void> {
  try {
    await fs.unlink(absolutePath(rel));
  } catch {
    // Ignore missing files
  }
}

export function streamFile(rel: string, res: Response, fileName: string, mimeType: string): void {
  const abs = absolutePath(rel);
  if (!existsSync(abs)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
  createReadStream(abs).pipe(res);
}

export function guessMime(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".tif",
  ".xlsx", ".xls", ".csv", ".doc", ".docx",
]);

export function isAllowedFileType(fileName: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}
