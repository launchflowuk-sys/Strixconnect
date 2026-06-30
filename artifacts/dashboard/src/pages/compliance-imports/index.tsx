import { useState, useRef, useEffect } from "react";
import { useListComplianceTypes } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, FileSpreadsheet, ChevronRight, Download, RotateCcw, PlusCircle } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

type Step = "select" | "preview" | "executing" | "done";

const STANDARD_EXTRA_COL_ACTIONS = [
  { value: "skip", label: "Ignore / skip" },
  { value: "notes", label: "Add to Notes" },
  { value: "lastInspectionDate", label: "Last Inspection Date" },
  { value: "nextDueDate", label: "Next Due Date" },
  { value: "certificateRef", label: "Certificate Ref" },
  { value: "condition", label: "Condition" },
  { value: "contractor", label: "Contractor" },
  { value: "followOnRequired", label: "Follow-on Required (YES/NO)" },
  { value: "status", label: "Status" },
];

export default function ComplianceImportsPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("select");
  const [typeId, setTypeId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);
  // mapping: nhHeader → action value ("skip" | "notes" | fieldName | "custom_field")
  const [extraMappings, setExtraMappings] = useState<Record<string, string>>({});
  // custom field labels: nhHeader → user-supplied label text
  const [customFieldLabels, setCustomFieldLabels] = useState<Record<string, string>>({});

  const { data: complianceTypes } = useListComplianceTypes();

  useEffect(() => {
    if (preview?.unmappedColumns?.length) {
      const defaults: Record<string, string> = {};
      const labelDefaults: Record<string, string> = {};
      for (const col of preview.unmappedColumns) {
        defaults[col.nhHeader] = "skip";
        labelDefaults[col.nhHeader] = col.header;
      }
      setExtraMappings(defaults);
      setCustomFieldLabels(labelDefaults);
    }
  }, [preview]);

  async function downloadTemplate() {
    if (!typeId) { toast({ title: "Select a compliance type first", variant: "destructive" }); return; }
    const token = getToken();
    try {
      const res = await fetch(`/api/compliance-imports/template/${typeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const ct = (complianceTypes as any[])?.find((c: any) => c.id === typeId);
      const name = ct ? ct.name.replace(/[^a-z0-9]/gi, "_") : typeId;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `compliance-template-${name}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!typeId) { toast({ title: "Select a compliance type first", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/compliance-imports/preview/${typeId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-filename": encodeURIComponent(file.name),
          Authorization: `Bearer ${token}`,
        },
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      setPreview(data);
      setStep("preview");
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleExecute() {
    if (!preview?.sessionId || !typeId) return;
    setExecuting(true);
    try {
      const token = getToken();
      const activeExtra: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraMappings)) {
        if (v === "skip") continue;
        if (v === "custom_field") {
          const label = (customFieldLabels[k] ?? "").trim();
          if (!label) continue;
          activeExtra[k] = `custom_field:${label}`;
        } else {
          activeExtra[k] = v;
        }
      }
      const res = await fetch(`/api/compliance-imports/execute/${typeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: preview.sessionId, columnMappings: activeExtra }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Execute failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      setStep("done");
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  }

  function reset() {
    setStep("select");
    setPreview(null);
    setResult(null);
    setExtraMappings({});
    setCustomFieldLabels({});
  }

  const selectedType = (complianceTypes as any[])?.find((c: any) => c.id === typeId);
  const matched = preview?.matched ?? 0;
  const errored = preview?.errored ?? 0;
  const total = preview?.totalRows ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Compliance Records</h1>
        <p className="text-muted-foreground mt-1">
          Bulk-update inspection results, certificate references and dates for a compliance type.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {(["select","preview","executing","done"] as Step[]).map((s, i, arr) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
              step === s ? "bg-primary text-primary-foreground" :
              arr.indexOf(step) > i ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}>
              {arr.indexOf(step) > i ? <CheckCircle2 className="h-3 w-3" /> : null}
              {s === "select" ? "1. Select Type" : s === "preview" ? "2. Preview" : s === "executing" ? "3. Importing" : "4. Done"}
            </div>
            {i < arr.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Select type + upload ── */}
      {step === "select" && (
        <Card>
          <CardHeader>
            <CardTitle>Select Compliance Type</CardTitle>
            <CardDescription>
              Choose the compliance type you want to import records for, then download the pre-filled template or upload your own file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2 max-w-sm">
              <Label>Compliance Type</Label>
              <Select value={typeId || "__unset__"} onValueChange={v => setTypeId(v === "__unset__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Choose a compliance type…" /></SelectTrigger>
                <SelectContent>
                  {(complianceTypes as any[])?.map((ct: any) => (
                    <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {typeId && (
              <div className="flex flex-col gap-4">
                <Button variant="outline" onClick={downloadTemplate} className="w-fit">
                  <Download className="mr-2 h-4 w-4" />
                  Download Pre-filled Template ({selectedType?.name})
                </Button>
                <p className="text-xs text-muted-foreground -mt-2">
                  The template is pre-filled with all assets assigned to this compliance type. Fill in the inspection results and re-upload.
                </p>
                <div
                  className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => !uploading && fileRef.current?.click()}
                >
                  <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
                  <p className="font-medium">{uploading ? "Uploading and analysing…" : "Click to upload completed file"}</p>
                  <p className="text-sm text-muted-foreground mt-1">Excel (.xlsx) or CSV</p>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Preview ── */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          {/* Summary banner */}
          <Card>
            <CardContent className="pt-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ["Total rows", total],
                  ["Matched assets", matched],
                  ["Unmatched / skipped", errored],
                  ["Will update", matched],
                ].map(([label, val]) => (
                  <div key={String(label)} className="rounded-md border p-3">
                    <div className="text-muted-foreground text-xs">{label}</div>
                    <div className="font-semibold text-xl mt-0.5">{val}</div>
                  </div>
                ))}
              </div>
              {errored > 0 && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="text-amber-700 dark:text-amber-300">
                    {errored} row{errored !== 1 ? "s" : ""} could not be matched to an asset and will be skipped.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Extra column mapping */}
          {preview.unmappedColumns?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  {preview.unmappedColumns.length} extra column{preview.unmappedColumns.length !== 1 ? "s" : ""} detected
                </CardTitle>
                <CardDescription>
                  These columns were not automatically recognised. Choose what to do with each one.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Column in your file</TableHead>
                        <TableHead>Sample values</TableHead>
                        <TableHead>Map to</TableHead>
                        <TableHead>Custom field name</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.unmappedColumns.map((col: any) => {
                        const currentAction = extraMappings[col.nhHeader] ?? "skip";
                        const isCustomField = currentAction === "custom_field";
                        return (
                          <TableRow key={col.nhHeader}>
                            <TableCell className="font-medium text-sm">{col.header}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                              {col.samples.length ? col.samples.join(", ") : "—"}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={currentAction}
                                onValueChange={v => setExtraMappings(m => ({ ...m, [col.nhHeader]: v }))}
                              >
                                <SelectTrigger className="h-8 text-xs w-[190px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STANDARD_EXTRA_COL_ACTIONS.map(a => (
                                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                                  ))}
                                  <SelectItem value="custom_field">
                                    <span className="flex items-center gap-1.5">
                                      <PlusCircle className="h-3.5 w-3.5 text-primary" />
                                      Add as custom field…
                                    </span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              {isCustomField && (
                                <Input
                                  className="h-8 text-xs w-[180px]"
                                  placeholder="Field name…"
                                  value={customFieldLabels[col.nhHeader] ?? col.header}
                                  onChange={e => setCustomFieldLabels(m => ({ ...m, [col.nhHeader]: e.target.value }))}
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {Object.values(extraMappings).some(v => v === "custom_field") && (
                  <p className="mt-3 text-xs text-muted-foreground flex items-start gap-1.5">
                    <PlusCircle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    Custom fields will be saved permanently on this compliance type and included in all future templates.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Row preview table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Row Preview (first 200)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>UPRN</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Last Inspection</TableHead>
                      <TableHead>Next Due</TableHead>
                      <TableHead>Cert Ref</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-20">Match</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(preview.preview ?? []).map((row: any) => (
                      <TableRow key={row.row} className={row.errors?.length ? "bg-destructive/5" : ""}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.row}</TableCell>
                        <TableCell className="text-sm font-mono">{row.uprn ?? "—"}</TableCell>
                        <TableCell className="text-sm max-w-[180px] truncate">{row.address ?? (row.errors?.[0] ?? "—")}</TableCell>
                        <TableCell className="text-sm">{row.lastInspectionDate ?? "—"}</TableCell>
                        <TableCell className="text-sm">{row.nextDueDate ?? "—"}</TableCell>
                        <TableCell className="text-sm max-w-[120px] truncate">{row.certificateRef ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {row.status ? <Badge variant="outline" className="text-xs capitalize">{row.status}</Badge> : "—"}
                        </TableCell>
                        <TableCell>
                          {row.matched
                            ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                            : <AlertCircle className="h-4 w-4 text-destructive" />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Start over
            </Button>
            <Button onClick={handleExecute} disabled={matched === 0 || executing}>
              {executing ? "Importing…" : `Import ${matched} records`}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Executing ── */}
      {step === "executing" && (
        <Card>
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <Progress value={undefined} className="w-full max-w-xs h-2 animate-pulse" />
            <p className="text-sm text-muted-foreground">Importing compliance records…</p>
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Done ── */}
      {step === "done" && result && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-4">
              <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-300">Import complete</p>
                <p className="text-sm text-green-700 dark:text-green-400">
                  {result.updated} record{result.updated !== 1 ? "s" : ""} updated
                  {result.skipped > 0 ? `, ${result.skipped} skipped` : ""}
                  {result.errors > 0 ? `, ${result.errors} errors` : ""}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Updated", result.updated, "text-green-600"],
                ["Skipped", result.skipped, "text-muted-foreground"],
                ["Errors", result.errors, "text-destructive"],
              ].map(([label, val, cls]) => (
                <div key={String(label)} className="rounded-md border p-3 text-center">
                  <div className="text-muted-foreground text-xs">{label}</div>
                  <div className={`font-bold text-2xl mt-0.5 ${cls}`}>{val}</div>
                </div>
              ))}
            </div>
            <Button onClick={reset} variant="outline">Import another file</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
