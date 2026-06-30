import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useListAssets, useListComplianceTypes } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { Upload, FileText, CheckCircle2, ArrowLeft, ArrowRight, AlertTriangle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { CertificateUploadDialog } from "@/components/certificate-upload-dialog";

type Step = "select" | "upload" | "parse" | "confirm" | "success";

interface Parsed {
  certificateRef?: string;
  engineerName?: string;
  serviceDate?: string;
  expiryDate?: string;
  outcome?: string;
}

export default function ServiceRecordUploadPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("select");
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ filePath: string; parsed: Parsed } | null>(null);
  const [assetId, setAssetId] = useState("");
  const [complianceTypeId, setComplianceTypeId] = useState("");
  const [form, setForm] = useState<Parsed & { notes: string }>({
    certificateRef: "", engineerName: "", serviceDate: "",
    expiryDate: "", outcome: "pass", notes: "",
  });
  const [result, setResult] = useState<any>(null);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);

  const { data: assets } = useListAssets({ limit: 200 });
  const { data: ctypes } = useListComplianceTypes({});

  async function handleFileUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch("/api/service-records/upload", {
        method: "POST",
        headers: {
          "x-filename": file.name,
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${getToken()}`,
        },
        body: buf,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      const data = await res.json();
      setUploadResult(data);
      // Pre-fill form from parsed data
      setForm(f => ({
        ...f,
        ...(data.parsed.certificateRef ? { certificateRef: data.parsed.certificateRef } : {}),
        ...(data.parsed.engineerName ? { engineerName: data.parsed.engineerName } : {}),
        ...(data.parsed.serviceDate ? { serviceDate: data.parsed.serviceDate } : {}),
        ...(data.parsed.expiryDate ? { expiryDate: data.parsed.expiryDate } : {}),
        ...(data.parsed.outcome ? { outcome: data.parsed.outcome } : {}),
      }));
      setStep("parse");
    } catch (e: any) {
      toast({ title: e.message || "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!assetId) { toast({ title: "Select an asset", variant: "destructive" }); return; }
    try {
      const res = await apiClient.post("/service-records", {
        assetId,
        complianceTypeId: complianceTypeId || undefined,
        serviceDate: form.serviceDate || undefined,
        expiryDate: form.expiryDate || undefined,
        engineerName: form.engineerName || undefined,
        certificateRef: form.certificateRef || undefined,
        outcome: form.outcome || undefined,
        notes: form.notes || undefined,
        filePath: uploadResult?.filePath,
      });
      setResult(res.data);
      setStep("success");
      qc.invalidateQueries({ queryKey: ["listServiceRecords"] });
    } catch {
      toast({ title: "Failed to save service record", variant: "destructive" });
    }
  }

  async function handleRaiseJob() {
    try {
      const res = await apiClient.post("/jobs", {
        title: `Follow-on: ${form.certificateRef || file?.name || "Service Record"}`,
        assetId,
        complianceItemId: undefined,
        priority: "high",
      });
      setCreatedJobId(res.data.id);
      qc.invalidateQueries({ queryKey: ["listJobs"] });
      toast({ title: "Follow-on job created" });
    } catch {
      toast({ title: "Failed to create job", variant: "destructive" });
    }
  }

  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    { key: "parse", label: "Review" },
    { key: "confirm", label: "Confirm" },
    { key: "success", label: "Done" },
  ];

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/service-records")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-bold">Upload Service Record</h1>
      </div>

      {/* Step: Select mode */}
      {step === "select" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">How would you like to add a service record?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="text-left border-2 rounded-xl p-5 hover:border-primary hover:bg-primary/5 transition-colors space-y-2 group"
              onClick={() => setAiDialogOpen(true)}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-primary/10 p-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">AI Certificate Reading</p>
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Recommended</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload a PDF or photo of a certificate. The AI reads every field and updates all records automatically.
              </p>
            </button>
            <button
              className="text-left border-2 rounded-xl p-5 hover:border-border hover:bg-muted/30 transition-colors space-y-2"
              onClick={() => setStep("upload")}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-muted p-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="font-semibold text-sm">Manual Entry</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload a file and fill in the details yourself. Useful for non-standard documents.
              </p>
            </button>
          </div>
        </div>
      )}

      <CertificateUploadDialog
        open={aiDialogOpen}
        onOpenChange={open => {
          setAiDialogOpen(open);
          if (!open && step === "select") {
            /* stay on select */
          }
        }}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["listServiceRecords"] });
        }}
      />

      {/* Step indicator — only shown in manual flow */}
      {step !== "select" && (
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2",
              step === s.key ? "border-primary bg-primary text-white" :
                steps.findIndex(x => x.key === step) > i ? "border-primary bg-primary/10 text-primary" :
                  "border-muted text-muted-foreground",
            )}>
              {steps.findIndex(x => x.key === step) > i ? "✓" : i + 1}
            </div>
            <span className={cn("text-sm hidden sm:block", step === s.key ? "font-semibold" : "text-muted-foreground")}>{s.label}</span>
            {i < steps.length - 1 && <div className="h-px flex-1 bg-muted mx-1 min-w-4" />}
          </div>
        ))}
      </div>
      )}

      {/* Step: Upload */}
      {step === "upload" && (
        <div className="space-y-4">
          <div>
            <Label>Asset *</Label>
            <Select value={assetId} onValueChange={setAssetId}>
              <SelectTrigger><SelectValue placeholder="Select an asset" /></SelectTrigger>
              <SelectContent>
                {assets?.data?.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.assetReference ? `${a.assetReference} — ` : ""}{a.fullAddress || a.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Compliance Type</Label>
            <Select value={complianceTypeId || "__none__"} onValueChange={v => setComplianceTypeId(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Select compliance type (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {ctypes?.map((ct: any) => (
                  <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            {file ? (
              <div className="space-y-1">
                <FileText className="h-8 w-8 mx-auto text-primary" />
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground text-sm">Click to select a file</p>
                <p className="text-xs text-muted-foreground">PDF, Excel, CSV, Images, Word</p>
              </div>
            )}
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.csv,.doc,.docx" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button className="w-full" disabled={!file || !assetId || uploading} onClick={handleFileUpload}>
            {uploading ? "Uploading…" : <><Upload className="h-4 w-4 mr-2" /> Upload & Parse</>}
          </Button>
        </div>
      )}

      {/* Step: Parse preview */}
      {step === "parse" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">We detected the following fields. Review and correct before saving.</p>
          {uploadResult?.parsed && Object.values(uploadResult.parsed).some(Boolean) && (
            <div className="bg-muted/40 rounded-lg p-3 text-sm">
              <p className="font-medium mb-2">Auto-detected:</p>
              {Object.entries(uploadResult.parsed).filter(([, v]) => v).map(([k, v]) => (
                <p key={k} className="text-muted-foreground"><span className="capitalize">{k}</span>: <span className="text-foreground">{v as string}</span></p>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Service Date</Label>
              <Input type="date" value={form.serviceDate} onChange={e => setForm(f => ({ ...f, serviceDate: e.target.value }))} />
            </div>
            <div>
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
            </div>
            <div>
              <Label>Certificate Ref</Label>
              <Input value={form.certificateRef} onChange={e => setForm(f => ({ ...f, certificateRef: e.target.value }))} />
            </div>
            <div>
              <Label>Engineer Name</Label>
              <Input value={form.engineerName} onChange={e => setForm(f => ({ ...f, engineerName: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Outcome</Label>
            <Select value={form.outcome} onValueChange={v => setForm(f => ({ ...f, outcome: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pass">Pass</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
                <SelectItem value="follow_on_required">Follow-on Required</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("upload")}>Back</Button>
            <Button className="flex-1" onClick={() => setStep("confirm")}>
              Continue <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Confirm */}
      {step === "confirm" && (
        <div className="space-y-4">
          <div className="border rounded-lg p-4 space-y-2 text-sm">
            <h3 className="font-semibold">Summary</h3>
            <div className="grid grid-cols-2 gap-1 text-muted-foreground">
              <span>Asset</span><span className="text-foreground">{assets?.data?.find((a: any) => a.id === assetId)?.assetReference || assetId.slice(0, 8)}</span>
              {complianceTypeId && <><span>Compliance Type</span><span className="text-foreground">{(ctypes as any)?.find((c: any) => c.id === complianceTypeId)?.name}</span></>}
              {form.serviceDate && <><span>Service Date</span><span className="text-foreground">{form.serviceDate}</span></>}
              {form.expiryDate && <><span>Expiry Date</span><span className="text-foreground">{form.expiryDate}</span></>}
              {form.certificateRef && <><span>Certificate Ref</span><span className="text-foreground">{form.certificateRef}</span></>}
              {form.engineerName && <><span>Engineer</span><span className="text-foreground">{form.engineerName}</span></>}
              {form.outcome && <><span>Outcome</span><span><Badge variant={form.outcome === "pass" ? "default" : "destructive"} className="capitalize">{form.outcome.replace("_", " ")}</Badge></span></>}
            </div>
          </div>
          {complianceTypeId && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              This will update the linked compliance item status and log history.
            </div>
          )}
          {form.outcome === "follow_on_required" && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              Follow-on work is required. You can raise a job after saving.
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("parse")}>Back</Button>
            <Button className="flex-1" onClick={handleConfirm}>Confirm & Save</Button>
          </div>
        </div>
      )}

      {/* Step: Success */}
      {step === "success" && result && (
        <div className="space-y-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
          <h2 className="text-xl font-bold">Service Record Saved</h2>
          {result.complianceUpdate && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
              Compliance status updated to <strong>{result.complianceUpdate.newStatus}</strong>
              {result.complianceUpdate.nextDueDate && ` — next due ${result.complianceUpdate.nextDueDate}`}
            </div>
          )}
          <div className="flex gap-2 justify-center flex-wrap">
            <Button variant="outline" asChild>
              <a href={`/assets/${assetId}`}>View Asset</a>
            </Button>
            {result.followOnRequired && !createdJobId && (
              <Button onClick={handleRaiseJob}>
                <AlertTriangle className="h-4 w-4 mr-2" /> Raise Follow-on Job
              </Button>
            )}
            {createdJobId && (
              <Button asChild>
                <a href={`/jobs/${createdJobId}`}>View Job</a>
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/service-records")}>
              All Records
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
