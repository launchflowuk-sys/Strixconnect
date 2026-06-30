import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useListComplianceTypes } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, FileText, X, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function friendlyFileType(mimeType: string | null | undefined): string {
  if (!mimeType) return "File";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("image")) return "Image";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv")) return "Spreadsheet";
  if (mimeType.includes("word") || mimeType.includes("document")) return "Word";
  return mimeType.split("/").pop()?.toUpperCase() ?? "File";
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocumentRow {
  id: string;
  assetId: string | null;
  uprn: string | null;
  assetAddress: string | null;
  assetAddressLine1: string | null;
  assetPostCode: string | null;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  uploadedByName: string | null;
  complianceTypeName: string | null;
  complianceTypeCode: string | null;
  createdAt: string;
}

interface DocumentsResponse {
  data: DocumentRow[];
  total: number;
  page: number;
  limit: number;
}

export default function DocumentsPage() {
  const [, navigate] = useLocation();
  const token = getToken();

  const { data: complianceTypesData } = useListComplianceTypes();
  const complianceTypesList = Array.isArray(complianceTypesData) ? complianceTypesData : [];

  const [search, setSearch] = useState("");
  const [complianceTypeId, setComplianceTypeId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const [committedSearch, setCommittedSearch] = useState("");
  const [committedComplianceTypeId, setCommittedComplianceTypeId] = useState("");
  const [committedDateFrom, setCommittedDateFrom] = useState("");
  const [committedDateTo, setCommittedDateTo] = useState("");

  const [result, setResult] = useState<DocumentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async (params: {
    search: string; complianceTypeId: string; dateFrom: string; dateTo: string; page: number;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (params.search) qs.set("search", params.search);
      if (params.complianceTypeId) qs.set("complianceTypeId", params.complianceTypeId);
      if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
      if (params.dateTo) qs.set("dateTo", params.dateTo);
      qs.set("page", String(params.page));
      qs.set("limit", String(LIMIT));

      const res = await fetch(`${API_BASE}/api/documents?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: DocumentsResponse = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDocuments({
      search: committedSearch,
      complianceTypeId: committedComplianceTypeId,
      dateFrom: committedDateFrom,
      dateTo: committedDateTo,
      page,
    });
  }, [committedSearch, committedComplianceTypeId, committedDateFrom, committedDateTo, page]);

  const handleSearch = () => {
    setCommittedSearch(search);
    setCommittedComplianceTypeId(complianceTypeId);
    setCommittedDateFrom(dateFrom);
    setCommittedDateTo(dateTo);
    setPage(1);
  };

  const handleClear = () => {
    setSearch("");
    setComplianceTypeId("");
    setDateFrom("");
    setDateTo("");
    setCommittedSearch("");
    setCommittedComplianceTypeId("");
    setCommittedDateFrom("");
    setCommittedDateTo("");
    setPage(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const goToAsset = (row: DocumentRow) => {
    if (row.assetId) {
      navigate(`/assets/${row.assetId}?tab=documents`);
    }
  };

  const totalPages = result ? Math.ceil(result.total / LIMIT) : 0;
  const hasFilters = search || complianceTypeId || dateFrom || dateTo;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Documents</h1>
        <p className="text-muted-foreground mt-1">Search and filter documents across all properties.</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 sm:col-span-2 lg:col-span-2">
            <Label htmlFor="doc-search">Search (UPRN, address, or filename)</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="doc-search"
                className="pl-9"
                placeholder="e.g. 10033456 or High Street…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                data-testid="doc-search-input"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Certificate / compliance type</Label>
            <Select
              value={complianceTypeId || "__all"}
              onValueChange={v => setComplianceTypeId(v === "__all" ? "" : v)}
            >
              <SelectTrigger data-testid="doc-compliance-type-filter">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All types</SelectItem>
                {complianceTypesList.map((ct: any) => (
                  <SelectItem key={ct.id} value={ct.id}>
                    {ct.code ? `${ct.code} — ${ct.name}` : ct.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Uploaded from</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              max={dateTo || undefined}
              data-testid="doc-date-from"
            />
          </div>

          <div className="space-y-1">
            <Label>Uploaded to</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              data-testid="doc-date-to"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <Button onClick={handleSearch} data-testid="doc-search-btn">
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={handleClear} data-testid="doc-clear-btn">
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
          {result && (
            <span className="ml-auto text-sm text-muted-foreground">
              {result.total === 0
                ? "No documents found"
                : `${result.total.toLocaleString()} document${result.total === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
      </Card>

      <Card>
        <div className="rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File name</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Property (UPRN / Address)</TableHead>
                <TableHead>Certificate type</TableHead>
                <TableHead>Uploaded by</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-destructive">
                    {error}
                  </TableCell>
                </TableRow>
              ) : result && result.data.length > 0 ? (
                result.data.map(row => {
                  const address = row.assetAddress || row.assetAddressLine1 || null;
                  const locationLabel = [row.uprn, address, row.assetPostCode]
                    .filter(Boolean)
                    .join(" · ");

                  return (
                    <TableRow
                      key={row.id}
                      className={row.assetId ? "cursor-pointer hover:bg-muted/50" : undefined}
                      onClick={() => row.assetId && goToAsset(row)}
                      data-testid="doc-row"
                    >
                      <TableCell className="font-medium max-w-[220px] truncate" title={row.fileName}>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{row.fileName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {friendlyFileType(row.fileType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] text-sm">
                        {locationLabel || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.complianceTypeName ? (
                          <span title={row.complianceTypeName}>
                            {row.complianceTypeCode ?? row.complianceTypeName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.uploadedByName ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatBytes(row.fileSize)}
                      </TableCell>
                      <TableCell>
                        {row.assetId && (
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : result ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No documents found. Try adjusting your search or filters.
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    Use the search bar above to find documents.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {result && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                data-testid="doc-prev-page"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                data-testid="doc-next-page"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
