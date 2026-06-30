import { useState, useEffect, useCallback, useRef } from "react";
import { useGetMe, useListComplianceTypes } from "@workspace/api-client-react";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FileDown, Loader2, FileSpreadsheet, Columns3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const BASE_REPORT_COLUMNS: Record<string, string[]> = {
  compliance: [
    "Asset Reference","UPRN","Full Address","Asset Type","Area",
    "Compliance Type","Code","Status","Last Inspection","Next Due Date",
    "Expiry Date","Certificate Ref","Contractor","Follow-on Required","Notes",
  ],
  overdue: [
    "Asset Reference","UPRN","Full Address","Asset Type","Area",
    "Compliance Type","Code","Last Inspection","Due Date","Days Overdue",
    "Certificate Ref","Contractor",
  ],
  "follow-on": [
    "Asset Reference","UPRN","Full Address","Asset Type","Area",
    "Compliance Type","Code","Status","Next Due","Contractor","Linked Jobs","Notes",
  ],
  custom: [
    "Service Date","Asset Reference","UPRN","Full Address","Asset Type","Area",
    "Compliance Type","Code","Outcome","Engineer","Certificate Ref","Expiry Date","Notes",
  ],
};

async function downloadReport(path: string, filename: string, token: string | null) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type ReportType = "compliance" | "overdue" | "follow-on" | "custom";

export default function ReportsPage() {
  const { toast } = useToast();
  const token = getToken();
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: complianceTypes } = useListComplianceTypes();

  const [reportType, setReportType] = useState<ReportType>("compliance");
  const [statusFilter, setStatusFilter] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("");
  const [complianceTypeFilter, setComplianceTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);

  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [customCols, setCustomCols] = useState<string[]>([]);
  const fetchingRef = useRef<string>("");

  const allCols = [...(BASE_REPORT_COLUMNS[reportType] ?? []), ...customCols];

  useEffect(() => {
    setSelectedCols(new Set(BASE_REPORT_COLUMNS[reportType] ?? []));
    setCustomCols([]);
    setComplianceTypeFilter("");
  }, [reportType]);

  useEffect(() => {
    const ctId = complianceTypeFilter && complianceTypeFilter !== "all" ? complianceTypeFilter : "";
    if (!ctId || reportType === "custom") {
      setCustomCols([]);
      setSelectedCols(new Set(BASE_REPORT_COLUMNS[reportType] ?? []));
      return;
    }
    const key = `${reportType}::${ctId}`;
    fetchingRef.current = key;
    const t = getToken();
    fetch(`${API_BASE}/api/reports/columns?complianceTypeId=${encodeURIComponent(ctId)}`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then(r => r.json())
      .then(data => {
        if (fetchingRef.current !== key) return;
        const base = BASE_REPORT_COLUMNS[reportType] ?? [];
        const full: string[] = data[reportType] ?? base;
        const extra = full.filter(c => !base.includes(c));
        setCustomCols(extra);
        setSelectedCols(new Set(full));
      })
      .catch(() => {});
  }, [complianceTypeFilter, reportType]);

  const today = new Date().toISOString().slice(0, 10);
  const canAccess = me?.role === "tenant_admin" || me?.role === "compliance_manager"
    || me?.role === "auditor" || me?.role === "super_admin";

  function toggleCol(col: string) {
    setSelectedCols(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  }

  function selectAll() { setSelectedCols(new Set(allCols)); }
  function clearAll() { setSelectedCols(new Set()); }

  const buildPath = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (assetTypeFilter && assetTypeFilter !== "all") params.set("assetType", assetTypeFilter);
    if (complianceTypeFilter && complianceTypeFilter !== "all") params.set("complianceTypeId", complianceTypeFilter);

    const missing = allCols.filter(c => !selectedCols.has(c));
    if (missing.length > 0) {
      params.set("columns", [...selectedCols].join(","));
    }

    if (reportType === "compliance") {
      return { path: `/api/reports/compliance${params.toString() ? `?${params}` : ""}`, filename: `compliance-report-${today}.csv` };
    }
    if (reportType === "overdue") {
      return { path: `/api/reports/overdue${params.toString() ? `?${params}` : ""}`, filename: `overdue-report-${today}.csv` };
    }
    if (reportType === "follow-on") {
      return { path: `/api/reports/follow-on${params.toString() ? `?${params}` : ""}`, filename: `follow-on-report-${today}.csv` };
    }
    if (reportType === "custom") {
      if (!fromDate || !toDate) return null;
      params.set("from", fromDate);
      params.set("to", toDate);
      return { path: `/api/reports/custom?${params}`, filename: `service-records-${fromDate}-to-${toDate}.csv` };
    }
    return null;
  }, [reportType, statusFilter, assetTypeFilter, complianceTypeFilter, selectedCols, allCols, fromDate, toDate, today]);

  function handleOpenPicker() {
    if (!canAccess) {
      toast({ title: "Access denied", description: "You don't have permission to generate reports.", variant: "destructive" });
      return;
    }
    if (reportType === "custom" && (!fromDate || !toDate)) {
      toast({ title: "Date range required", description: "Please select a from and to date.", variant: "destructive" });
      return;
    }
    setShowColumnPicker(true);
  }

  async function handleDownload() {
    setShowColumnPicker(false);
    const target = buildPath();
    if (!target) return;
    setLoading(true);
    try {
      await downloadReport(target.path, target.filename, token);
      toast({ title: "Report downloaded", description: `${target.filename} saved to your downloads folder.` });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const selectedCount = selectedCols.size;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Reports</h1>
        <p className="text-muted-foreground mt-1">Generate and download compliance reports as CSV.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Generate Report
            </CardTitle>
            <CardDescription>Select a report type and optional filters, then choose columns and download.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">

            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="compliance">Full Compliance Status</SelectItem>
                  <SelectItem value="overdue">Overdue Items</SelectItem>
                  <SelectItem value="follow-on">Follow-on Work Required</SelectItem>
                  <SelectItem value="custom">Service Records by Date Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Compliance type filter — all report types */}
            <div className="space-y-2">
              <Label>Filter by Compliance Type (optional)</Label>
              <Select value={complianceTypeFilter} onValueChange={setComplianceTypeFilter}>
                <SelectTrigger><SelectValue placeholder="All compliance types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All compliance types</SelectItem>
                  {(complianceTypes ?? []).map((ct: any) => (
                    <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status filter — compliance only */}
            {reportType === "compliance" && (
              <div className="space-y-2">
                <Label>Filter by Status (optional)</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="compliant">Compliant</SelectItem>
                    <SelectItem value="due_soon">Due Soon</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="follow_on_required">Follow-on Required</SelectItem>
                    <SelectItem value="not_applicable">Not Applicable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Asset type filter — compliance and overdue */}
            {(reportType === "compliance" || reportType === "overdue" || reportType === "follow-on") && (
              <div className="space-y-2">
                <Label>Filter by Asset Type (optional)</Label>
                <Select value={assetTypeFilter} onValueChange={setAssetTypeFilter}>
                  <SelectTrigger><SelectValue placeholder="All asset types" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="property">Property</SelectItem>
                    <SelectItem value="block">Block</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="communal">Communal</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date range — custom only */}
            {reportType === "custom" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>From Date</Label>
                  <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} max={toDate || today} />
                </div>
                <div className="space-y-2">
                  <Label>To Date</Label>
                  <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} min={fromDate} max={today} />
                </div>
              </div>
            )}

            <Button onClick={handleOpenPicker} disabled={loading || !canAccess} className="mt-2">
              {loading
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Columns3 className="mr-2 h-4 w-4" />}
              Choose Columns &amp; Download
            </Button>

            {!canAccess && (
              <p className="text-sm text-destructive">You do not have permission to generate reports.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Available Reports</CardTitle>
            <CardDescription>Description of each report type.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4 text-sm">
              <li className="flex gap-3">
                <div className="mt-0.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                <div>
                  <p className="font-medium">Full Compliance Status</p>
                  <p className="text-muted-foreground">All enabled compliance items across all assets, with status, due dates, certificate references and contractor details. Filterable by compliance type, status, or asset type.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="mt-0.5 h-2 w-2 rounded-full bg-destructive shrink-0" />
                <div>
                  <p className="font-medium">Overdue Items</p>
                  <p className="text-muted-foreground">Assets with at least one overdue compliance item, showing days overdue. Filterable by compliance type and asset type.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="mt-0.5 h-2 w-2 rounded-full bg-yellow-500 shrink-0" />
                <div>
                  <p className="font-medium">Follow-on Work Required</p>
                  <p className="text-muted-foreground">All compliance items flagged for follow-on work, with any linked jobs. Filterable by compliance type and asset type.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <div className="mt-0.5 h-2 w-2 rounded-full bg-muted-foreground shrink-0" />
                <div>
                  <p className="font-medium">Service Records by Date Range</p>
                  <p className="text-muted-foreground">All service records completed within a chosen date range. Filterable by compliance type.</p>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ── Column picker dialog ── */}
      <Dialog open={showColumnPicker} onOpenChange={setShowColumnPicker}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Columns3 className="h-4 w-4" /> Select Columns
            </DialogTitle>
            <DialogDescription>
              Choose which columns to include in the downloaded CSV.
              {selectedCount < allCols.length && (
                <span className="ml-1 text-amber-600 font-medium">{selectedCount} of {allCols.length} selected.</span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 mb-2">
            <Button variant="outline" size="sm" onClick={selectAll}>Select all</Button>
            <Button variant="outline" size="sm" onClick={clearAll}>Clear all</Button>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {allCols.map(col => (
              <div key={col} className="flex items-center gap-2">
                <Checkbox
                  id={`col-${col}`}
                  checked={selectedCols.has(col)}
                  onCheckedChange={() => toggleCol(col)}
                />
                <label htmlFor={`col-${col}`} className="text-sm cursor-pointer select-none">
                  {col}
                </label>
              </div>
            ))}
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowColumnPicker(false)}>Cancel</Button>
            <Button onClick={handleDownload} disabled={selectedCount === 0 || loading}>
              {loading
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FileDown className="mr-2 h-4 w-4" />}
              Download CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
