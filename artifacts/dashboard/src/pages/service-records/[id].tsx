import { useParams, Link } from "wouter";
import { useGetServiceRecord } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, ClipboardList, Download, FileText } from "lucide-react";
import { format } from "date-fns";

const OUTCOME_BADGE: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  pass: { label: "Pass", variant: "default" },
  fail: { label: "Fail", variant: "destructive" },
  follow_on_required: { label: "Follow-on Required", variant: "secondary" },
};

export default function ServiceRecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: sr, isLoading } = useGetServiceRecord(id!);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!sr) return <div className="p-6">Service record not found.</div>;

  const ob = sr.outcome ? OUTCOME_BADGE[sr.outcome] : null;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/service-records"><ArrowLeft className="h-4 w-4 mr-1" /> Service Records</Link>
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Service Record
          </h1>
          {ob && <Badge variant={ob.variant} className="mt-1">{ob.label}</Badge>}
        </div>
        {sr.asset && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/assets/${sr.assetId}`}>View Asset →</Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Asset</p>
          <p className="font-medium">
            {sr.asset ? (sr.asset as any).assetReference || (sr.asset as any).fullAddress || "Asset" : "—"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Compliance Type</p>
          <p className="font-medium">{(sr.complianceType as any)?.name || "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Service Date</p>
          <p className="font-medium">{sr.serviceDate ? format(new Date(sr.serviceDate), "dd MMM yyyy") : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Expiry Date</p>
          <p className="font-medium">{sr.expiryDate ? format(new Date(sr.expiryDate), "dd MMM yyyy") : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Certificate Ref</p>
          <p className="font-medium">{sr.certificateRef || "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Engineer</p>
          <p className="font-medium">{sr.engineerName || "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Uploaded</p>
          <p className="font-medium">{format(new Date(sr.createdAt), "dd MMM yyyy")}</p>
        </div>
      </div>

      {sr.notes && (
        <div className="bg-muted/40 rounded-lg p-4 text-sm">
          <p className="font-medium mb-1">Notes</p>
          <p className="text-muted-foreground whitespace-pre-wrap">{sr.notes}</p>
        </div>
      )}

      <Separator />

      <div>
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" /> Documents
        </h2>
        {(sr as any).documents?.length === 0 && (
          <p className="text-sm text-muted-foreground">No documents attached.</p>
        )}
        <div className="space-y-2">
          {((sr as any).documents || []).map((doc: any) => (
            <div key={doc.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
              <span className="font-medium truncate max-w-xs">{doc.fileName}</span>
              <Button variant="ghost" size="sm" asChild>
                <a href={`/api/documents/${doc.id}/download?inline=true`} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />
                </a>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
