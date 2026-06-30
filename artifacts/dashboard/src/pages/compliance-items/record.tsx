import { useState, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useCreateComplianceRecord, useFetchComplianceRecords } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ClipboardCheck, Paperclip, X, FileText, Loader2 } from "lucide-react";

const EMPTY = {
  inspectionDate: new Date().toISOString().split("T")[0],
  expiryDate: "",
  certificateRef: "",
  contractor: "",
  contractorLicence: "",
  condition: "",
  notes: "",
  riskLevel: "",
  followOnRequired: false,
  actionRequired: "",
  workOrderRef: "",
  evidenceNotes: "",
};

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function uploadFile(recordId: string, file: File): Promise<void> {
  const res = await fetch(`/api/compliance-records/${recordId}/documents`, {
    method: "POST",
    headers: { "X-Filename": file.name, "Content-Type": file.type },
    body: file,
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Upload failed (${res.status})`);
  }
}

export default function ComplianceRecordPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createRecord = useCreateComplianceRecord();
  const [form, setForm] = useState({ ...EMPTY });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: recordsResult } = useFetchComplianceRecords(
    { itemId: itemId! },
    { query: { enabled: !!itemId, queryKey: ["fetchComplianceRecords", itemId] as any } }
  );
  const latestRecord = recordsResult?.data?.[0];

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    const errors: string[] = [];
    const valid: File[] = [];
    for (const f of chosen) {
      if (f.size > MAX_FILE_SIZE) { errors.push(`${f.name} exceeds 10 MB`); continue; }
      if (!ALLOWED_TYPES.has(f.type)) { errors.push(`${f.name}: unsupported file type`); continue; }
      valid.push(f);
    }
    if (errors.length) toast({ title: errors.join("; "), variant: "destructive" });
    setPendingFiles(prev => [...prev, ...valid]);
    e.target.value = "";
  }

  function removeFile(idx: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, any> = { ...form };
    Object.keys(payload).forEach(k => {
      if (payload[k] === "" || payload[k] === null) delete payload[k];
    });

    createRecord.mutate(
      { itemId: itemId!, data: payload as any },
      {
        onSuccess: async (result: any) => {
          qc.invalidateQueries({ queryKey: ["fetchComplianceRecords", itemId] });
          qc.invalidateQueries({ queryKey: ["getComplianceItemHistory", itemId] });
          qc.invalidateQueries({ queryKey: ["listAssetComplianceItems"] });

          const recordId: string | undefined = result?.data?.id ?? result?.id;

          if (pendingFiles.length && recordId) {
            setIsUploading(true);
            const failures: string[] = [];
            for (const file of pendingFiles) {
              try {
                await uploadFile(recordId, file);
              } catch (err: any) {
                failures.push(`${file.name}: ${err.message}`);
              }
            }
            setIsUploading(false);
            if (failures.length) {
              toast({ title: `Record saved, but some uploads failed: ${failures.join("; ")}`, variant: "destructive" });
            } else {
              toast({ title: "Compliance record saved with documents" });
            }
          } else {
            toast({ title: "Compliance record saved" });
          }
          navigate(`/compliance-items/${itemId}`);
        },
        onError: (err: any) => toast({ title: err?.message || "Failed to save record", variant: "destructive" }),
      }
    );
  }

  const isBusy = createRecord.isPending || isUploading;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href={`/compliance-items/${itemId}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7" /> Log Compliance Record
          </h1>
          <p className="text-muted-foreground mt-1">
            Record an inspection or certificate update. The compliance status will be recalculated automatically.
          </p>
        </div>
      </div>

      {latestRecord && (
        <Card className="bg-muted/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Previous Record</CardTitle>
          </CardHeader>
          <CardContent className="text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Inspection", latestRecord.inspectionDate ? new Date(latestRecord.inspectionDate).toLocaleDateString("en-GB") : "—"],
              ["Expiry", latestRecord.expiryDate ? new Date(latestRecord.expiryDate).toLocaleDateString("en-GB") : "—"],
              ["Certificate", latestRecord.certificateRef || "—"],
              ["Contractor", latestRecord.contractor || "—"],
            ].map(([label, val]) => (
              <div key={String(label)}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-medium">{val}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Inspection */}
        <Card>
          <CardHeader>
            <CardTitle>Inspection Details</CardTitle>
            <CardDescription>Core dates and certificate information for this visit.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Inspection Date</Label>
              <Input type="date" value={form.inspectionDate} onChange={set("inspectionDate")} />
            </div>
            <div className="space-y-1.5">
              <Label>Expiry / Certificate Date</Label>
              <Input type="date" value={form.expiryDate} onChange={set("expiryDate")} />
              <p className="text-xs text-muted-foreground">If blank, auto-calculated from inspection date + frequency.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Certificate Reference</Label>
              <Input
                placeholder="e.g. CP12-2024-001234"
                value={form.certificateRef}
                onChange={set("certificateRef")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Condition Found</Label>
              <Select value={form.condition} onValueChange={v => setForm(f => ({ ...f, condition: v }))}>
                <SelectTrigger><SelectValue placeholder="Select condition…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good — no issues</SelectItem>
                  <SelectItem value="fair">Fair — minor issues noted</SelectItem>
                  <SelectItem value="poor">Poor — remedial work needed</SelectItem>
                  <SelectItem value="failed">Failed — unsafe / non-compliant</SelectItem>
                  <SelectItem value="not_applicable">Not Applicable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Risk Level</Label>
              <Select value={form.riskLevel} onValueChange={v => setForm(f => ({ ...f, riskLevel: v }))}>
                <SelectTrigger><SelectValue placeholder="Select risk level…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Contractor */}
        <Card>
          <CardHeader>
            <CardTitle>Contractor</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Contractor / Engineer Name</Label>
              <Input placeholder="e.g. Thames Gas Services Ltd" value={form.contractor} onChange={set("contractor")} />
            </div>
            <div className="space-y-1.5">
              <Label>Licence / Registration Number</Label>
              <Input placeholder="e.g. Gas Safe 123456" value={form.contractorLicence} onChange={set("contractorLicence")} />
            </div>
            <div className="space-y-1.5">
              <Label>Work Order Reference</Label>
              <Input placeholder="Internal or contractor WO ref" value={form.workOrderRef} onChange={set("workOrderRef")} />
            </div>
          </CardContent>
        </Card>

        {/* Follow-on / Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Notes &amp; Follow-on Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Inspection Notes</Label>
              <Textarea
                placeholder="Describe findings, recommendations, access notes, etc."
                rows={4}
                value={form.notes}
                onChange={set("notes")}
              />
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="follow-on"
                className="rounded h-4 w-4"
                checked={form.followOnRequired}
                onChange={e => setForm(f => ({ ...f, followOnRequired: e.target.checked }))}
              />
              <Label htmlFor="follow-on" className="cursor-pointer">Follow-on work required</Label>
            </div>
            {form.followOnRequired && (
              <div className="space-y-1.5">
                <Label>Action Required</Label>
                <Textarea
                  placeholder="Describe what follow-on work needs to be done…"
                  rows={3}
                  value={form.actionRequired}
                  onChange={set("actionRequired")}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Evidence / Document Notes</Label>
              <Textarea
                placeholder="Reference to uploaded evidence, document storage location, etc."
                rows={2}
                value={form.evidenceNotes}
                onChange={set("evidenceNotes")}
              />
            </div>
          </CardContent>
        </Card>

        {/* Document Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" /> Attach Certificates / Documents
            </CardTitle>
            <CardDescription>
              Attach the certificate or evidence for this inspection (PDF or image, up to 10 MB each).
              Files are saved when you submit the form.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.xlsx,.xls,.csv,.doc,.docx"
              className="hidden"
              onChange={handleFilePick}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
            >
              <Paperclip className="mr-2 h-4 w-4" /> Choose files…
            </Button>
            {pendingFiles.length > 0 && (
              <ul className="space-y-2 mt-2">
                {pendingFiles.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm rounded-md border px-3 py-2">
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-muted-foreground hover:text-destructive flex-shrink-0"
                      aria-label="Remove file"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pb-8">
          <Button type="submit" disabled={isBusy}>
            {isUploading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
            ) : createRecord.isPending ? (
              "Saving…"
            ) : (
              "Save Compliance Record"
            )}
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/compliance-items/${itemId}`}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
