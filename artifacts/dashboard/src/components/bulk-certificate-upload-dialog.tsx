import { useState, useRef, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileText, Loader2, CheckCircle2, AlertTriangle, XCircle,
  FolderOpen, ChevronRight, RotateCcw, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CertificateUploadDialog } from "./certificate-upload-dialog";

// ── Types ──────────────────────────────────────────────────────────────────────

type BulkFileStatus = "queued" | "processing" | "auto_committed" | "needs_review" | "error" | "resolved";

interface ExtractionResult {
  committed: boolean;
  filePath: string;
  extracted: Record<string, any>;
  confidence: Record<string, number>;
  discrepancies: any[];
  asset: { id: string; assetReference?: string; fullAddress?: string } | null;
  complianceType: { id: string; name: string; code: string } | null;
  serviceRecordId?: string;
  complianceItemId?: string;
  newStatus?: string;
  nextDueDate?: string;
  documentOnly?: boolean;
}

interface BulkFileEntry {
  id: string;
  file: File;
  status: BulkFileStatus;
  result?: ExtractionResult;
  error?: string;
  summary?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ALLOWED_EXTS = new Set([
  ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".tiff", ".tif", ".doc", ".docx", ".xls", ".xlsx", ".csv",
]);

function isAllowedFile(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  return ALLOWED_EXTS.has(ext);
}

async function readEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise(resolve => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    function next() {
      reader.readEntries(batch => {
        if (batch.length === 0) resolve(all);
        else { all.push(...batch); next(); }
      });
    }
    next();
  });
}

async function traverseDirectory(dir: FileSystemDirectoryEntry, out: File[]): Promise<void> {
  const entries = await readEntries(dir);
  await Promise.all(entries.map(entry => {
    if (entry.isFile) {
      return new Promise<void>(resolve => {
        (entry as FileSystemFileEntry).file(f => {
          if (isAllowedFile(f.name)) out.push(f);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      return traverseDirectory(entry as FileSystemDirectoryEntry, out);
    }
    return Promise.resolve();
  }));
}

async function getFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const promises: Promise<void>[] = [];
  for (const item of Array.from(dt.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (!entry) {
      const f = item.getAsFile();
      if (f && isAllowedFile(f.name)) out.push(f);
      continue;
    }
    if (entry.isFile) {
      promises.push(new Promise(resolve => {
        (entry as FileSystemFileEntry).file(f => {
          if (isAllowedFile(f.name)) out.push(f);
          resolve();
        });
      }));
    } else if (entry.isDirectory) {
      promises.push(traverseDirectory(entry as FileSystemDirectoryEntry, out));
    }
  }
  await Promise.all(promises);
  return out;
}

function buildSummary(result: ExtractionResult): string {
  if (result.documentOnly) {
    return `Document stored for ${result.asset?.fullAddress ?? result.asset?.assetReference ?? "property"}`;
  }
  const type = result.complianceType?.name ?? "Certificate";
  const addr = result.asset?.fullAddress ?? result.asset?.assetReference ?? "property";
  return `${type} · ${addr}`;
}

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BulkFileStatus, { label: string; icon: any; className: string }> = {
  queued:         { label: "Queued",        icon: FileText,      className: "text-muted-foreground" },
  processing:     { label: "Processing…",   icon: Loader2,       className: "text-primary animate-spin" },
  auto_committed: { label: "Committed",     icon: CheckCircle2,  className: "text-green-600" },
  needs_review:   { label: "Needs Review",  icon: AlertTriangle, className: "text-amber-600" },
  error:          { label: "Error",         icon: XCircle,       className: "text-destructive" },
  resolved:       { label: "Resolved",      icon: CheckCircle2,  className: "text-green-600" },
};

// ── Component ──────────────────────────────────────────────────────────────────

export function BulkCertificateUploadDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<BulkFileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [reviewEntry, setReviewEntry] = useState<BulkFileEntry | null>(null);
  const [batchStartTime, setBatchStartTime] = useState<number | null>(null);
  const [tickNow, setTickNow] = useState<number>(Date.now());
  const fileTimingsRef = useRef<number[]>([]);

  // ── Live ETA ticker — updates every second while processing ──────────────

  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [processing]);

  // ── Reset on close ────────────────────────────────────────────────────────

  function handleClose() {
    if (processing) return;
    setEntries([]);
    setDragOver(false);
    setReviewEntry(null);
    setBatchStartTime(null);
    fileTimingsRef.current = [];
    onOpenChange(false);
  }

  // ── Invalidate caches ─────────────────────────────────────────────────────

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["fetchComplianceRecords"] });
    qc.invalidateQueries({ queryKey: ["listDocuments"] });
    qc.invalidateQueries({ queryKey: ["listServiceRecords"] });
    qc.invalidateQueries({ queryKey: ["getComplianceItemHistory"] });
  }

  // ── Process a single file entry ───────────────────────────────────────────

  const processEntry = useCallback(async (entry: BulkFileEntry): Promise<BulkFileEntry> => {
    const fileStart = Date.now();
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: "processing" } : e));

    try {
      const buf = await entry.file.arrayBuffer();
      const res = await fetch("/api/certificate-extract", {
        method: "POST",
        headers: {
          "x-filename": encodeURIComponent(entry.file.name),
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${getToken()}`,
        },
        body: buf,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Extraction failed");
      }

      const data: ExtractionResult = await res.json();

      if (data.committed) {
        const updated: BulkFileEntry = {
          ...entry,
          status: "auto_committed",
          result: data,
          summary: buildSummary(data),
        };
        fileTimingsRef.current.push(Date.now() - fileStart);
        setEntries(prev => prev.map(e => e.id === entry.id ? updated : e));
        invalidateAll();
        return updated;
      } else {
        const updated: BulkFileEntry = {
          ...entry,
          status: "needs_review",
          result: data,
          summary: data.asset
            ? `${data.complianceType?.name ?? "Certificate"} · ${data.asset.fullAddress ?? data.asset.assetReference ?? ""}`
            : "Property not matched",
        };
        fileTimingsRef.current.push(Date.now() - fileStart);
        setEntries(prev => prev.map(e => e.id === entry.id ? updated : e));
        return updated;
      }
    } catch (err: any) {
      const updated: BulkFileEntry = {
        ...entry,
        status: "error",
        error: err.message || "Processing failed",
      };
      fileTimingsRef.current.push(Date.now() - fileStart);
      setEntries(prev => prev.map(e => e.id === entry.id ? updated : e));
      return updated;
    }
  }, [qc]);

  // ── Add files and kick off processing ─────────────────────────────────────

  const addAndProcess = useCallback(async (files: File[]) => {
    if (!files.length) return;

    const newEntries: BulkFileEntry[] = files.map(f => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file: f,
      status: "queued",
    }));

    fileTimingsRef.current = [];
    setBatchStartTime(Date.now());
    setEntries(prev => [...prev, ...newEntries]);
    setProcessing(true);

    for (const entry of newEntries) {
      await processEntry(entry);
    }

    setProcessing(false);
  }, [processEntry]);

  // ── Drop handler ──────────────────────────────────────────────────────────

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = await getFilesFromDataTransfer(e.dataTransfer);
    addAndProcess(files);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(f => isAllowedFile(f.name));
    e.target.value = "";
    addAndProcess(files);
  }

  // ── Computed state ────────────────────────────────────────────────────────

  const hasEntries = entries.length > 0;
  const committed = entries.filter(e => e.status === "auto_committed" || e.status === "resolved").length;
  const needsReview = entries.filter(e => e.status === "needs_review").length;
  const errors = entries.filter(e => e.status === "error").length;
  const queued = entries.filter(e => e.status === "queued" || e.status === "processing").length;
  const allDone = hasEntries && queued === 0;
  const processedCount = entries.length - queued;
  const progressPct = entries.length > 0 ? (processedCount / entries.length) * 100 : 0;

  // ── ETA calculation ───────────────────────────────────────────────────────

  function formatEta(): string | null {
    if (!processing || processedCount === 0 || fileTimingsRef.current.length === 0) return null;
    const timings = fileTimingsRef.current;
    const avgMs = timings.reduce((a, b) => a + b, 0) / timings.length;
    const remainingMs = avgMs * queued;
    const secs = Math.round(remainingMs / 1000);
    if (secs < 5) return null;
    if (secs < 60) return `~${secs}s remaining`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `~${m}m ${s}s remaining` : `~${m}m remaining`;
  }

  const eta = formatEta();
  void tickNow;

  // ── Download CSV summary ──────────────────────────────────────────────────

  function downloadSummary() {
    const STATUS_LABEL: Record<BulkFileStatus, string> = {
      queued:         "Queued",
      processing:     "Processing",
      auto_committed: "Committed",
      needs_review:   "Needs Review",
      error:          "Error",
      resolved:       "Resolved",
    };

    const headers = ["File", "Asset Reference", "Address", "Compliance Type", "Outcome", "Status"];

    const rows = entries.map(entry => {
      const r = entry.result;
      return [
        entry.file.name,
        r?.asset?.assetReference ?? "",
        r?.asset?.fullAddress ?? "",
        r?.complianceType?.name ?? "",
        entry.error ?? entry.summary ?? "",
        STATUS_LABEL[entry.status],
      ];
    });

    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map(row => row.map(escape).join(",")).join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    a.download = `bulk-upload-summary_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Retry errored ─────────────────────────────────────────────────────────

  async function retryEntry(entry: BulkFileEntry) {
    if (processing) return;
    setProcessing(true);
    await processEntry({ ...entry, status: "queued", error: undefined, result: undefined });
    setProcessing(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              {processing && entries.length > 0
                ? `Bulk Certificate Upload · ${processedCount} / ${entries.length}`
                : "Bulk Certificate Upload"}
            </DialogTitle>
            <DialogDescription>
              Drop a folder or select multiple files — each certificate is processed automatically.
            </DialogDescription>
          </DialogHeader>

          {/* ── Drop zone (shown always if not processing all) ── */}
          {(!hasEntries || allDone) && (
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                dragOver ? "border-primary bg-primary/5" : "hover:bg-muted/30",
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-full bg-primary/10 p-3">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium">
                    {allDone ? "Drop more files" : "Drop a folder or multiple files"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {allDone ? "or click to browse" : "Folders are scanned recursively · or click to browse"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">PDF · JPG · PNG · WebP · Word · Excel</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.tiff,.tif,.doc,.docx,.xls,.xlsx,.csv"
                onChange={handleFileInput}
              />
            </div>
          )}

          {/* ── While processing: progress bar ── */}
          {hasEntries && !allDone && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="font-medium text-foreground">{processedCount} / {entries.length}</span>
                  <span>processed</span>
                </span>
                {eta && (
                  <span className="text-muted-foreground text-xs">{eta}</span>
                )}
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* ── Progress list ── */}
          {hasEntries && (
            <>
              {/* Summary bar */}
              {allDone && (
                <div className="flex flex-wrap gap-2 text-sm">
                  {committed > 0 && (
                    <span className="flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {committed} committed
                    </span>
                  )}
                  {needsReview > 0 && (
                    <span className="flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {needsReview} need review
                    </span>
                  )}
                  {errors > 0 && (
                    <span className="flex items-center gap-1 text-destructive bg-destructive/10 border border-destructive/20 rounded-full px-2.5 py-0.5">
                      <XCircle className="h-3.5 w-3.5" />
                      {errors} failed
                    </span>
                  )}
                </div>
              )}

              <ScrollArea className="max-h-80 rounded-lg border">
                <div className="divide-y">
                  {entries.map(entry => {
                    const cfg = STATUS_CONFIG[entry.status];
                    const Icon = cfg.icon;
                    return (
                      <div key={entry.id} className="flex items-center gap-3 px-3 py-2.5">
                        <Icon className={cn("h-4 w-4 shrink-0", cfg.className)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{entry.file.name}</p>
                          {entry.summary && (
                            <p className="text-xs text-muted-foreground truncate">{entry.summary}</p>
                          )}
                          {entry.error && (
                            <p className="text-xs text-destructive truncate">{entry.error}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            variant={
                              entry.status === "auto_committed" || entry.status === "resolved"
                                ? "default"
                                : entry.status === "needs_review"
                                ? "secondary"
                                : entry.status === "error"
                                ? "destructive"
                                : "outline"
                            }
                            className="text-xs"
                          >
                            {cfg.label}
                          </Badge>
                          {entry.status === "needs_review" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              onClick={() => setReviewEntry(entry)}
                            >
                              Resolve
                              <ChevronRight className="h-3 w-3 ml-0.5" />
                            </Button>
                          )}
                          {entry.status === "error" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              title="Retry"
                              onClick={() => retryEntry(entry)}
                              disabled={processing}
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              {allDone && (
                <div className="flex gap-2">
                  <Button
                    onClick={downloadSummary}
                    variant="outline"
                    className="flex-1 gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download summary
                  </Button>
                  {needsReview === 0 && (
                    <Button onClick={handleClose} variant="outline" className="flex-1">
                      Close
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Per-file review dialog ── */}
      {reviewEntry && (
        <CertificateUploadDialog
          open={!!reviewEntry}
          onOpenChange={open => { if (!open) setReviewEntry(null); }}
          prefilledFile={reviewEntry.file}
          onSuccess={() => {
            setEntries(prev =>
              prev.map(e => e.id === reviewEntry.id ? { ...e, status: "resolved", summary: "Resolved by review" } : e)
            );
            setReviewEntry(null);
            invalidateAll();
          }}
        />
      )}
    </>
  );
}
