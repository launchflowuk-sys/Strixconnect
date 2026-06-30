import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListServiceRecords } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Plus, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

const OUTCOME_BADGE: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  pass: { label: "Pass", variant: "default" },
  fail: { label: "Fail", variant: "destructive" },
  follow_on_required: { label: "Follow-on Required", variant: "secondary" },
};

export default function ServiceRecordsPage() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListServiceRecords({ page, limit: 25 });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" /> Service Records
          </h1>
          <p className="text-muted-foreground mt-1">Uploaded certificates and inspection reports</p>
        </div>
        <Button onClick={() => navigate("/service-records/upload")}>
          <Plus className="h-4 w-4 mr-2" /> Upload Service Record
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Compliance Type</TableHead>
              <TableHead>Service Date</TableHead>
              <TableHead>Engineer</TableHead>
              <TableHead>Cert Ref</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell>
              </TableRow>
            )}
            {!isLoading && data?.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No service records yet</TableCell>
              </TableRow>
            )}
            {data?.data?.map((sr: any) => {
              const ob = sr.outcome ? OUTCOME_BADGE[sr.outcome] : null;
              return (
                <TableRow key={sr.id}>
                  <TableCell className="text-sm">
                    {sr.asset ? (
                      <Link href={`/assets/${sr.assetId}`} className="hover:underline font-medium">
                        {sr.asset.assetReference || sr.asset.fullAddress || sr.assetId?.slice(0, 8)}
                      </Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {sr.complianceType?.name || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {sr.serviceDate ? format(new Date(sr.serviceDate), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{sr.engineerName || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{sr.certificateRef || "—"}</TableCell>
                  <TableCell>
                    {ob ? <Badge variant={ob.variant}>{ob.label}</Badge> : <span className="text-muted-foreground text-sm">—</span>}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/service-records/${sr.id}`}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {data && data.total > data.limit && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page}</span>
          <Button variant="outline" size="sm" disabled={page * data.limit >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
