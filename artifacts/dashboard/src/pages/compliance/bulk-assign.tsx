import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useListComplianceTypes } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Loader2, CheckCircle2, AlertTriangle, Users } from "lucide-react";
import { getToken } from "@/lib/auth";

const ASSET_TYPE_OPTIONS = [
  { value: "property",       label: "All Properties", group: "Top-level" },
  { value: "block",          label: "Block of Flats", group: "Top-level" },
  { value: "flat",           label: "Property — Flat",           group: "By sub-type" },
  { value: "house",          label: "Property — House",          group: "By sub-type" },
  { value: "maisonette",     label: "Property — Maisonette",     group: "By sub-type" },
  { value: "bungalow",       label: "Property — Bungalow",       group: "By sub-type" },
  { value: "hmo",            label: "Property — HMO",            group: "By sub-type" },
  { value: "commercial",     label: "Property — Commercial",     group: "By sub-type" },
  { value: "garage",         label: "Property — Garage",         group: "By sub-type" },
  { value: "communal",       label: "Property — Communal Area",  group: "By sub-type" },
  { value: "land",           label: "Property — Land",           group: "By sub-type" },
  { value: "traveller_site", label: "Property — Traveller Site", group: "By sub-type" },
  { value: "other",          label: "Property — Other",          group: "By sub-type" },
];

async function apiFetch(path: string, options?: RequestInit) {
  const token = getToken();
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const url = `${base}/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

type Step = "select" | "preview" | "done";

export default function BulkAssignPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: complianceTypes, isLoading: typesLoading } = useListComplianceTypes();

  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<Set<string>>(new Set());
  const [activeOnly, setActiveOnly] = useState(true);

  const [step, setStep] = useState<Step>("select");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const toggleType = useCallback((id: string) => {
    setSelectedTypeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setStep("select");
    setPreviewCount(null);
  }, []);

  const toggleAssetType = useCallback((val: string) => {
    setSelectedAssetTypes(prev => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
    setStep("select");
    setPreviewCount(null);
  }, []);

  const handleSelectAllTypes = useCallback(() => {
    if (!complianceTypes) return;
    const allIds = (complianceTypes as any[]).filter((t: any) => t.isActive).map((t: any) => t.id);
    setSelectedTypeIds(prev => prev.size === allIds.length ? new Set() : new Set(allIds));
    setStep("select");
    setPreviewCount(null);
  }, [complianceTypes]);

  const handleSelectAllAssetTypes = useCallback(() => {
    setSelectedAssetTypes(prev =>
      prev.size === ASSET_TYPE_OPTIONS.length
        ? new Set()
        : new Set(ASSET_TYPE_OPTIONS.map(o => o.value))
    );
    setStep("select");
    setPreviewCount(null);
  }, []);

  const canPreview = selectedTypeIds.size > 0 && selectedAssetTypes.size > 0;

  const handlePreview = async () => {
    setIsPreviewing(true);
    try {
      const params = new URLSearchParams({
        complianceTypeIds: Array.from(selectedTypeIds).join(","),
        assetTypes: Array.from(selectedAssetTypes).join(","),
        activeOnly: String(activeOnly),
      });
      const data = await apiFetch(`/compliance-items/bulk-assign/preview?${params}`);
      setPreviewCount(data.count);
      setStep("preview");
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const data = await apiFetch("/compliance-items/bulk-assign", {
        method: "POST",
        body: JSON.stringify({
          complianceTypeIds: Array.from(selectedTypeIds),
          assetTypes: Array.from(selectedAssetTypes),
          activeOnly,
        }),
      });
      setResult(data);
      setStep("done");
      toast({
        title: "Bulk assign complete",
        description: `${data.created} items created, ${data.skipped} already existed.`,
      });
    } catch (e: any) {
      toast({ title: "Bulk assign failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeTypes = (complianceTypes as any[] | undefined)?.filter((t: any) => t.isActive) ?? [];
  const selectedTypesInfo = activeTypes.filter((t: any) => selectedTypeIds.has(t.id));

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/compliance"><ChevronLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Bulk Assign Compliance</h1>
          <p className="text-muted-foreground mt-1">Apply compliance checks to your existing property portfolio in one operation.</p>
        </div>
      </div>

      {/* Done state */}
      {step === "done" && result && (
        <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <CheckCircle2 className="h-8 w-8 text-green-600 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-green-800 dark:text-green-200">Bulk assign complete</h2>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="font-medium text-green-700 dark:text-green-300">
                    ✓ {result.created} compliance items created
                  </span>
                  {result.skipped > 0 && (
                    <span className="text-muted-foreground">
                      {result.skipped} already existed (skipped)
                    </span>
                  )}
                </div>
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" size="sm" onClick={() => { setStep("select"); setResult(null); setPreviewCount(null); setSelectedTypeIds(new Set()); setSelectedAssetTypes(new Set()); }}>
                    Run another bulk assign
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/compliance">View compliance dashboard</Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step !== "done" && (
        <>
          {/* Step 1: Compliance Types */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Select compliance types</CardTitle>
              <CardDescription>Choose which checks to apply to the selected assets.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {typesLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
              ) : activeTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active compliance types found.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2 pb-1 border-b">
                    <Checkbox
                      id="select-all-types"
                      checked={selectedTypeIds.size === activeTypes.length && activeTypes.length > 0}
                      onCheckedChange={handleSelectAllTypes}
                    />
                    <Label htmlFor="select-all-types" className="text-sm font-medium cursor-pointer">
                      Select all ({activeTypes.length})
                    </Label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activeTypes.map((type: any) => (
                      <div key={type.id} className="flex items-center gap-2.5 rounded-md border px-3 py-2 hover:bg-muted/40 transition-colors">
                        <Checkbox
                          id={`type-${type.id}`}
                          checked={selectedTypeIds.has(type.id)}
                          onCheckedChange={() => toggleType(type.id)}
                        />
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: type.color ?? "#ccc" }} />
                        <Label htmlFor={`type-${type.id}`} className="cursor-pointer flex-1 text-sm">
                          {type.name}
                        </Label>
                        <Badge variant="outline" className="font-mono text-xs">{type.code}</Badge>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Step 2: Asset Types */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Select property types to target</CardTitle>
              <CardDescription>Only assets of these types will receive the compliance checks.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2 pb-1 border-b">
                <Checkbox
                  id="select-all-asset-types"
                  checked={selectedAssetTypes.size === ASSET_TYPE_OPTIONS.length}
                  onCheckedChange={handleSelectAllAssetTypes}
                />
                <Label htmlFor="select-all-asset-types" className="text-sm font-medium cursor-pointer">
                  Select all property types
                </Label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ASSET_TYPE_OPTIONS.map(opt => (
                  <div key={opt.value} className="flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-muted/40 transition-colors">
                    <Checkbox
                      id={`at-${opt.value}`}
                      checked={selectedAssetTypes.has(opt.value)}
                      onCheckedChange={() => toggleAssetType(opt.value)}
                    />
                    <Label htmlFor={`at-${opt.value}`} className="cursor-pointer text-sm">{opt.label}</Label>
                  </div>
                ))}
              </div>

              {/* Active only toggle */}
              <div className="flex items-center gap-3 mt-2 pt-3 border-t">
                <Switch
                  id="active-only"
                  checked={activeOnly}
                  onCheckedChange={v => { setActiveOnly(v); setStep("select"); setPreviewCount(null); }}
                />
                <Label htmlFor="active-only" className="cursor-pointer text-sm">
                  Active assets only
                  <span className="ml-1.5 text-muted-foreground font-normal">(exclude archived, sold, demolished)</span>
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Preview / Confirm panel */}
          <Card>
            <CardContent className="pt-5">
              {step === "preview" && previewCount !== null ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                    <Users className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">
                        This will create compliance items for <span className="text-primary font-bold">{previewCount.toLocaleString()} {previewCount === 1 ? "asset" : "assets"}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Applying {selectedTypeIds.size} compliance {selectedTypeIds.size === 1 ? "type" : "types"} to {selectedAssetTypes.size} property {selectedAssetTypes.size === 1 ? "type" : "types"}.
                        Assets that already have the check will be skipped.
                      </p>
                      {selectedTypesInfo.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {selectedTypesInfo.map((t: any) => (
                            <Badge key={t.id} variant="outline" className="font-mono text-xs gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color ?? "#ccc" }} />
                              {t.code}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {previewCount === 0 && (
                    <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      No assets match the selected criteria. Adjust your selection and try again.
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setStep("select"); setPreviewCount(null); }}>
                      Back
                    </Button>
                    <Button
                      onClick={handleConfirm}
                      disabled={isSubmitting || previewCount === 0}
                      className="min-w-[120px]"
                    >
                      {isSubmitting ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</>
                      ) : (
                        "Confirm & Apply"
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handlePreview}
                    disabled={!canPreview || isPreviewing}
                    className="min-w-[140px]"
                  >
                    {isPreviewing ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking…</>
                    ) : (
                      "Preview affected assets"
                    )}
                  </Button>
                  {!canPreview && (
                    <p className="text-sm text-muted-foreground">
                      Select at least one compliance type and one property type to continue.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
