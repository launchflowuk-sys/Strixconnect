import { useState, useEffect, useRef } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAllComplianceItems,
  getListAllComplianceItemsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Search, AlertTriangle, Clock, CheckCircle2,
  ChevronLeft, ChevronRight, ArrowLeft, ShieldCheck,
  Upload, Download, FileSpreadsheet, CheckCircle, XCircle, Loader2,
  Columns3,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { getToken } from "@/lib/auth";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon?: any; color: string }> = {
  compliant:          { label: "Compliant",         variant: "default",     icon: CheckCircle2,  color: "text-green-600" },
  due_soon:           { label: "Due Soon",           variant: "secondary",   icon: Clock,         color: "text-amber-600" },
  overdue:            { label: "Overdue",            variant: "destructive", icon: AlertTriangle, color: "text-destructive" },
  failed:             { label: "Failed",             variant: "destructive", icon: AlertTriangle, color: "text-destructive" },
  not_applicable:     { label: "N/A",                variant: "outline",                          color: "text-muted-foreground" },
  awaiting_evidence:  { label: "Awaiting Evidence",  variant: "secondary",                        color: "text-muted-foreground" },
  follow_on_required: { label: "Follow-on Required", variant: "secondary",   icon: AlertTriangle, color: "text-orange-600" },
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due Soon" },
  { value: "follow_on_required", label: "Follow-on Required" },
  { value: "failed", label: "Failed" },
  { value: "awaiting_evidence", label: "Awaiting Evidence" },
  { value: "compliant", label: "Compliant" },
  { value: "not_applicable", label: "N/A" },
];

// Standard compliance fields staff can map an extra column to
const MAPPABLE_FIELDS = [
  { value: "skip",               label: "Skip — ignore this column" },
  { value: "notes",              label: "Add to Notes" },
  { value: "lastInspectionDate", label: "→ Last Inspection Date" },
  { value: "nextDueDate",        label: "→ Next Due Date" },
  { value: "certificateRef",     label: "→ Certificate Ref" },
  { value: "condition",          label: "→ Condition" },
  { value: "contractor",         label: "→ Contractor" },
  { value: "followOnRequired",   label: "→ Follow-on Required (YES/NO)" },
  { value: "status",             label: "→ Status" },
];

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return d; }
}

type TypeSummary = {
  typeId: string; typeName: string; typeCode: string; typeColor: string | null;
  overdue: number; due_soon: number; follow_on_required: number; failed: number;
  awaiting_evidence: number; compliant: number; not_applicable: number; total: number;
};

type PreviewRow = {
  row: number; uprn: string | null; address: string | null;
  matched: boolean; itemId: string | null;
  lastInspectionDate: string | null; nextDueDate: string | null;
  status: string | null; errors: string[];
};

type UnmappedColumn = {
  header: string;       // original header as it appears in the file
  nhHeader: string;     // normalised key used by the backend
  samples: string[];    // up to 3 non-empty sample values
};

type PreviewResult = {
  sessionId: string; totalRows: number; matched: number; errored: number;
  preview: PreviewRow[];
  unmappedColumns: UnmappedColumn[];
};

type ImportResult = { updated: number; skipped: number; errors: number };

// ── Import Dialog ──────────────────────────────────────────────────────────────

function ImportDialog({
  open, onClose, typeId, typeName,
  onImported,
}: {
  open: boolean; onClose: () => void;
  typeId: string; typeName: string;
  onImported: () => void;
}) {
  const [step, setStep] = useState<"idle" | "uploading" | "preview" | "mapping" | "executing" | "done">("idle");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({}); // nhHeader → action
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("idle");
    setPreview(null);
    setColumnMappings({});
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      const token = getToken();
      const res = await fetch(`${BASE}/api/compliance-imports/template/${typeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `compliance-template-${typeName.replace(/[^a-z0-9]/gi, "_")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setStep("uploading");
    try {
      const token = getToken();
      const res = await fetch(`${BASE}/api/compliance-imports/preview/${typeId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "x-filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const pResult = data as PreviewResult;
      setPreview(pResult);
      // Initialise all extra columns to "skip" by default
      if (pResult.unmappedColumns?.length > 0) {
        const defaults: Record<string, string> = {};
        for (const col of pResult.unmappedColumns) defaults[col.nhHeader] = "skip";
        setColumnMappings(defaults);
      } else {
        setColumnMappings({});
      }
      setStep("preview");
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
      setStep("idle");
    }
  }

  async function handleExecute() {
    if (!preview) return;
    setStep("executing");
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${BASE}/api/compliance-imports/execute/${typeId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: preview.sessionId, columnMappings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult(data as ImportResult);
      setStep("done");
      onImported();
    } catch (e: any) {
      setError(e.message ?? "Import failed");
      setStep(preview?.unmappedColumns?.length > 0 ? "mapping" : "preview");
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  const hasUnmapped = (preview?.unmappedColumns?.length ?? 0) > 0;
  const mappedToFieldCount = Object.values(columnMappings).filter(v => v !== "skip").length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
            Import Compliance Data — {typeName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">

          {/* ── Step: idle / uploading ── */}
          {(step === "idle" || step === "uploading") && (
            <div className="space-y-5">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-medium">Step 1 — Download the template</p>
                <p className="text-xs text-muted-foreground">
                  The template is pre-filled with all assets assigned to this compliance type.
                  Fill in inspection dates, contractor, status, and any observations, then upload it below.
                </p>
                <Button
                  variant="outline" size="sm"
                  onClick={handleDownloadTemplate}
                  disabled={downloading}
                  className="mt-1"
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                  Download Template (.xlsx)
                </Button>
              </div>

              <div className="rounded-lg border border-dashed bg-muted/10 p-6 text-center space-y-3">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Step 2 — Upload filled spreadsheet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Accepts .xlsx files. Both the Thurrock tracker format and the template format are supported.
                    Any extra columns in your file will be shown for optional mapping.
                  </p>
                </div>
                <Button
                  variant="default" size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={step === "uploading"}
                >
                  {step === "uploading"
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Reading file…</>
                    : <><Upload className="h-4 w-4 mr-2" />Choose File</>}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 shrink-0" />{error}
                </p>
              )}
            </div>
          )}

          {/* ── Step: preview ── */}
          {step === "preview" && preview && (
            <div className="space-y-4">
              {/* Summary counts */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{preview.totalRows}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Rows in file</div>
                </div>
                <div className="rounded-lg border p-3 text-center bg-green-50 dark:bg-green-950/20">
                  <div className="text-2xl font-bold text-green-600">{preview.matched}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Ready to import</div>
                </div>
                <div className={`rounded-lg border p-3 text-center ${preview.errored > 0 ? "bg-destructive/10" : ""}`}>
                  <div className={`text-2xl font-bold ${preview.errored > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {preview.errored}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Unmatched / errors</div>
                </div>
              </div>

              {/* Extra columns notice */}
              {hasUnmapped && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 flex items-start gap-2.5">
                  <Columns3 className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      {preview.unmappedColumns.length} extra column{preview.unmappedColumns.length !== 1 ? "s" : ""} detected
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      Your file contains columns not in the standard template. Click "Review columns" to choose whether to include them in the import.
                    </p>
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div className="rounded-md border overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>UPRN</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Inspection Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-8"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.preview.map(row => (
                        <TableRow key={row.row} className={row.errors.length > 0 ? "bg-destructive/5" : ""}>
                          <TableCell className="text-xs text-muted-foreground">{row.row}</TableCell>
                          <TableCell className="font-mono text-xs">{row.uprn ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[160px] truncate" title={row.address ?? ""}>
                            {row.address ?? (row.errors.length > 0 ? (
                              <span className="text-destructive text-xs">{row.errors[0]}</span>
                            ) : "—")}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(row.lastInspectionDate)}</TableCell>
                          <TableCell className="text-xs">
                            {row.status ? (
                              <Badge variant={(STATUS_CONFIG[row.status]?.variant ?? "outline") as any} className="text-xs">
                                {STATUS_CONFIG[row.status]?.label ?? row.status}
                              </Badge>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            {row.matched
                              ? <CheckCircle className="h-4 w-4 text-green-500" />
                              : <XCircle className="h-4 w-4 text-destructive" />}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              {preview.totalRows > 200 && (
                <p className="text-xs text-muted-foreground">Showing first 200 rows of {preview.totalRows}. All rows will be imported.</p>
              )}

              {error && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 shrink-0" />{error}
                </p>
              )}
            </div>
          )}

          {/* ── Step: mapping ── */}
          {step === "mapping" && preview && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Columns3 className="h-4 w-4" />
                  Extra columns in your file
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  These column headers weren't recognised as standard fields.
                  Choose what to do with each one — map it to a compliance field, add its value to Notes, or skip it entirely.
                </p>
              </div>

              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column in your file</TableHead>
                      <TableHead>Sample values</TableHead>
                      <TableHead className="w-52">Map to</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.unmappedColumns.map(col => (
                      <TableRow key={col.nhHeader}>
                        <TableCell className="font-medium text-sm">{col.header}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {col.samples.length > 0
                              ? col.samples.map((s, i) => (
                                  <span
                                    key={i}
                                    className="inline-block max-w-[120px] truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                                    title={s}
                                  >
                                    {s}
                                  </span>
                                ))
                              : <span className="text-xs text-muted-foreground italic">empty</span>
                            }
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={columnMappings[col.nhHeader] ?? "skip"}
                            onValueChange={v =>
                              setColumnMappings(prev => ({ ...prev, [col.nhHeader]: v }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MAPPABLE_FIELDS.map(f => (
                                <SelectItem key={f.value} value={f.value} className="text-xs">
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {mappedToFieldCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {mappedToFieldCount} column{mappedToFieldCount !== 1 ? "s" : ""} will be included in the import.
                </p>
              )}

              {error && (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 shrink-0" />{error}
                </p>
              )}
            </div>
          )}

          {/* ── Step: executing ── */}
          {step === "executing" && (
            <div className="py-10 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Importing {preview?.matched} records…</p>
            </div>
          )}

          {/* ── Step: done ── */}
          {step === "done" && result && (
            <div className="py-6 space-y-4 text-center">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
              <h3 className="font-semibold text-lg">Import complete</h3>
              <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
                <div className="rounded-lg border p-3">
                  <div className="text-xl font-bold text-green-600">{result.updated}</div>
                  <div className="text-xs text-muted-foreground">Updated</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xl font-bold text-muted-foreground">{result.skipped}</div>
                  <div className="text-xs text-muted-foreground">Skipped</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className={`text-xl font-bold ${result.errors > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {result.errors}
                  </div>
                  <div className="text-xs text-muted-foreground">Errors</div>
                </div>
              </div>
            </div>
          )}

        </div>{/* end scroll container */}

        <DialogFooter className="pt-2 border-t mt-2">
          {step === "idle" || step === "uploading" ? (
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          ) : step === "preview" ? (
            <>
              <Button variant="ghost" onClick={reset}>← Re-upload</Button>
              {hasUnmapped ? (
                <Button onClick={() => setStep("mapping")}>
                  <Columns3 className="h-4 w-4 mr-2" />
                  Review {preview!.unmappedColumns.length} extra column{preview!.unmappedColumns.length !== 1 ? "s" : ""} →
                </Button>
              ) : (
                <Button
                  onClick={handleExecute}
                  disabled={preview?.matched === 0}
                >
                  Import {preview?.matched} record{preview?.matched !== 1 ? "s" : ""}
                </Button>
              )}
            </>
          ) : step === "mapping" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("preview")}>← Back to preview</Button>
              <Button
                onClick={handleExecute}
                disabled={preview?.matched === 0}
              >
                Confirm and Import {preview?.matched} record{preview?.matched !== 1 ? "s" : ""}
              </Button>
            </>
          ) : step === "executing" ? (
            <Button disabled><Loader2 className="h-4 w-4 animate-spin mr-2" />Importing…</Button>
          ) : (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ComplianceTypeDashboard() {
  const { typeId } = useParams<{ typeId: string }>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const LIMIT = 50;

  const [typeSummary, setTypeSummary] = useState<TypeSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  function loadSummary() {
    setSummaryLoading(true);
    const token = getToken();
    fetch(`${BASE}/api/compliance-items/summary-by-type`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        const found = (data.types ?? []).find((t: TypeSummary) => t.typeId === typeId) ?? null;
        setTypeSummary(found);
        setSummaryLoading(false);
      })
      .catch(() => setSummaryLoading(false));
  }

  useEffect(() => {
    loadSummary();
  }, [typeId]);

  const params = {
    complianceTypeId: typeId,
    status: status || undefined,
    page,
    limit: LIMIT,
  };

  const { data: result, isLoading } = useListAllComplianceItems(params, {
    query: { queryKey: getListAllComplianceItemsQueryKey(params) },
  });

  const items = (result?.data ?? []).filter((item: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      item.assetReference?.toLowerCase().includes(s) ||
      item.fullAddress?.toLowerCase().includes(s) ||
      item.addressLine1?.toLowerCase().includes(s)
    );
  });

  const total = result?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const kpis = [
    { key: "overdue",            label: "Overdue",       color: "text-destructive",  bg: "bg-destructive/10",                       icon: AlertTriangle },
    { key: "due_soon",           label: "Due Soon",      color: "text-amber-600",    bg: "bg-amber-50 dark:bg-amber-950/20",        icon: Clock },
    { key: "follow_on_required", label: "Follow-on",     color: "text-orange-600",   bg: "bg-orange-50 dark:bg-orange-950/20",      icon: AlertTriangle },
    { key: "compliant",          label: "Compliant",     color: "text-green-600",    bg: "bg-green-50 dark:bg-green-950/20",        icon: CheckCircle2 },
    { key: "not_applicable",     label: "N/A",           color: "text-muted-foreground", bg: "bg-muted/30",                         icon: null },
    { key: "awaiting_evidence",  label: "Awaiting",      color: "text-muted-foreground", bg: "bg-muted/30",                         icon: null },
  ];

  const typeTotal = typeSummary?.total ?? 0;

  const progressSegments = [
    { key: "compliant",          pct: typeTotal ? ((typeSummary?.compliant ?? 0) / typeTotal) * 100 : 0,          color: "bg-green-500" },
    { key: "due_soon",           pct: typeTotal ? ((typeSummary?.due_soon ?? 0) / typeTotal) * 100 : 0,           color: "bg-amber-400" },
    { key: "follow_on_required", pct: typeTotal ? ((typeSummary?.follow_on_required ?? 0) / typeTotal) * 100 : 0, color: "bg-orange-400" },
    { key: "overdue",            pct: typeTotal ? ((typeSummary?.overdue ?? 0) / typeTotal) * 100 : 0,            color: "bg-red-500" },
    { key: "failed",             pct: typeTotal ? ((typeSummary?.failed ?? 0) / typeTotal) * 100 : 0,             color: "bg-red-700" },
    { key: "awaiting_evidence",  pct: typeTotal ? ((typeSummary?.awaiting_evidence ?? 0) / typeTotal) * 100 : 0,  color: "bg-slate-400" },
    { key: "not_applicable",     pct: typeTotal ? ((typeSummary?.not_applicable ?? 0) / typeTotal) * 100 : 0,     color: "bg-slate-200 dark:bg-slate-700" },
  ];

  const displayName = typeSummary?.typeName ?? "Compliance Type";
  const displayCode = typeSummary?.typeCode ?? "";
  const displayColor = typeSummary?.typeColor ?? null;

  function handleImported() {
    loadSummary();
    queryClient.invalidateQueries({ queryKey: getListAllComplianceItemsQueryKey(params) });
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Import dialog */}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        typeId={typeId!}
        typeName={displayName}
        onImported={handleImported}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" asChild className="mt-0.5 shrink-0">
            <Link href="/compliance"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2.5">
              {displayColor && (
                <span className="inline-block h-3.5 w-3.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: displayColor }} />
              )}
              {!displayColor && <ShieldCheck className="h-5 w-5 text-muted-foreground shrink-0" />}
              {summaryLoading ? (
                <Skeleton className="h-8 w-52" />
              ) : (
                <h1 className="text-3xl font-bold tracking-tight text-foreground">{displayName}</h1>
              )}
              {displayCode && !summaryLoading && (
                <Badge variant="outline" className="font-mono text-xs">{displayCode}</Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 ml-[22px]">
              Compliance dashboard — {summaryLoading ? "…" : `${typeTotal} assets assigned`}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="shrink-0 mt-1"
          onClick={() => setImportOpen(true)}
        >
          <Upload className="h-4 w-4 mr-2" />
          Import Data
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(({ key, label, color, bg, icon: Icon }) => {
          const count = summaryLoading ? null : ((typeSummary as any)?.[key] ?? 0);
          const isActive = status === key;
          return (
            <button
              key={key}
              onClick={() => { setStatus(s => s === key ? "" : key); setPage(1); }}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${isActive ? "ring-2 ring-primary" : ""} ${bg}`}
            >
              <div className={`text-2xl font-bold ${color}`}>
                {count === null ? "—" : count}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                {Icon && <Icon className={`h-3 w-3 ${color}`} />}
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Status breakdown bar */}
      {!summaryLoading && typeTotal > 0 && (
        <div className="space-y-1.5">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted gap-px">
            {progressSegments.map(seg =>
              seg.pct > 0 ? (
                <div
                  key={seg.key}
                  className={`${seg.color} transition-all`}
                  style={{ width: `${seg.pct}%` }}
                  title={`${seg.key}: ${Math.round(seg.pct)}%`}
                />
              ) : null
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {progressSegments.filter(s => s.pct > 0).map(seg => (
              <span key={seg.key} className="flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-sm ${seg.color}`} />
                {STATUS_CONFIG[seg.key]?.label ?? seg.key} {Math.round(seg.pct)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by asset ref or address…"
                className="pl-9"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={status || "__all__"} onValueChange={v => { setStatus(v === "__all__" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(o => (
                  <SelectItem key={o.value || "__all__"} value={o.value || "__all__"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(status || search) && (
              <Button variant="ghost" size="sm" onClick={() => { setStatus(""); setSearch(""); setPage(1); }}>
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <div className="rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset Ref</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Inspection</TableHead>
                <TableHead>Next Due</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Certificate Ref</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length ? (
                items.map((item: any) => {
                  const s = STATUS_CONFIG[item.status] ?? { label: item.status, variant: "outline" as const, color: "" };
                  const Icon = s.icon;
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-xs font-medium">
                        <Link href={`/assets/${item.assetId}`} className="text-primary hover:underline">
                          {item.assetReference ?? item.uprn ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="max-w-[200px] truncate" title={item.fullAddress ?? item.addressLine1 ?? ""}>
                          {item.fullAddress ?? item.addressLine1 ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.variant as any} className="text-xs gap-1">
                          {Icon && <Icon className="h-3 w-3" />}
                          {s.label}
                        </Badge>
                        {item.followOnRequired && (
                          <Badge variant="secondary" className="ml-1 text-xs">Follow-on</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(item.lastInspectionDate)}</TableCell>
                      <TableCell className="text-sm">
                        <span className={
                          item.status === "overdue" ? "text-destructive font-medium" :
                          item.status === "due_soon" ? "text-amber-600 font-medium" :
                          "text-muted-foreground"
                        }>
                          {fmtDate(item.nextDueDate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(item.expiryDate)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{item.certificateRef ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.contractor ?? "—"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/compliance-items/${item.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                    No compliance items found{status ? ` with status "${STATUS_CONFIG[status]?.label ?? status}"` : ""}.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-sm text-muted-foreground">
              {total} items · page {page} of {totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
