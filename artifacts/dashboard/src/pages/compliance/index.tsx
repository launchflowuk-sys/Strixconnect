import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useListAllComplianceItems,
  useListComplianceTypes,
  getListAllComplianceItemsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, AlertTriangle, Clock, CheckCircle2, ChevronLeft, ChevronRight, Layers, FolderOpen } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getToken } from "@/lib/auth";
import { BulkCertificateUploadDialog } from "@/components/bulk-certificate-upload-dialog";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon?: any }> = {
  compliant:           { label: "Compliant",          variant: "default",     icon: CheckCircle2 },
  due_soon:            { label: "Due Soon",            variant: "secondary",   icon: Clock },
  overdue:             { label: "Overdue",             variant: "destructive", icon: AlertTriangle },
  failed:              { label: "Failed",              variant: "destructive", icon: AlertTriangle },
  not_applicable:      { label: "N/A",                 variant: "outline" },
  awaiting_evidence:   { label: "Awaiting Evidence",   variant: "secondary" },
  follow_on_required:  { label: "Follow-on Required",  variant: "secondary",   icon: AlertTriangle },
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

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return d; }
}

type TypeSummary = {
  typeId: string;
  typeName: string;
  typeCode: string;
  typeColor: string | null;
  overdue: number;
  due_soon: number;
  follow_on_required: number;
  failed: number;
  awaiting_evidence: number;
  compliant: number;
  not_applicable: number;
  total: number;
};

export default function CompliancePage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [typeId, setTypeId] = useState("");
  const [page, setPage] = useState(1);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const LIMIT = 50;

  const [typeSummary, setTypeSummary] = useState<TypeSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    const token = getToken();
    fetch("/api/compliance-items/summary-by-type", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => { if (!cancelled) { setTypeSummary(data.types ?? []); setSummaryLoading(false); } })
      .catch(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const params = {
    status: status || undefined,
    complianceTypeId: typeId || undefined,
    page,
    limit: LIMIT,
  };

  const { data: result, isLoading } = useListAllComplianceItems(params, {
    query: { queryKey: getListAllComplianceItemsQueryKey(params) },
  });

  const { data: types } = useListComplianceTypes();

  const items = (result?.data ?? []).filter(item => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      item.assetReference?.toLowerCase().includes(s) ||
      item.fullAddress?.toLowerCase().includes(s) ||
      item.addressLine1?.toLowerCase().includes(s) ||
      item.complianceTypeName?.toLowerCase().includes(s)
    );
  });

  const total = result?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const globalTotals = typeSummary.reduce(
    (acc, t) => {
      acc.overdue += t.overdue;
      acc.due_soon += t.due_soon;
      acc.follow_on_required += t.follow_on_required;
      acc.compliant += t.compliant;
      return acc;
    },
    { overdue: 0, due_soon: 0, follow_on_required: 0, compliant: 0 }
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Compliance</h1>
          <p className="text-muted-foreground mt-1">Cross-asset compliance overview across all properties.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBulkUploadOpen(true)}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Bulk Upload
          </Button>
          <Button asChild>
            <Link href="/compliance/bulk-assign">
              <Layers className="mr-2 h-4 w-4" />
              Bulk Assign
            </Link>
          </Button>
        </div>
      </div>

      <BulkCertificateUploadDialog open={bulkUploadOpen} onOpenChange={setBulkUploadOpen} />

      {/* Global summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: "overdue",            label: "Overdue",    color: "text-destructive",  bg: "bg-destructive/10" },
          { key: "due_soon",           label: "Due Soon",   color: "text-amber-600",    bg: "bg-amber-50 dark:bg-amber-950/20" },
          { key: "follow_on_required", label: "Follow-on",  color: "text-orange-600",   bg: "bg-orange-50 dark:bg-orange-950/20" },
          { key: "compliant",          label: "Compliant",  color: "text-green-600",    bg: "bg-green-50 dark:bg-green-950/20" },
        ].map(({ key, label, color, bg }) => (
          <button
            key={key}
            onClick={() => { setStatus(s => s === key ? "" : key); setPage(1); }}
            className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${status === key ? "ring-2 ring-primary" : ""} ${bg}`}
          >
            <div className={`text-2xl font-bold ${color}`}>
              {summaryLoading ? "—" : (globalTotals as any)[key] ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </button>
        ))}
      </div>

      {/* Per-type breakdown */}
      <Card>
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-foreground">By Compliance Type</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Click a row to filter the table below to that type.</p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Type</TableHead>
                <TableHead className="text-destructive text-right w-24">Overdue</TableHead>
                <TableHead className="text-amber-600 text-right w-24">Due Soon</TableHead>
                <TableHead className="text-orange-600 text-right w-24">Follow-on</TableHead>
                <TableHead className="text-green-600 text-right w-24">Compliant</TableHead>
                <TableHead className="text-muted-foreground text-right w-24">N/A</TableHead>
                <TableHead className="text-muted-foreground text-right w-24">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaryLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : typeSummary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-16 text-center text-muted-foreground text-sm">
                    No compliance data yet. Import assets and assign compliance types to get started.
                  </TableCell>
                </TableRow>
              ) : (
                typeSummary.map(t => {
                  const isSelected = typeId === t.typeId;
                  const hasIssues = t.overdue > 0 || t.due_soon > 0 || t.follow_on_required > 0;
                  return (
                    <TableRow
                      key={t.typeId}
                      className="cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => navigate(`/compliance/${t.typeId}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {t.typeColor && (
                            <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.typeColor }} />
                          )}
                          <span className="text-sm font-medium">{t.typeName}</span>
                          {hasIssues && (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {t.overdue > 0 ? (
                          <span className="font-semibold text-destructive">{t.overdue}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.due_soon > 0 ? (
                          <span className="font-semibold text-amber-600">{t.due_soon}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.follow_on_required > 0 ? (
                          <span className="font-semibold text-orange-600">{t.follow_on_required}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.compliant > 0 ? (
                          <span className="font-semibold text-green-600">{t.compliant}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {t.not_applicable > 0 ? t.not_applicable : <span className="text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">{t.total}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by asset ref, address, type…"
                className="pl-9"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={status || "__all__"} onValueChange={v => { setStatus(v === "__all__" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(o => (
                  <SelectItem key={o.value || "__all__"} value={o.value || "__all__"}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeId || "__all__"} onValueChange={v => { setTypeId(v === "__all__" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                {(types as any[])?.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(status || typeId || search) && (
              <Button variant="ghost" size="sm" onClick={() => { setStatus(""); setTypeId(""); setSearch(""); setPage(1); }}>
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
                <TableHead>Compliance Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Inspection</TableHead>
                <TableHead>Next Due</TableHead>
                <TableHead>Certificate</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length ? (
                items.map((item: any) => {
                  const s = STATUS_CONFIG[item.status] ?? { label: item.status, variant: "outline" as const };
                  const Icon = s.icon;
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-xs font-medium">
                        <Link href={`/assets/${item.assetId}`} className="text-primary hover:underline">
                          {item.assetReference}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="max-w-[180px] truncate" title={item.fullAddress ?? item.addressLine1 ?? ""}>
                          {item.fullAddress ?? item.addressLine1 ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {item.complianceTypeColor && (
                            <span
                              className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: item.complianceTypeColor }}
                            />
                          )}
                          <span className="text-sm">{item.complianceTypeName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.variant} className="text-xs gap-1">
                          {Icon && <Icon className="h-3 w-3" />}
                          {s.label}
                        </Badge>
                        {item.followOnRequired && (
                          <Badge variant="secondary" className="ml-1 text-xs">Follow-on</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(item.lastInspectionDate)}</TableCell>
                      <TableCell className="text-sm">
                        <span className={item.status === "overdue" ? "text-destructive font-medium" : item.status === "due_soon" ? "text-amber-600 font-medium" : "text-muted-foreground"}>
                          {fmtDate(item.nextDueDate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {item.certificateRef ?? "—"}
                      </TableCell>
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
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    No compliance items found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
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
