import { useState, useRef, useEffect } from "react";
import {
  useListImports, useGetImportProgress,
  useListMappingTemplates, useListComplianceTypes,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileSpreadsheet, ChevronRight, CheckCircle2, AlertCircle, RotateCcw, History, Download, BookCopy, ExternalLink, Plus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getToken } from "@/lib/auth";

type Step = "upload" | "map" | "validate" | "importing" | "done";

const ASSET_FIELDS = [
  "assetReference","uprn","oldUprn","fullAddress","addressLine1","addressLine2","addressLine3","addressLine4",
  "area","postCode","assetType","propertySubtype","buildType","archetype","bedrooms",
  "heatingType","propertyCategory","residentType","blockReference","status","notes",
];

const ASSET_FIELD_LABELS: Record<string, string> = {
  assetReference: "Asset Reference / UPRN",
  uprn: "Old UPRN",
  oldUprn: "Old UPRN (legacy)",
  fullAddress: "Full Address",
  addressLine1: "Address Line 1",
  addressLine2: "Address Line 2",
  addressLine3: "Address Line 3",
  addressLine4: "Address Line 4",
  area: "Area",
  postCode: "Postcode",
  assetType: "Asset Type",
  propertySubtype: "Property Subtype",
  buildType: "Build Type",
  archetype: "Archetype",
  bedrooms: "Bedrooms",
  heatingType: "Heating Type",
  propertyCategory: "Property Category",
  residentType: "Resident Type",
  blockReference: "Block Reference",
  status: "Status",
  notes: "Notes",
};

const HEADER_ALIASES: Record<string, string> = {
  assetreference: "assetReference", assetref: "assetReference", assetno: "assetReference",
  assetnumber: "assetReference", reference: "assetReference",
  propertyreference: "assetReference", propertyref: "assetReference",
  propertyno: "assetReference", propertynumber: "assetReference",
  uprn: "assetReference",
  olduprn: "uprn", previousuprn: "uprn", legacyuprn: "oldUprn",
  assettype: "assetType", propertytype: "assetType", type: "assetType",
  dwellingtype: "propertySubtype", propertyclassification: "assetType",
  buildingtype: "buildType",
  fulladdress: "fullAddress", address: "fullAddress", propertyaddress: "fullAddress",
  fullpropertyaddress: "fullAddress",
  addressline1: "addressLine1", address1: "addressLine1", add1: "addressLine1",
  addresslineone: "addressLine1",
  addressline2: "addressLine2", address2: "addressLine2", add2: "addressLine2",
  addresslinetwo: "addressLine2",
  addressline3: "addressLine3", address3: "addressLine3",
  addressline4: "addressLine4", address4: "addressLine4",
  postcode: "postCode", postalcode: "postCode", zip: "postCode", postcodenew: "postCode",
  area: "area", estate: "area", locality: "area",
  bedrooms: "bedrooms", beds: "bedrooms", numberbedrooms: "bedrooms",
  numberofbedrooms: "bedrooms", noofbedrooms: "bedrooms", noofbeds: "bedrooms",
  heatingtype: "heatingType", heating: "heatingType", heatsystem: "heatingType",
  buildtype: "buildType", constructiontype: "buildType", construction: "buildType",
  archetype: "archetype",
  propertysubtype: "propertySubtype", subtype: "propertySubtype",
  propertycategory: "propertyCategory", category: "propertyCategory",
  residenttype: "residentType", tenanttype: "residentType", occupancytype: "residentType",
  blockreference: "blockReference", blockref: "blockReference", block: "blockReference",
  blockno: "blockReference", blocknumber: "blockReference",
  status: "status", propertystatus: "status", assetstatus: "status",
  notes: "notes", note: "notes", comments: "notes", comment: "notes", remarks: "notes",

};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-\/\.]+/g, "");
}

function autoMapHeaders(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedFields = new Set<string>();
  for (const header of headers) {
    const norm = normalizeHeader(header);
    const field = HEADER_ALIASES[norm];
    if (field && !usedFields.has(field)) {
      mapping[header] = field;
      usedFields.add(field);
    }
  }
  return mapping;
}

const MATCH_KEY_OPTIONS = [
  { value: "asset_reference", label: "Asset Reference / UPRN (recommended)" },
  { value: "uprn", label: "Old UPRN" },
  { value: "old_uprn", label: "Old UPRN (legacy)" },
  { value: "full_address", label: "Full Address" },
];

function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  try { return format(parseISO(d), "dd MMM yyyy HH:mm"); } catch { return d; }
}

function ImportStatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    complete: "default", processing: "secondary", pending: "secondary",
    failed: "destructive", rolled_back: "outline",
  };
  return <Badge variant={map[status] ?? "outline"} className="capitalize">{status.replace(/_/g, " ")}</Badge>;
}

function ProgressPoller({ importId, onDone }: { importId: string; onDone: (p: any) => void }) {
  const { data: progress } = useGetImportProgress(importId, {
    query: {
      queryKey: ["getImportProgress", importId] as any,
      refetchInterval: (q) => {
        const status = (q.state.data as any)?.status;
        return status === "processing" || status === "pending" ? 1500 : false;
      },
    },
  });

  useEffect(() => {
    if (progress && (progress.status === "complete" || progress.status === "failed")) {
      onDone(progress);
    }
  }, [progress, onDone]);

  if (!progress) return null;
  const pct = progress.totalRows > 0
    ? Math.round((progress.processedRows / progress.totalRows) * 100) : 0;

  return (
    <div className="space-y-3">
      <Progress value={pct} className="h-3" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {[
          ["Processed", `${progress.processedRows} / ${progress.totalRows}`],
          ["Created", progress.createdCount],
          ["Updated", progress.updatedCount],
          ["Errors", progress.errorCount],
        ].map(([label, val]) => (
          <div key={String(label)} className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">{label}</div>
            <div className="font-semibold text-lg mt-0.5">{val}</div>
          </div>
        ))}
      </div>
      {progress.status === "processing" && (
        <p className="text-sm text-muted-foreground text-center animate-pulse">Importing… please wait.</p>
      )}
    </div>
  );
}

export default function ImportsPage() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [autoMappedHeaders, setAutoMappedHeaders] = useState<Set<string>>(new Set());
  const [matchKey, setMatchKey] = useState("asset_reference");
  const [saveAsName, setSaveAsName] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  const [executing, setExecuting] = useState(false);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [finalProgress, setFinalProgress] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const { data: importHistory, refetch: refetchHistory } = useListImports({ page: 1, limit: 20 });
  const { data: templates } = useListMappingTemplates();
  const { data: complianceTypes } = useListComplianceTypes();

  const [templateCtCode, setTemplateCtCode] = useState<string>("__all__");
  const [addingCustomField, setAddingCustomField] = useState<string | null>(null);

  const baseUrl = "";

  function applyTemplate(tpl: any) {
    const cfg = tpl.mappingConfig as Record<string, string>;
    // cfg is {spreadsheetHeader: assetField}; pre-fill only headers that exist in current upload
    if (uploadResult?.headers) {
      const newMapping: Record<string, string> = {};
      for (const header of uploadResult.headers) {
        if (cfg[header]) newMapping[header] = cfg[header];
      }
      setMapping(newMapping);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const token = getToken();
      const resp = await fetch(`${baseUrl}/api/imports/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-filename": file.name,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      });
      if (!resp.ok) throw new Error(await resp.text());
      const result = await resp.json();
      setUploadResult(result);
      const auto = autoMapHeaders(result.headers ?? []);
      setMapping(auto);
      setAutoMappedHeaders(new Set(Object.keys(auto)));
      setStep("map");
    } catch (err: any) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSaveMapping() {
    const token = getToken();
    const resp = await fetch(`${baseUrl}/api/imports/${uploadResult.importId}/mapping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        mapping,
        matchKey,
        saveAs: saveAsName.trim() || undefined,
      }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      alert(body.error || "Failed to save mapping");
      return;
    }
    if (saveAsName.trim()) {
      qc.invalidateQueries({ queryKey: ["listMappingTemplates"] });
      setSaveAsName("");
    }
    setStep("validate");
    handleValidate();
  }

  async function handleValidate() {
    setValidating(true);
    setValidationResult(null);
    const token = getToken();
    try {
      const resp = await fetch(`${baseUrl}/api/imports/${uploadResult.importId}/validate`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const result = await resp.json();
      setValidationResult(result);
    } finally {
      setValidating(false);
    }
  }

  async function handleExecute() {
    setExecuting(true);
    const token = getToken();
    try {
      const resp = await fetch(`${baseUrl}/api/imports/${uploadResult.importId}/execute`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!resp.ok) { alert("Failed to start import"); return; }
      setActiveImportId(uploadResult.importId);
      setStep("importing");
    } finally {
      setExecuting(false);
    }
  }

  async function downloadTemplate(ctCode?: string) {
    const token = getToken();
    const url = ctCode
      ? `${baseUrl}/api/imports/template/${encodeURIComponent(ctCode)}`
      : `${baseUrl}/api/imports/template`;
    try {
      const resp = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!resp.ok) throw new Error("Failed to download template");
      const blob = await resp.blob();
      const ct = (complianceTypes as any[])?.find((c: any) => c.code === ctCode);
      const fname = ct
        ? `asset-import-${ct.name.replace(/[^a-z0-9]/gi, "_")}.xlsx`
        : "asset-import-template.xlsx";
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = fname;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      alert("Download failed: " + err.message);
    }
  }

  async function addCustomField(columnHeader: string) {
    const fieldName = columnHeader.trim().replace(/[^a-z0-9 _\-]/gi, "").trim();
    if (!fieldName) return;
    setAddingCustomField(columnHeader);
    const token = getToken();
    try {
      const resp = await fetch(`${baseUrl}/api/asset-field-definitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ label: fieldName, fieldType: "text", isRequired: false }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        alert(body.error || "Failed to add custom field");
      } else {
        const created = await resp.json();
        setMapping(m => ({ ...m, [columnHeader]: created.fieldKey ?? fieldName }));
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setAddingCustomField(null);
    }
  }

  async function handleRollback(importId: string) {
    if (!confirm("Roll back this import? Assets created will be archived and updated assets reverted.")) return;
    setRollingBack(importId);
    const token = getToken();
    try {
      await fetch(`${baseUrl}/api/imports/${importId}/rollback`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      refetchHistory();
    } finally {
      setRollingBack(null);
    }
  }

  async function downloadErrors(importId: string) {
    const token = getToken();
    const url = `${baseUrl}/api/imports/${importId}/errors.csv`;
    try {
      const resp = await fetch(url, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!resp.ok) throw new Error("Failed to fetch error report");
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `import-errors-${importId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      alert("Download failed: " + err.message);
    }
  }

  function reset() {
    setStep("upload");
    setUploadResult(null);
    setMapping({});
    setAutoMappedHeaders(new Set());
    setMatchKey("asset_reference");
    setSaveAsName("");
    setValidationResult(null);
    setActiveImportId(null);
    setFinalProgress(null);
  }

  const mappedFieldsCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Import Assets</h1>
          <p className="text-muted-foreground mt-1">Upload Excel or CSV files to bulk-import properties.</p>
        </div>
        <Button variant="outline" onClick={() => { setShowHistory(!showHistory); refetchHistory(); }}>
          <History className="mr-2 h-4 w-4" /> Import History
        </Button>
      </div>

      {/* ── Import History ── */}
      {showHistory && (
        <Card>
          <CardHeader><CardTitle className="text-base">Import History</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!(importHistory as any)?.data?.length ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No imports yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Errors</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((importHistory as any).data as any[]).map((imp: any) => (
                    <TableRow key={imp.id}>
                      <TableCell className="text-sm font-medium max-w-[200px] truncate">{imp.originalName}</TableCell>
                      <TableCell><ImportStatusBadge status={imp.status} /></TableCell>
                      <TableCell className="text-sm">{imp.totalRows ?? "-"}</TableCell>
                      <TableCell className="text-sm">{imp.createdCount}</TableCell>
                      <TableCell className="text-sm">{imp.updatedCount}</TableCell>
                      <TableCell className="text-sm text-destructive">{imp.errorCount > 0 ? imp.errorCount : "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(imp.createdAt)}</TableCell>
                      <TableCell className="flex gap-1">
                        {imp.errorCount > 0 && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground h-7"
                            onClick={() => downloadErrors(imp.id)}>
                            <Download className="h-3.5 w-3.5 mr-1" /> Errors
                          </Button>
                        )}
                        {imp.status === "complete" && (
                          <Button size="sm" variant="ghost" className="text-muted-foreground h-7"
                            disabled={rollingBack === imp.id} onClick={() => handleRollback(imp.id)}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            {rollingBack === imp.id ? "Rolling back…" : "Rollback"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step indicator ── */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {(["upload","map","validate","importing","done"] as Step[]).map((s, i, arr) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
              step === s ? "bg-primary text-primary-foreground" :
              arr.indexOf(step) > i ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              {arr.indexOf(step) > i ? <CheckCircle2 className="h-3 w-3" /> : null}
              {s === "upload" ? "1. Upload" : s === "map" ? "2. Map Columns" : s === "validate" ? "3. Validate" : s === "importing" ? "4. Importing" : "5. Done"}
            </div>
            {i < arr.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Upload ── */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>Upload File</CardTitle>
                <CardDescription>Select an Excel (.xlsx) or CSV file containing your asset data.</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Select value={templateCtCode} onValueChange={setTemplateCtCode}>
                  <SelectTrigger className="h-8 text-xs w-[200px]">
                    <SelectValue placeholder="All compliance types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All compliance types</SelectItem>
                    {(complianceTypes as any[])?.filter((ct: any) => !!ct.code).map((ct: any) => (
                      <SelectItem key={ct.id} value={ct.code}>{ct.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => downloadTemplate(templateCtCode === "__all__" ? undefined : templateCtCode)}>
                  <Download className="mr-2 h-4 w-4" /> Download Template
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => !uploading && fileRef.current?.click()}
            >
              <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="font-medium">{uploading ? "Uploading…" : "Click to select file"}</p>
              <p className="text-sm text-muted-foreground mt-1">Excel (.xlsx) or CSV — any size</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            </div>
            <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-3 flex items-start gap-2 text-sm">
              <ExternalLink className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <span className="text-blue-700 dark:text-blue-300">
                To import <strong>compliance records</strong> (inspection results, certificate dates) for existing assets,
                use the{" "}
                <a href="/compliance-imports" className="underline font-medium">Compliance Records Import</a> wizard.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Map Columns ── */}
      {step === "map" && uploadResult && (
        <Card>
          <CardHeader>
            <CardTitle>Map Columns</CardTitle>
            <CardDescription>
              Match each column in <strong>{uploadResult.filename}</strong> ({uploadResult.totalRows} rows) to an asset field.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Template load + match key row */}
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5 min-w-[200px]">
                <Label>Match existing assets by</Label>
                <Select value={matchKey} onValueChange={setMatchKey}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MATCH_KEY_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(templates as any[])?.length > 0 && (
                <div className="space-y-1.5 min-w-[200px]">
                  <Label>Load saved template</Label>
                  <Select onValueChange={v => {
                    const tpl = (templates as any[]).find((t: any) => t.id === v);
                    if (tpl) applyTemplate(tpl);
                  }}>
                    <SelectTrigger className="w-[220px]">
                      <BookCopy className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                      <SelectValue placeholder="Choose template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(templates as any[]).map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Column mapping table */}
            {(() => {
              const ctHeaders = uploadResult.headers.filter((h: string) => h.startsWith("CT: "));
              const assetHeaders = uploadResult.headers.filter((h: string) => !h.startsWith("CT: "));
              return (
                <>
                  {ctHeaders.length > 0 && (
                    <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                      <p className="font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        {ctHeaders.length} compliance type column{ctHeaders.length !== 1 ? "s" : ""} detected — handled automatically
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Columns starting with <code className="bg-muted px-1 rounded">CT:</code> are read directly during import.
                        YES = assign, NO = skip, blank = auto-assign based on asset sub-type.
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {ctHeaders.map((h: string) => (
                          <Badge key={h} variant="secondary" className="text-xs font-normal">{h.replace(/^CT:\s*/, "")}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Spreadsheet Column</TableHead>
                          <TableHead>Sample Values</TableHead>
                          <TableHead>Maps to Asset Field</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assetHeaders.map((header: string) => {
                          const sampleVals = uploadResult.previewRows
                            .map((r: any) => r.data[header])
                            .filter(Boolean)
                            .slice(0, 2)
                            .join(", ");
                          const isAutoMapped = autoMappedHeaders.has(header) && !!mapping[header];
                          return (
                            <TableRow key={header}>
                              <TableCell className="font-medium text-sm">
                                <div className="flex items-center gap-1.5">
                                  {isAutoMapped && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                                  {header}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">{sampleVals || "-"}</TableCell>
                              <TableCell>
                                <Select
                                  value={mapping[header] || "__ignore__"}
                                  onValueChange={v => setMapping(m => ({ ...m, [header]: v === "__ignore__" ? "" : v }))}
                                >
                                  <SelectTrigger className={`h-8 text-xs w-[180px] ${isAutoMapped ? "border-green-300 bg-green-50 dark:bg-green-950/20" : ""}`}>
                                    <SelectValue placeholder="— ignore —" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__ignore__">— ignore —</SelectItem>
                                    {ASSET_FIELDS.map(f => (
                                      <SelectItem key={f} value={f}>{f} ({ASSET_FIELD_LABELS[f] ?? f})</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              );
            })()}

            {/* Unknown column detection */}
            {(() => {
              const ctHeaders = new Set((uploadResult.headers as string[]).filter((h: string) => h.startsWith("CT: ")));
              const unknownHeaders = (uploadResult.headers as string[]).filter(
                h => !ctHeaders.has(h) && !mapping[h]
              );
              if (unknownHeaders.length === 0) return null;
              return (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm text-amber-800 dark:text-amber-200">
                        {unknownHeaders.length} unrecognised column{unknownHeaders.length !== 1 ? "s" : ""}
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                        These columns aren't mapped to a known asset field. You can add them as custom fields, or leave them unmapped to ignore.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {unknownHeaders.map(h => (
                      <div key={h} className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white dark:bg-amber-950/30 px-2 py-1">
                        <span className="text-xs font-medium text-amber-900 dark:text-amber-200">{h}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-xs text-amber-700 hover:text-amber-900"
                          disabled={addingCustomField === h}
                          onClick={() => addCustomField(h)}
                        >
                          {addingCustomField === h ? "Adding…" : <><Plus className="h-3 w-3 mr-0.5" />Add field</>}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Save as template */}
            <div className="flex items-end gap-3 border-t pt-4">
              <div className="flex-1 space-y-1.5 max-w-xs">
                <Label htmlFor="save-as">Save this mapping as a template (optional)</Label>
                <Input
                  id="save-as"
                  placeholder="e.g. Thurrock Standard Format"
                  value={saveAsName}
                  onChange={e => setSaveAsName(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={reset}>Start over</Button>
                <Button onClick={handleSaveMapping} disabled={mappedFieldsCount === 0}>
                  Validate <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
            {autoMappedHeaders.size > 0 && (
              <p className="text-xs text-green-700 dark:text-green-400">
                ✓ {autoMappedHeaders.size} column{autoMappedHeaders.size !== 1 ? "s were" : " was"} automatically matched — review and adjust if needed.
              </p>
            )}
            {mappedFieldsCount === 0 && (
              <p className="text-xs text-amber-600">Map at least one column to proceed.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Validate ── */}
      {step === "validate" && (
        <Card>
          <CardHeader>
            <CardTitle>Validation</CardTitle>
            <CardDescription>Checking all rows before import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {validating && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                Validating {uploadResult?.totalRows ?? ""} rows…
              </div>
            )}
            {validationResult && (
              <>
                {/* Summary banner */}
                {validationResult.valid ? (
                  <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-4">
                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-300">All {validationResult.totalRows} rows are valid</p>
                      <p className="text-sm text-green-700 dark:text-green-400">Ready to import.</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-amber-800 dark:text-amber-300">
                            {validationResult.totalRows - validationResult.errorCount} of {validationResult.totalRows} rows are valid
                          </p>
                          <Badge variant="destructive">
                            {validationResult.errorCount} row{validationResult.errorCount !== 1 ? "s" : ""} will be skipped
                          </Badge>
                        </div>
                        <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                          You can fix the file and re-upload, or proceed to import only the valid rows — invalid rows will be skipped.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Row-level error table */}
                {!validationResult.valid && validationResult.rowErrors?.length > 0 && (
                  <div className="rounded-md border overflow-hidden">
                    <div className="bg-muted/50 px-4 py-2 flex items-center justify-between">
                      <span className="text-sm font-medium">Row errors</span>
                      <span className="text-xs text-muted-foreground">
                        Showing {Math.min(validationResult.rowErrors.length, 200)} of {validationResult.errorCount} failing rows
                      </span>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-20">Row</TableHead>
                            <TableHead className="w-36">Field</TableHead>
                            <TableHead className="w-36">Value</TableHead>
                            <TableHead>Error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {validationResult.rowErrors.flatMap((re: any) =>
                            re.errors.map((err: any, ei: number) => (
                              <TableRow key={`${re.row}-${ei}`} className="text-sm">
                                <TableCell className="font-mono text-muted-foreground py-2">{re.row}</TableCell>
                                <TableCell className="font-medium py-2">{err.field}</TableCell>
                                <TableCell className="py-2 max-w-[140px] truncate text-muted-foreground font-mono text-xs">
                                  {err.value !== undefined && err.value !== "" ? err.value : "—"}
                                </TableCell>
                                <TableCell className="py-2 text-destructive text-xs">{err.message}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    {validationResult.errorCount > 200 && (
                      <div className="px-4 py-2 bg-muted/30 text-xs text-muted-foreground border-t">
                        … and {validationResult.errorCount - 200} more failing rows not shown. Download the error list for the full report.
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-between flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setStep("map")}>Back to mapping</Button>
                  <div className="flex gap-2 flex-wrap">
                    {!validationResult.valid && (
                      <Button variant="outline" onClick={() => downloadErrors(uploadResult.importId)}>
                        <Download className="mr-2 h-4 w-4" /> Download error list
                      </Button>
                    )}
                    <Button
                      onClick={handleExecute}
                      disabled={executing || validationResult.totalRows - validationResult.errorCount === 0}
                      variant={validationResult.valid ? "default" : "default"}
                    >
                      {executing ? "Starting…" : validationResult.valid
                        ? <>Start Import <Upload className="ml-2 h-4 w-4" /></>
                        : <>Import {validationResult.totalRows - validationResult.errorCount} valid rows <Upload className="ml-2 h-4 w-4" /></>
                      }
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Importing ── */}
      {step === "importing" && activeImportId && (
        <Card>
          <CardHeader>
            <CardTitle>Importing…</CardTitle>
            <CardDescription>Processing your file in the background.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProgressPoller
              importId={activeImportId}
              onDone={(p) => { setFinalProgress(p); setStep("done"); refetchHistory(); }}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Step 5: Done ── */}
      {step === "done" && finalProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {finalProgress.status === "complete"
                ? <><CheckCircle2 className="h-5 w-5 text-green-600" /> Import Complete</>
                : <><AlertCircle className="h-5 w-5 text-red-600" /> Import Finished with Errors</>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["Total Rows", finalProgress.totalRows],
                ["Created", finalProgress.createdCount],
                ["Updated", finalProgress.updatedCount],
                ["Errors", finalProgress.errorCount],
              ].map(([label, val]) => (
                <div key={String(label)} className="rounded-md border p-4 text-center">
                  <div className={`text-2xl font-bold ${label === "Errors" && Number(val) > 0 ? "text-destructive" : ""}`}>{val}</div>
                  <div className="text-xs text-muted-foreground mt-1">{label}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button variant="outline" onClick={reset}>Import another file</Button>
              {finalProgress.errorCount > 0 && (
                <Button variant="outline" onClick={() => downloadErrors(uploadResult.importId)}>
                  <Download className="mr-2 h-4 w-4" /> Download error report
                </Button>
              )}
              <Button variant="outline" onClick={() => { setShowHistory(true); refetchHistory(); }}>View history</Button>
              {finalProgress.status === "complete" && (finalProgress.createdCount + finalProgress.updatedCount) > 0 && (
                <Button onClick={() => {
                  const count = finalProgress.createdCount + finalProgress.updatedCount;
                  qc.invalidateQueries({ queryKey: ["listAssets"] });
                  navigate(`/assets?imported=${count}`);
                }}>
                  View imported assets
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
