import { useParams, Link } from "wouter";
import { useState, useEffect } from "react";
import {
  useGetComplianceItemHistory,
  useFetchComplianceRecords,
  useListDocuments,
  useDeleteDocument,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, Clock, User, AlertTriangle, FileText, Download, Trash2, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { CertificateUploadDialog } from "@/components/certificate-upload-dialog";
import { getToken } from "@/lib/auth";
import { format, parseISO } from "date-fns";

type Status = "compliant" | "due_soon" | "overdue" | "failed" | "not_applicable" | "awaiting_evidence" | "follow_on_required";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  compliant: { label: "Compliant", variant: "default" },
  due_soon: { label: "Due Soon", variant: "secondary" },
  overdue: { label: "Overdue", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
  not_applicable: { label: "N/A", variant: "outline" },
  awaiting_evidence: { label: "Awaiting Evidence", variant: "secondary" },
  follow_on_required: { label: "Follow-on Required", variant: "secondary" },
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return d; }
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(parseISO(d), "dd MMM yyyy, HH:mm"); } catch { return d; }
}

function fmtFileSize(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CustomFieldDef { key: string; label: string }
interface ItemMeta {
  assetReference?: string;
  fullAddress?: string;
  complianceType?: { name: string; customFieldDefinitions?: CustomFieldDef[] };
  customFields?: Record<string, string> | null;
}

export default function ComplianceItemDetailPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const qc = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [itemMeta, setItemMeta] = useState<ItemMeta | null>(null);
  const [expandedRecordIds, setExpandedRecordIds] = useState<Set<string>>(new Set());

  function toggleRecord(id: string) {
    setExpandedRecordIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function getRecordCustomFields(r: any): [string, string][] {
    const cf = r.customFields;
    if (!cf || typeof cf !== "object") return [];
    const entries = Object.entries(cf as Record<string, unknown>)
      .filter(([, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]): [string, string] => [k, String(v)]);
    return entries;
  }

  function getFieldLabel(key: string): string {
    const defs = (itemMeta?.complianceType?.customFieldDefinitions ?? []) as { key: string; label: string }[];
    return defs.find(d => d.key === key)?.label ?? key;
  }

  useEffect(() => {
    if (!itemId) return;
    fetch(`/api/compliance-items/${itemId}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setItemMeta({
          assetReference: d.asset?.assetReference,
          fullAddress: d.asset?.fullAddress,
          complianceType: d.complianceType,
          customFields: d.customFields ?? null,
        });
      })
      .catch(() => {});
  }, [itemId]);

  const { data: history, isLoading: isLoadingHistory } = useGetComplianceItemHistory(itemId!, {
    query: { enabled: !!itemId, queryKey: ["getComplianceItemHistory", itemId] as any },
  });

  const { data: recordsResult, isLoading: isLoadingRecords } = useFetchComplianceRecords(
    { itemId: itemId! },
    { query: { enabled: !!itemId, queryKey: ["fetchComplianceRecords", itemId] as any } }
  );
  const records = recordsResult?.data ?? [];
  const latestRecord = records[0];

  const { data: docs, isLoading: isLoadingDocs } = useListDocuments(
    { complianceItemId: itemId },
    { query: { enabled: !!itemId, queryKey: ["listDocuments", "complianceItem", itemId] as any } }
  );
  const docList = (docs as any[]) ?? [];

  const deleteDoc = useDeleteDocument();

  function handleDeleteDoc(docId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;
    deleteDoc.mutate({ docId }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: ["listDocuments", "complianceItem", itemId] }),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/compliance"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Compliance Item</h1>
          {itemMeta && (
            <p className="text-muted-foreground mt-0.5 text-sm truncate">
              {itemMeta.complianceType?.name}
              {(itemMeta.assetReference || itemMeta.fullAddress) && (
                <span className="ml-2 text-muted-foreground/60">
                  · {itemMeta.assetReference || itemMeta.fullAddress}
                </span>
              )}
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Upload Certificate
        </Button>
      </div>

      {/* Current State */}
      {latestRecord && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Current Status
              <Badge variant={STATUS_CONFIG[latestRecord.status]?.variant ?? "outline"}>
                {STATUS_CONFIG[latestRecord.status]?.label ?? latestRecord.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
              {[
                ["Last Inspection", fmtDate(latestRecord.inspectionDate)],
                ["Next Due", fmtDate(latestRecord.nextDueDate)],
                ["Expiry Date", fmtDate(latestRecord.expiryDate)],
                ["Certificate Ref", latestRecord.certificateRef],
                ["Contractor", latestRecord.contractor],
                ["Condition", latestRecord.condition],
                ["Risk Level", (latestRecord as any).riskLevel],
              ].map(([label, val]) => val ? (
                <div key={String(label)}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium capitalize">{String(val)}</dd>
                </div>
              ) : null)}
              {latestRecord.followOnRequired && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500" /> Follow-on Work Required
                  </dt>
                </div>
              )}
              {latestRecord.notes && (
                <div className="col-span-3">
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="mt-0.5">{latestRecord.notes}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Additional (custom) fields */}
      {(() => {
        const defs = itemMeta?.complianceType?.customFieldDefinitions ?? [];
        const fields = itemMeta?.customFields ?? {};
        const visibleDefs = defs.filter(d => fields[d.key] != null && String(fields[d.key]).trim() !== "");
        if (!visibleDefs.length) return null;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Additional Fields</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                {visibleDefs.map(def => (
                  <div key={def.key}>
                    <dt className="text-muted-foreground">{def.label}</dt>
                    <dd className="font-medium">{String(fields[def.key])}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        );
      })()}

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Compliance Records</h2>
        <Button size="sm" asChild>
          <Link href={`/compliance-items/${itemId}/record`}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Log Record
          </Link>
        </Button>
      </div>

      {/* Records Table */}
      <Card>
        <CardContent className="p-0">
          {isLoadingRecords ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : !records.length ? (
            <div className="py-12 text-center text-sm text-muted-foreground border-t">
              No compliance records yet.{" "}
              <Link href={`/compliance-items/${itemId}/record`} className="underline text-primary">Log the first one →</Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Status</TableHead>
                  <TableHead>Inspection Date</TableHead>
                  <TableHead>Next Due</TableHead>
                  <TableHead>Certificate Ref</TableHead>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r: any) => {
                  const cfEntries = getRecordCustomFields(r);
                  const hasCustomFields = cfEntries.length > 0;
                  const isExpanded = expandedRecordIds.has(r.id);
                  return (
                    <>
                      <TableRow
                        key={r.id}
                        className={hasCustomFields ? "cursor-pointer hover:bg-muted/50" : undefined}
                        onClick={hasCustomFields ? () => toggleRecord(r.id) : undefined}
                      >
                        <TableCell className="w-8 pr-0">
                          {hasCustomFields && (
                            isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_CONFIG[r.status]?.variant ?? "outline"} className="text-xs">
                            {STATUS_CONFIG[r.status]?.label ?? r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(r.inspectionDate)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(r.nextDueDate)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.certificateRef ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.contractor ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDateTime(r.createdAt)}</TableCell>
                      </TableRow>
                      {hasCustomFields && isExpanded && (
                        <TableRow key={`${r.id}-cf`} className="bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={6} className="py-3">
                            <div className="flex flex-wrap gap-x-6 gap-y-2">
                              {cfEntries.map(([key, val]) => (
                                <div key={key} className="text-xs">
                                  <span className="text-muted-foreground">{getFieldLabel(key)}: </span>
                                  <span className="font-medium">{val}</span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Attached Documents */}
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <FileText className="h-5 w-5" /> Attached Documents
      </h2>
      <Card>
        <CardContent className="p-0">
          {isLoadingDocs ? (
            <div className="p-4 space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : !docList.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground border-t">
              No documents attached yet.{" "}
              <Link href={`/compliance-items/${itemId}/record`} className="underline text-primary">
                Log a record to attach a certificate →
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docList.map((doc: any) => (
                  <TableRow key={doc.id}>
                    <TableCell className="text-sm font-medium flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      {doc.fileName}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground uppercase">
                      {doc.fileType?.split("/").pop() ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtFileSize(doc.fileSize)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDateTime(doc.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" asChild title="Download">
                          <a href={`/api/documents/${doc.id}/download`} download={doc.fileName}>
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => handleDeleteDoc(doc.id, doc.fileName)}
                          disabled={deleteDoc.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* History Timeline */}
      <h2 className="text-lg font-semibold">Change History</h2>
      <Card>
        <CardContent className="pt-4">
          {isLoadingHistory ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !(history as unknown as any[])?.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground border-2 border-dashed rounded-md">No history yet.</div>
          ) : (
            <ol className="relative border-l border-border space-y-6 ml-3">
              {(history as unknown as any[]).map((entry: any) => (
                <li key={entry.id} className="ml-6">
                  <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-border">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                  </span>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold bg-muted rounded px-1.5 py-0.5 uppercase tracking-wide">{entry.action}</span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(entry.createdAt)}</span>
                  </div>
                  {entry.actorName && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3" /> {entry.actorName}
                    </p>
                  )}
                  {entry.newState && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Status: <span className="font-medium capitalize">{entry.newState?.status}</span>
                      {entry.newState?.nextDueDate && <> · Next due: <span className="font-medium">{fmtDate(entry.newState.nextDueDate)}</span></>}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <CertificateUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        prefilledItemId={itemId}
        prefilledAssetName={itemMeta?.assetReference || itemMeta?.fullAddress}
        prefilledTypeName={itemMeta?.complianceType?.name}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["getComplianceItemHistory", itemId] });
          qc.invalidateQueries({ queryKey: ["fetchComplianceRecords", itemId] });
          qc.invalidateQueries({ queryKey: ["listDocuments", "complianceItem", itemId] });
        }}
      />
    </div>
  );
}
