import { useState, useMemo, useEffect } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useListAssets, getListAssetsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Download, CheckCircle2, X, Trash2, Columns3, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronUp, SlidersHorizontal, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";

const PROPERTY_SUBTYPE_LABELS: Record<string, string> = {
  house: "House", flat: "Flat", maisonette: "Maisonette", bungalow: "Bungalow",
  commercial: "Commercial", garage: "Garage", communal: "Communal", land: "Land",
  hmo: "HMO", traveller_site: "Traveller Site", other: "Other",
};

interface ColDef {
  key: string;
  label: string;
  defaultOn: boolean;
  sortable: boolean;
  width?: string;
}

const COLUMN_DEFS: ColDef[] = [
  { key: "assetReference", label: "Asset Ref / UPRN", defaultOn: true,  sortable: true  },
  { key: "address",        label: "Address",          defaultOn: true,  sortable: true, width: "w-1/3" },
  { key: "assetType",      label: "Type",             defaultOn: true,  sortable: true  },
  { key: "propertySubtype",label: "Sub-Type",          defaultOn: true,  sortable: true  },
  { key: "complianceStatus",label:"Compliance",        defaultOn: true,  sortable: false },
  { key: "status",         label: "Status",           defaultOn: true,  sortable: true  },
  { key: "uprn",           label: "UPRN",             defaultOn: false, sortable: true  },
  { key: "area",           label: "Area",             defaultOn: false, sortable: true  },
  { key: "buildType",      label: "Build Type",       defaultOn: false, sortable: true  },
  { key: "archetype",      label: "Archetype",        defaultOn: false, sortable: true  },
  { key: "heatingType",    label: "Heating Type",     defaultOn: false, sortable: true  },
  { key: "propertyCategory",label:"Property Category",defaultOn: false, sortable: true  },
  { key: "residentType",   label: "Resident Type",    defaultOn: false, sortable: true  },
  { key: "blockReference", label: "Block Reference",  defaultOn: false, sortable: true  },
  { key: "notes",          label: "Notes",            defaultOn: false, sortable: false },
  { key: "createdAt",      label: "Created Date",     defaultOn: false, sortable: true  },
];

const LS_KEY = "assets_col_visibility_v2";

const BULK_EDIT_FIELDS = [
  { key: "area",             label: "Area" },
  { key: "buildType",        label: "Build Type" },
  { key: "heatingType",      label: "Heating Type" },
  { key: "propertyCategory", label: "Property Category" },
  { key: "residentType",     label: "Resident Type" },
  { key: "blockReference",   label: "Block Reference" },
  { key: "archetype",        label: "Archetype" },
  { key: "notes",            label: "Notes" },
] as const;
type BulkEditKey = typeof BULK_EDIT_FIELDS[number]["key"];

function loadVisibility(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const result: Record<string, boolean> = {};
      for (const col of COLUMN_DEFS) {
        result[col.key] = parsed[col.key] !== undefined ? parsed[col.key] : col.defaultOn;
      }
      return result;
    }
  } catch {}
  return Object.fromEntries(COLUMN_DEFS.map(c => [c.key, c.defaultOn]));
}

function getSortValue(asset: any, key: string): string | number {
  switch (key) {
    case "assetReference":  return (asset.assetReference ?? "").toLowerCase();
    case "address":         return (asset.fullAddress ?? asset.addressLine1 ?? "").toLowerCase();
    case "assetType":       return asset.assetType ?? "";
    case "propertySubtype": return asset.propertySubtype ?? "";
    case "status":          return asset.status ?? "";
    case "uprn":            return (asset.uprn ?? "").toLowerCase();
    case "area":            return (asset.area ?? "").toLowerCase();
    case "buildType":       return (asset.buildType ?? "").toLowerCase();
    case "archetype":       return (asset.archetype ?? "").toLowerCase();
    case "heatingType":     return (asset.heatingType ?? "").toLowerCase();
    case "propertyCategory":return (asset.propertyCategory ?? "").toLowerCase();
    case "residentType":    return (asset.residentType ?? "").toLowerCase();
    case "blockReference":  return (asset.blockReference ?? "").toLowerCase();
    case "notes":           return (asset.notes ?? "").toLowerCase();
    case "createdAt":       return asset.createdAt ?? "";
    default:                return "";
  }
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return d; }
}

export default function AssetsPage() {
  const [search, setSearch] = useState("");
  const [assetType, setAssetType] = useState<string | undefined>();
  const [propertySubtype, setPropertySubtype] = useState<string | undefined>();
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);

  const [filterArea, setFilterArea] = useState("");
  const [filterBuildType, setFilterBuildType] = useState("");
  const [filterHeatingType, setFilterHeatingType] = useState("");
  const [filterResidentType, setFilterResidentType] = useState("");
  const [filterCompliance, setFilterCompliance] = useState("all");
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkEditField, setBulkEditField] = useState<BulkEditKey>("area");
  const [bulkEditValue, setBulkEditValue] = useState("");
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(loadVisibility);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState<{ id: string; label: string } | null>(null);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const { toast } = useToast();
  const qc = useQueryClient();
  const searchStr = useSearch();
  const [, navigate] = useLocation();

  const [importBannerCount, setImportBannerCount] = useState<string | null>(() =>
    new URLSearchParams(searchStr).get("imported")
  );
  const [showImportBanner, setShowImportBanner] = useState(() =>
    !!new URLSearchParams(searchStr).get("imported")
  );

  useEffect(() => {
    const count = new URLSearchParams(searchStr).get("imported");
    if (count) {
      setImportBannerCount(count);
      setShowImportBanner(true);
      navigate("/assets", { replace: true });
    }
  }, [searchStr]);

  useEffect(() => {
    setSelected(new Set());
  }, [page, search, assetType, propertySubtype, status, filterArea, filterBuildType, filterHeatingType, filterResidentType]);

  function saveVisibility(next: Record<string, boolean>) {
    setVisibleCols(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  }

  function toggleCol(key: string) {
    saveVisibility({ ...visibleCols, [key]: !visibleCols[key] });
  }

  function handleSort(key: string) {
    if (!COLUMN_DEFS.find(c => c.key === key)?.sortable) return;
    if (sortBy === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortBy(null); setSortDir("asc"); }
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  }

  const params = {
    search: search || undefined,
    assetType,
    propertySubtype,
    status: status === "all" ? undefined : status,
    area: filterArea || undefined,
    buildType: filterBuildType || undefined,
    heatingType: filterHeatingType || undefined,
    residentType: filterResidentType || undefined,
    page,
    limit: 50,
  };
  const { data: assetList, isLoading } = useListAssets(params as any, {
    query: {
      queryKey: getListAssetsQueryKey(params as any),
      placeholderData: (prev: any) => prev,
    }
  });

  const sortedData = useMemo(() => {
    let rows = (assetList?.data ?? []) as any[];
    if (filterCompliance !== "all") {
      rows = rows.filter((a: any) => {
        const cs = a.complianceSummary;
        switch (filterCompliance) {
          case "overdue":     return (cs?.overdue ?? 0) > 0;
          case "failed":      return (cs?.failed ?? 0) > 0;
          case "due_soon":    return (cs?.dueSoon ?? 0) > 0;
          case "compliant":   return (cs?.compliant ?? 0) > 0 && !(cs?.overdue) && !(cs?.failed) && !(cs?.dueSoon);
          case "no_tracking": return !cs?.total || cs.total === 0;
          default:            return true;
        }
      });
    }
    if (!sortBy) return rows;
    return [...rows].sort((a, b) => {
      const av = getSortValue(a, sortBy);
      const bv = getSortValue(b, sortBy);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [assetList?.data, sortBy, sortDir, filterCompliance]);

  const pageIds = sortedData.map((a: any) => a.id as string);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const somePageSelected = pageIds.some(id => selected.has(id));

  function toggleAll() {
    if (allPageSelected) {
      setSelected(prev => { const next = new Set(prev); pageIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelected(prev => { const next = new Set(prev); pageIds.forEach(id => next.add(id)); return next; });
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function handleDelete() {
    if (!confirmDeleteAsset) return;
    setIsDeleting(true);
    try {
      const token = getToken();
      const resp = await fetch(`/api/assets/${confirmDeleteAsset.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Delete failed");
      toast({ title: "Asset deleted", description: `${confirmDeleteAsset.label} has been removed.` });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      setConfirmDeleteAsset(null);
    } catch {
      toast({ title: "Error", description: "Could not delete asset. Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleBulkDelete() {
    setIsDeleting(true);
    const ids = [...selected];
    const token = getToken();
    try {
      const results = await Promise.allSettled(
        ids.map(id =>
          fetch(`/api/assets/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
        )
      );
      const succeeded = results.filter(r => r.status === "fulfilled" && (r as any).value?.ok).length;
      const failed = ids.length - succeeded;
      if (succeeded > 0) {
        toast({
          title: `${succeeded} asset${succeeded !== 1 ? "s" : ""} deleted`,
          description: failed > 0 ? `${failed} could not be deleted.` : undefined,
        });
      } else {
        toast({ title: "Delete failed", description: "None of the assets could be deleted.", variant: "destructive" });
      }
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
    } catch {
      toast({ title: "Error", description: "Something went wrong during bulk delete.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  }

  function handleExport() {
    const rows = sortedData;
    if (!rows.length) { toast({ title: "No assets to export" }); return; }

    const visibleDefs = COLUMN_DEFS.filter(c => visibleCols[c.key] && c.key !== "complianceStatus");
    const extraHeaders = ["Compliant", "Due Soon", "Overdue", "Failed"];
    const headers = [...visibleDefs.map(c => c.label), ...extraHeaders];

    const lines = rows.map((a: any) => {
      const cells = visibleDefs.map(c => {
        let val = "";
        switch (c.key) {
          case "assetReference": val = a.assetReference ?? ""; break;
          case "address":        val = a.fullAddress ?? a.addressLine1 ?? ""; break;
          case "assetType":      val = a.assetType ?? ""; break;
          case "propertySubtype":val = a.propertySubtype ? (PROPERTY_SUBTYPE_LABELS[a.propertySubtype] ?? a.propertySubtype) : ""; break;
          case "status":         val = a.status ?? ""; break;
          case "uprn":           val = a.uprn ?? ""; break;
          case "area":           val = a.area ?? ""; break;
          case "buildType":      val = a.buildType ?? ""; break;
          case "archetype":      val = a.archetype ?? ""; break;
          case "heatingType":    val = a.heatingType ?? ""; break;
          case "propertyCategory":val= a.propertyCategory ?? ""; break;
          case "residentType":   val = a.residentType ?? ""; break;
          case "blockReference": val = a.blockReference ?? ""; break;
          case "notes":          val = a.notes ?? ""; break;
          case "createdAt":      val = a.createdAt ? fmtDate(a.createdAt) : ""; break;
        }
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      const compliance = [
        a.complianceSummary?.compliant ?? 0,
        a.complianceSummary?.dueSoon ?? 0,
        a.complianceSummary?.overdue ?? 0,
        a.complianceSummary?.failed ?? 0,
      ].map(v => `"${v}"`);
      return [...cells, ...compliance].join(",");
    });

    const csv = [headers.map(h => `"${h}"`).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "assets.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const activeFilterCount = [filterArea, filterBuildType, filterHeatingType, filterResidentType].filter(Boolean).length;
  const visibleColDefs = COLUMN_DEFS.filter(c => visibleCols[c.key]);

  function SortIcon({ colKey }: { colKey: string }) {
    if (sortBy !== colKey) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-40 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3.5 w-3.5 ml-1 text-primary inline" />
      : <ArrowDown className="h-3.5 w-3.5 ml-1 text-primary inline" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Assets</h1>
          <p className="text-muted-foreground mt-1">Manage and track your property portfolio.</p>
        </div>
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <Columns3 className="mr-2 h-4 w-4" />
                Columns
                {COLUMN_DEFS.filter(c => !c.defaultOn && visibleCols[c.key]).length > 0 && (
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
                    +{COLUMN_DEFS.filter(c => !c.defaultOn && visibleCols[c.key]).length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="end">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Toggle columns</p>
              <div className="space-y-1.5">
                {COLUMN_DEFS.map(col => (
                  <label key={col.key} className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-muted/50">
                    <Checkbox
                      checked={!!visibleCols[col.key]}
                      onCheckedChange={() => toggleCol(col.key)}
                      id={`col-${col.key}`}
                    />
                    <span className="text-sm select-none">{col.label}</span>
                  </label>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-3 text-xs"
                onClick={() => saveVisibility(Object.fromEntries(COLUMN_DEFS.map(c => [c.key, c.defaultOn])))}
              >
                Reset to defaults
              </Button>
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button asChild>
            <Link href="/assets/new">
              <Plus className="mr-2 h-4 w-4" />
              Add Asset
            </Link>
          </Button>
        </div>
      </div>

      {showImportBanner && importBannerCount && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 px-4 py-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              {importBannerCount} {Number(importBannerCount) === 1 ? "property" : "properties"} imported successfully
            </p>
          </div>
          <button
            onClick={() => setShowImportBanner(false)}
            className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200 flex-shrink-0"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Card>
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by asset ref / UPRN or address…"
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={assetType ?? "all"} onValueChange={(val) => {
                const newType = val === "all" ? undefined : val;
                setAssetType(newType);
                if (newType !== "property") setPropertySubtype(undefined);
                setPage(1);
              }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Asset Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="property">Property</SelectItem>
                  <SelectItem value="block">Block</SelectItem>
                </SelectContent>
              </Select>
              {assetType === "property" && (
                <Select value={propertySubtype ?? "all"} onValueChange={(val) => {
                  setPropertySubtype(val === "all" ? undefined : val);
                  setPage(1);
                }}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Sub-Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sub-Types</SelectItem>
                    <SelectItem value="house">House</SelectItem>
                    <SelectItem value="flat">Flat</SelectItem>
                    <SelectItem value="maisonette">Maisonette</SelectItem>
                    <SelectItem value="bungalow">Bungalow</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="garage">Garage</SelectItem>
                    <SelectItem value="communal">Communal</SelectItem>
                    <SelectItem value="land">Land</SelectItem>
                    <SelectItem value="hmo">HMO</SelectItem>
                    <SelectItem value="traveller_site">Traveller Site</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="sold">Sold</SelectItem>
                  <SelectItem value="demolished">Demolished</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCompliance} onValueChange={v => { setFilterCompliance(v); setPage(1); }}>
                <SelectTrigger className={`w-[155px] ${filterCompliance !== "all" ? "border-primary ring-1 ring-primary/30" : ""}`}>
                  <SelectValue placeholder="Compliance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All compliance</SelectItem>
                  <SelectItem value="failed">Has failed</SelectItem>
                  <SelectItem value="overdue">Has overdue</SelectItem>
                  <SelectItem value="due_soon">Has due soon</SelectItem>
                  <SelectItem value="compliant">Fully compliant</SelectItem>
                  <SelectItem value="no_tracking">No tracking</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant={showMoreFilters || activeFilterCount > 0 ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowMoreFilters(v => !v)}
                className="h-10 gap-1.5"
              >
                <SlidersHorizontal className="h-4 w-4" />
                More filters
                {activeFilterCount > 0 && (
                  <Badge variant="destructive" className="h-4 px-1 text-xs ml-0.5">{activeFilterCount}</Badge>
                )}
                {showMoreFilters ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
              </Button>
            </div>
          </div>

          {showMoreFilters && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">Area</label>
                <Input
                  placeholder="e.g. North"
                  value={filterArea}
                  onChange={e => { setFilterArea(e.target.value); setPage(1); }}
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">Build Type</label>
                <Input
                  placeholder="e.g. Traditional"
                  value={filterBuildType}
                  onChange={e => { setFilterBuildType(e.target.value); setPage(1); }}
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">Heating Type</label>
                <Input
                  placeholder="e.g. Gas central"
                  value={filterHeatingType}
                  onChange={e => { setFilterHeatingType(e.target.value); setPage(1); }}
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-medium">Resident Type</label>
                <Input
                  placeholder="e.g. Leaseholder"
                  value={filterResidentType}
                  onChange={e => { setFilterResidentType(e.target.value); setPage(1); }}
                  className="h-9 text-sm"
                />
              </div>
              {activeFilterCount > 0 && (
                <div className="col-span-2 md:col-span-4 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => {
                      setFilterArea(""); setFilterBuildType(""); setFilterHeatingType(""); setFilterResidentType("");
                      setPage(1);
                    }}
                  >
                    <X className="h-3 w-3 mr-1" /> Clear filters
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        {selected.size > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/40">
            <span className="text-sm font-medium">
              {selected.size} asset{selected.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button>
              <Button
                variant="outline" size="sm"
                onClick={() => { setBulkEditField("area"); setBulkEditValue(""); setShowBulkEdit(true); }}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit fields
              </Button>
              <Button
                variant="destructive" size="sm"
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={isDeleting}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete {selected.size} selected
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-md border-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={allPageSelected}
                    data-state={somePageSelected && !allPageSelected ? "indeterminate" : undefined}
                    onCheckedChange={toggleAll}
                    aria-label="Select all on this page"
                    className={somePageSelected && !allPageSelected ? "opacity-70" : ""}
                  />
                </TableHead>
                {visibleColDefs.map(col => (
                  <TableHead
                    key={col.key}
                    className={`${col.width ?? ""} ${col.sortable ? "cursor-pointer select-none hover:text-foreground" : ""}`}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <span className="inline-flex items-center">
                      {col.label}
                      {col.sortable && <SortIcon colKey={col.key} />}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={visibleColDefs.length + 2} className="h-24 text-center">Loading assets…</TableCell>
                </TableRow>
              ) : sortedData.length > 0 ? (
                sortedData.map((asset: any) => (
                  <TableRow key={asset.id} className={selected.has(asset.id) ? "bg-primary/5" : ""}>
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selected.has(asset.id)}
                        onCheckedChange={() => toggleOne(asset.id)}
                        aria-label={`Select ${asset.assetReference}`}
                      />
                    </TableCell>

                    {visibleCols["assetReference"] && (
                      <TableCell className="font-medium">
                        <Link href={`/assets/${asset.id}`} className="hover:underline text-primary">
                          {asset.assetReference}
                        </Link>
                      </TableCell>
                    )}
                    {visibleCols["address"] && (
                      <TableCell>{asset.fullAddress || asset.addressLine1 || <span className="text-muted-foreground/40">—</span>}</TableCell>
                    )}
                    {visibleCols["assetType"] && (
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {asset.assetType === "property" ? "Property" : "Block"}
                        </Badge>
                      </TableCell>
                    )}
                    {visibleCols["propertySubtype"] && (
                      <TableCell className="text-sm text-muted-foreground">
                        {asset.propertySubtype
                          ? (PROPERTY_SUBTYPE_LABELS[asset.propertySubtype] ?? asset.propertySubtype)
                          : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                    )}
                    {visibleCols["complianceStatus"] && (
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {asset.complianceSummary?.failed > 0 && (
                            <Badge variant="destructive" className="h-5 px-1.5 rounded-sm" title="Failed">{asset.complianceSummary.failed}</Badge>
                          )}
                          {asset.complianceSummary?.overdue > 0 && (
                            <Badge variant="destructive" className="h-5 px-1.5 rounded-sm" title="Overdue">{asset.complianceSummary.overdue}</Badge>
                          )}
                          {asset.complianceSummary?.dueSoon > 0 && (
                            <Badge className="bg-warning text-warning-foreground hover:bg-warning/90 h-5 px-1.5 rounded-sm" title="Due Soon">{asset.complianceSummary.dueSoon}</Badge>
                          )}
                          {asset.complianceSummary?.compliant > 0 && (
                            <Badge className="bg-success text-success-foreground hover:bg-success/90 h-5 px-1.5 rounded-sm" title="Compliant">{asset.complianceSummary.compliant}</Badge>
                          )}
                          {(!asset.complianceSummary?.total || asset.complianceSummary.total === 0) && (
                            <span className="text-xs text-muted-foreground">No tracking</span>
                          )}
                        </div>
                      </TableCell>
                    )}
                    {visibleCols["status"] && (
                      <TableCell>
                        <Badge variant={asset.status === "active" ? "default" : "secondary"} className="capitalize">{asset.status}</Badge>
                      </TableCell>
                    )}
                    {visibleCols["uprn"] && (
                      <TableCell className="text-sm text-muted-foreground">{asset.uprn || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["area"] && (
                      <TableCell className="text-sm text-muted-foreground">{asset.area || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["buildType"] && (
                      <TableCell className="text-sm text-muted-foreground">{asset.buildType || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["archetype"] && (
                      <TableCell className="text-sm text-muted-foreground">{asset.archetype || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["heatingType"] && (
                      <TableCell className="text-sm text-muted-foreground">{asset.heatingType || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["propertyCategory"] && (
                      <TableCell className="text-sm text-muted-foreground">{asset.propertyCategory || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["residentType"] && (
                      <TableCell className="text-sm text-muted-foreground">{asset.residentType || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["blockReference"] && (
                      <TableCell className="text-sm text-muted-foreground">{asset.blockReference || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["notes"] && (
                      <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">{asset.notes || <span className="opacity-40">—</span>}</TableCell>
                    )}
                    {visibleCols["createdAt"] && (
                      <TableCell className="text-sm text-muted-foreground">{fmtDate(asset.createdAt)}</TableCell>
                    )}

                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/assets/${asset.id}`}>View</Link>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/assets/${asset.id}/edit`}>Edit</Link>
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setConfirmDeleteAsset({ id: asset.id, label: asset.assetReference || asset.fullAddress || "this asset" })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={visibleColDefs.length + 2} className="h-24 text-center">No assets found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {assetList && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-muted-foreground">
              {sortBy && (
                <span className="mr-3 text-xs">
                  Sorted by <strong>{COLUMN_DEFS.find(c => c.key === sortBy)?.label}</strong> {sortDir === "asc" ? "↑" : "↓"}
                  <button className="ml-1 underline" onClick={() => setSortBy(null)}>clear</button>
                </span>
              )}
              Showing {((assetList.page - 1) * assetList.limit) + 1}–{Math.min(assetList.page * assetList.limit, assetList.total)} of {assetList.total}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * assetList.limit >= assetList.total}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={showBulkEdit} onOpenChange={open => { if (!open) setShowBulkEdit(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit field across {selected.size} asset{selected.size !== 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Field to update</label>
              <Select value={bulkEditField} onValueChange={v => { setBulkEditField(v as BulkEditKey); setBulkEditValue(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BULK_EDIT_FIELDS.map(f => (
                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">New value</label>
              <Input
                value={bulkEditValue}
                onChange={e => setBulkEditValue(e.target.value)}
                placeholder={`Enter ${BULK_EDIT_FIELDS.find(f => f.key === bulkEditField)?.label.toLowerCase()}…`}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">Leave blank to clear this field on all selected assets.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkEdit(false)} disabled={isBulkSaving}>Cancel</Button>
            <Button
              disabled={isBulkSaving}
              onClick={async () => {
                setIsBulkSaving(true);
                const ids = [...selected];
                const token = getToken();
                const value = bulkEditValue.trim() || null;
                try {
                  const results = await Promise.allSettled(
                    ids.map(id =>
                      fetch(`/api/assets/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ [bulkEditField]: value }),
                      })
                    )
                  );
                  const ok = results.filter(r => r.status === "fulfilled" && (r as any).value?.ok).length;
                  const failed = ids.length - ok;
                  toast({
                    title: `${ok} asset${ok !== 1 ? "s" : ""} updated`,
                    description: failed > 0 ? `${failed} could not be updated.` : undefined,
                  });
                  qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
                  setShowBulkEdit(false);
                  setSelected(new Set());
                } catch {
                  toast({ title: "Error", description: "Bulk update failed.", variant: "destructive" });
                } finally {
                  setIsBulkSaving(false);
                }
              }}
            >
              {isBulkSaving ? "Saving…" : `Apply to ${selected.size} asset${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteAsset} onOpenChange={open => { if (!open) setConfirmDeleteAsset(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete asset?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{confirmDeleteAsset?.label}</strong> and all its compliance records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={open => { if (!open) setShowBulkDeleteConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} assets?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{selected.size} asset{selected.size !== 1 ? "s" : ""}</strong> and all their compliance records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? "Deleting…" : `Delete ${selected.size} assets`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
