import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListAssets } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileText, Loader2, AlertTriangle,
  Sparkles, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

type UploadState = "idle" | "reading" | "discrepancies" | "committing";

interface Discrepancy {
  type: string;
  field?: string;
  message: string;
  value?: string;
  confidence?: number;
  candidates?: any[];
  extractedUprn?: string;
  extractedAddress?: string;
}

interface ExtractionResult {
  committed: boolean;
  filePath: string;
  extracted: Record<string, any>;
  confidence: Record<string, number>;
  discrepancies: Discrepancy[];
  asset: { id: string; assetReference?: string; fullAddress?: string } | null;
  complianceType: { id: string; name: string; code: string } | null;
  serviceRecordId?: string;
  complianceItemId?: string;
  newStatus?: string;
  nextDueDate?: string;
  documentOnly?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefilledItemId?: string;
  prefilledAssetName?: string;
  prefilledTypeName?: string;
  prefilledFile?: File;
  onSuccess?: (result: ExtractionResult) => void;
}

function fmtDate(d?: string | null) {
  if (!d) return null;
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return d; }
}

const BLOCKER_TYPES = new Set(["asset_not_found", "asset_multiple", "no_compliance_items", "type_ambiguous", "type_mismatch"]);

export function CertificateUploadDialog({
  open, onOpenChange, prefilledItemId, prefilledAssetName, prefilledTypeName, prefilledFile, onSuccess,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [resolvedValues, setResolvedValues] = useState<Record<string, string>>({});

  const { data: assetsData } = useListAssets({ limit: 500 });
  const assetList = assetsData?.data ?? [];

  // Auto-process when opened with a pre-filled file (from bulk upload)
  const processedFileRef = useRef<File | null>(null);
  useLayoutEffect(() => {
    if (open && prefilledFile && processedFileRef.current !== prefilledFile && state === "idle") {
      processedFileRef.current = prefilledFile;
      processFile(prefilledFile);
    }
    if (!open) {
      processedFileRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefilledFile]);

  function resetDialog() {
    setState("idle");
    setResult(null);
    setResolvedValues({});
  }

  function handleClose() {
    resetDialog();
    onOpenChange(false);
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["fetchComplianceRecords"] });
    qc.invalidateQueries({ queryKey: ["listDocuments"] });
    qc.invalidateQueries({ queryKey: ["listServiceRecords"] });
    qc.invalidateQueries({ queryKey: ["getComplianceItemHistory"] });
  }

  function buildToastMessage(data: ExtractionResult): string {
    if (data.documentOnly) {
      const address = data.asset?.fullAddress ?? data.asset?.assetReference ?? "property";
      return `Document stored for ${address}`;
    }
    const certType = data.complianceType?.name ?? "Certificate";
    const address = data.asset?.fullAddress ?? data.asset?.assetReference ?? "the property";
    const expiry = data.nextDueDate ? ` — expires ${fmtDate(data.nextDueDate)}` : "";
    return `${certType} committed for ${address}${expiry}`;
  }

  const processFile = useCallback(async (file: File) => {
    setState("reading");
    try {
      const buf = await file.arrayBuffer();
      const headers: Record<string, string> = {
        "x-filename": file.name,
        "Content-Type": "application/octet-stream",
        Authorization: `Bearer ${getToken()}`,
      };
      if (prefilledItemId) headers["x-compliance-item-id"] = prefilledItemId;

      const res = await fetch("/api/certificate-extract", {
        method: "POST",
        headers,
        body: buf,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Extraction failed");
      }

      const data: ExtractionResult = await res.json();
      setResult(data);

      if (data.committed) {
        invalidateAll();
        onSuccess?.(data);
        handleClose();
        toast({ title: buildToastMessage(data) });
      } else {
        setState("discrepancies");
      }
    } catch (err: any) {
      setState("idle");
      toast({ title: err.message || "Failed to process file", variant: "destructive" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledItemId, qc, onSuccess, onOpenChange]);

  async function commitWithResolved(data: ExtractionResult, resolved: Record<string, string>) {
    setState("committing");
    try {
      const assetId = resolved["assetId"] ?? data.asset?.id;
      const complianceItemId = resolved["complianceItemId"] ?? data.complianceItemId;

      if (!assetId || !complianceItemId) {
        throw new Error(
          "Could not determine which compliance record to update. " +
          "Please select the property and compliance type manually before saving."
        );
      }

      const extracted = { ...data.extracted };
      for (const [key, val] of Object.entries(resolved)) {
        if (!["assetId", "complianceItemId"].includes(key)) {
          extracted[key] = val;
        }
      }

      const res = await fetch("/api/certificate-extract/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ filePath: data.filePath, extracted, assetId, complianceItemId, confidence: data.confidence }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Commit failed");
      }

      const committed: ExtractionResult = await res.json();
      invalidateAll();
      onSuccess?.(committed);
      handleClose();
      toast({ title: buildToastMessage(committed) });
    } catch (err: any) {
      setState("discrepancies");
      toast({ title: err.message || "Failed to save", variant: "destructive" });
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  // ── Blocker resolution helpers ────────────────────────────────────────────
  const blockerDiscrepancies = result?.discrepancies.filter(d => BLOCKER_TYPES.has(d.type)) ?? [];
  const warningDiscrepancies = result?.discrepancies.filter(d => !BLOCKER_TYPES.has(d.type)) ?? [];
  const allBlockersResolved = blockerDiscrepancies.every(d => {
    if (d.type === "asset_not_found" || d.type === "asset_multiple") return !!resolvedValues["assetId"] && !!resolvedValues["complianceItemId"];
    if (d.type === "type_ambiguous") return !!resolvedValues["complianceItemId"];
    if (d.type === "type_mismatch") return resolvedValues["type_mismatch_confirmed"] === "true";
    return true;
  });

  // Auto-commit once user resolves all blockers
  useEffect(() => {
    if (state === "discrepancies" && blockerDiscrepancies.length > 0 && allBlockersResolved && result) {
      commitWithResolved(result, resolvedValues);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBlockersResolved, state]);

  const selectedAssetId = resolvedValues["assetId"] ?? result?.asset?.id ?? "";
  const candidateItems: any[] = blockerDiscrepancies.find(d => d.type === "type_ambiguous")?.candidates ?? [];
  const assetCandidates: any[] = blockerDiscrepancies.find(d => d.type === "asset_multiple")?.candidates ?? [];

  async function handleAssetSelect(assetId: string) {
    setResolvedValues(prev => ({ ...prev, assetId, complianceItemId: "" }));
  }

  async function handleItemSelect(candidate: { complianceItemId: string; name: string }) {
    setResolvedValues(prev => ({ ...prev, complianceItemId: candidate.complianceItemId }));
  }

  const [assetItems, setAssetItems] = useState<any[]>([]);
  async function loadItemsForAsset(assetId: string) {
    try {
      const res = await fetch(`/api/assets/${assetId}/compliance?limit=50`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAssetItems(data?.data ?? data ?? []);
      }
    } catch { setAssetItems([]); }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Upload Certificate
          </DialogTitle>
          {(prefilledAssetName || prefilledTypeName) && (
            <DialogDescription className="flex items-center gap-1 text-sm">
              <Building2 className="h-3 w-3" />
              {prefilledAssetName}{prefilledTypeName && ` · ${prefilledTypeName}`}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* ── IDLE: drop zone ─────────────────────────────────────────────── */}
        {state === "idle" && (
          <div className="space-y-4">
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                dragOver ? "border-primary bg-primary/5" : "hover:bg-muted/30",
              )}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-full bg-primary/10 p-3">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Drop your certificate here</p>
                  <p className="text-sm text-muted-foreground mt-0.5">or click to browse</p>
                </div>
                <p className="text-xs text-muted-foreground">PDF · JPG · PNG · WebP · Word · Excel</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.tiff,.tif,.doc,.docx,.xls,.xlsx,.csv"
                onChange={handleFileChange}
              />
            </div>
            <p className="text-xs text-center text-muted-foreground">
              The AI reads PDF and image certificates automatically. Other file types are stored and linked to the property.
            </p>
          </div>
        )}

        {/* ── READING / COMMITTING ─────────────────────────────────────────── */}
        {(state === "reading" || state === "committing") && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="relative">
              <div className="rounded-full bg-primary/10 p-5">
                <FileText className="h-8 w-8 text-primary" />
              </div>
              <Loader2 className="absolute -right-1 -bottom-1 h-5 w-5 text-primary animate-spin" />
            </div>
            <div className="text-center">
              <p className="font-medium">
                {state === "committing" ? "Saving records…" : "Reading certificate with AI…"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {state === "committing" ? "Updating compliance item and service record." : "Extracting dates, certificate ref, engineer details and more."}
              </p>
            </div>
          </div>
        )}

        {/* ── DISCREPANCIES (genuine blockers need user input) ─────────────── */}
        {state === "discrepancies" && result && (
          <div className="space-y-4">
            {/* What was read summary */}
            {result.extracted && Object.keys(result.extracted).length > 0 && (
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium text-xs uppercase text-muted-foreground tracking-wide mb-2">What was read</p>
                {[
                  ["Certificate Ref", result.extracted.certificateRef],
                  ["Inspection Date", fmtDate(result.extracted.inspectionDate)],
                  ["Expiry Date", fmtDate(result.extracted.expiryDate ?? result.extracted.nextDueDate)],
                  ["Engineer", result.extracted.engineerName],
                  ["Contractor", result.extracted.contractor],
                  ["Outcome", result.extracted.outcome?.replace("_", " ")],
                ].filter(([, v]) => v).map(([label, val]) => (
                  <div key={String(label)} className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">{label}</span>
                    <span className="font-medium text-right capitalize">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Blockers */}
            {blockerDiscrepancies.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium flex items-center gap-1.5 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  {blockerDiscrepancies.length === 1 ? "1 item needs your input" : `${blockerDiscrepancies.length} items need your input`}
                </p>

                {blockerDiscrepancies.map((d, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <p className="text-sm text-muted-foreground">{d.message}</p>

                    {/* Asset not found → search */}
                    {d.type === "asset_not_found" && (
                      <div className="space-y-2">
                        <Label className="text-xs">Select asset</Label>
                        <Select
                          value={resolvedValues["assetId"] ?? ""}
                          onValueChange={async (val) => {
                            await handleAssetSelect(val);
                            await loadItemsForAsset(val);
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Search assets…" />
                          </SelectTrigger>
                          <SelectContent>
                            {assetList.map((a: any) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.assetReference ? `${a.assetReference} — ` : ""}{a.fullAddress ?? a.id.slice(0, 8)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {resolvedValues["assetId"] && assetItems.length > 0 && (
                          <div className="space-y-1">
                            <Label className="text-xs">Select compliance item</Label>
                            {assetItems.map((item: any) => (
                              <button
                                key={item.id}
                                className={cn(
                                  "w-full text-left text-sm px-3 py-2 rounded border transition-colors",
                                  resolvedValues["complianceItemId"] === item.id
                                    ? "border-primary bg-primary/5"
                                    : "hover:bg-muted/50",
                                )}
                                onClick={() => handleItemSelect({ complianceItemId: item.id, name: item.complianceType?.name ?? "" })}
                              >
                                {item.complianceType?.name ?? item.complianceTypeId?.slice(0, 8)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Multiple asset candidates → radio */}
                    {d.type === "asset_multiple" && (
                      <div className="space-y-1.5">
                        {d.candidates?.map((c: any) => (
                          <button
                            key={c.id}
                            className={cn(
                              "w-full text-left text-sm px-3 py-2 rounded border transition-colors",
                              resolvedValues["assetId"] === c.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                            )}
                            onClick={async () => {
                              await handleAssetSelect(c.id);
                              await loadItemsForAsset(c.id);
                            }}
                          >
                            <span className="font-medium">{c.assetReference || c.id.slice(0, 8)}</span>
                            {c.uprn && <span className="text-muted-foreground ml-2">UPRN {c.uprn}</span>}
                            {c.fullAddress && <p className="text-xs text-muted-foreground mt-0.5">{c.fullAddress}</p>}
                          </button>
                        ))}
                        {resolvedValues["assetId"] && assetItems.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <Label className="text-xs">Select compliance item</Label>
                            {assetItems.map((item: any) => (
                              <button
                                key={item.id}
                                className={cn(
                                  "w-full text-left text-sm px-3 py-2 rounded border transition-colors",
                                  resolvedValues["complianceItemId"] === item.id
                                    ? "border-primary bg-primary/5"
                                    : "hover:bg-muted/50",
                                )}
                                onClick={() => handleItemSelect({ complianceItemId: item.id, name: item.complianceType?.name ?? "" })}
                              >
                                {item.complianceType?.name ?? item.complianceTypeId?.slice(0, 8)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Type ambiguous → select compliance item */}
                    {d.type === "type_ambiguous" && (
                      <div className="space-y-1.5">
                        {d.candidates?.map((c: any) => (
                          <button
                            key={c.complianceItemId}
                            className={cn(
                              "w-full text-left text-sm px-3 py-2 rounded border transition-colors",
                              resolvedValues["complianceItemId"] === c.complianceItemId
                                ? "border-primary bg-primary/5"
                                : "hover:bg-muted/50",
                            )}
                            onClick={() => handleItemSelect({ complianceItemId: c.complianceItemId, name: c.name })}
                          >
                            <span className="font-medium">{c.name}</span>
                            {c.code && <span className="ml-2 text-xs text-muted-foreground font-mono">{c.code}</span>}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Type mismatch → confirm or cancel */}
                    {d.type === "type_mismatch" && (
                      <div className="flex gap-2 mt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={handleClose}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={resolvedValues["type_mismatch_confirmed"] === "true"}
                          onClick={() => setResolvedValues(prev => ({ ...prev, type_mismatch_confirmed: "true" }))}
                        >
                          {resolvedValues["type_mismatch_confirmed"] === "true" ? "Confirmed" : "Proceed anyway"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Non-blocker warnings — informational only */}
            {warningDiscrepancies.length > 0 && blockerDiscrepancies.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Review these fields after saving</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {warningDiscrepancies.slice(0, 3).map((d, i) => (
                      <li key={i}>{d.message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Editable warning fields */}
            {warningDiscrepancies.filter(d => d.field && d.type === "low_confidence").length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Check these values</p>
                {warningDiscrepancies.filter(d => d.field && d.type === "low_confidence").map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Label className="shrink-0 w-36 text-xs capitalize text-muted-foreground">{d.field?.replace(/([A-Z])/g, " $1")}</Label>
                    <Input
                      className="h-7 text-sm"
                      defaultValue={d.value ?? ""}
                      onChange={e => setResolvedValues(prev => ({ ...prev, [d.field!]: e.target.value }))}
                    />
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" aria-label={`${Math.round((d.confidence ?? 0) * 100)}% confidence`} />
                  </div>
                ))}
              </div>
            )}

            {/* When warnings only (no blockers): show explicit Save button */}
            {blockerDiscrepancies.length === 0 && (
              <Button
                className="w-full"
                onClick={() => result && commitWithResolved(result, resolvedValues)}
              >
                Save
              </Button>
            )}
            {blockerDiscrepancies.length > 0 && allBlockersResolved && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
