import { useState, useRef, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAsset,
  getGetAssetQueryKey,
  useListAssets,
  useListAssetComplianceItems,
  getListAssetComplianceItemsQueryKey,
  useGetAssetHistory,
  useListComplianceTypes,
  useBulkCreateComplianceItems,
  useDeleteComplianceItem,
  useUpdateAsset,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { Building2, ArrowLeft, Plus, Info, Home, AlertTriangle, CheckCircle2, Clock, ShieldCheck, Trash2, Pencil, SquarePen, Download, FileText, FolderOpen, Upload, Paperclip, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";

type ComplianceStatus = "compliant" | "due_soon" | "overdue" | "failed" | "not_applicable" | "awaiting_evidence" | "follow_on_required";

// Must stay in sync with PROPERTY_SUBTYPES in lib/db/src/schema/assets.ts
const PROPERTY_SUBTYPES = [
  "house", "flat", "maisonette", "bungalow", "commercial",
  "garage", "communal", "land", "hmo", "traveller_site", "other",
] as const;

const SUBTYPE_LABELS: Record<string, string> = {
  house: "House", flat: "Flat", maisonette: "Maisonette", bungalow: "Bungalow",
  commercial: "Commercial", garage: "Garage", communal: "Communal Area",
  land: "Land", hmo: "HMO", traveller_site: "Traveller Site", other: "Other",
};

const STATUS_CONFIG: Record<ComplianceStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  compliant: { label: "Compliant", variant: "default", icon: CheckCircle2 },
  due_soon: { label: "Due Soon", variant: "secondary", icon: Clock },
  overdue: { label: "Overdue", variant: "destructive", icon: AlertTriangle },
  failed: { label: "Failed", variant: "destructive", icon: AlertTriangle },
  not_applicable: { label: "N/A", variant: "outline", icon: null },
  awaiting_evidence: { label: "Awaiting Evidence", variant: "secondary", icon: Clock },
  follow_on_required: { label: "Follow-on Required", variant: "secondary", icon: AlertTriangle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as ComplianceStatus] ?? { label: status, variant: "outline" as const, icon: null };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return d; }
}

function fileIcon(fileType: string) {
  if (fileType === "application/pdf") return "PDF";
  if (fileType.startsWith("image/")) return "IMG";
  if (fileType.includes("word") || fileType === "application/msword") return "DOC";
  if (fileType.includes("spreadsheet") || fileType.includes("excel")) return "XLS";
  if (fileType === "text/csv") return "CSV";
  return "FILE";
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const initialTab = new URLSearchParams(window.location.search).get("tab") ?? "overview";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [addTypeIds, setAddTypeIds] = useState<Set<string>>(new Set());
  const [showManage, setShowManage] = useState(false);

  // Documents state
  const docFileRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);

  useEffect(() => {
    if (initialTab === "documents") {
      loadDocuments();
    }
  }, []);

  async function loadDocuments() {
    if (!id) return;
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/documents?assetId=${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    finally { setDocsLoading(false); }
  }

  async function handleDocUpload(file: File) {
    if (!id || !file) return;
    setDocUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`/api/assets/${id}/documents`, {
        method: "POST",
        headers: {
          "x-filename": encodeURIComponent(file.name),
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${getToken()}`,
        },
        body: buf,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }
      await loadDocuments();
      toast({ title: `${file.name} uploaded` });
    } catch (err: any) {
      toast({ title: err.message || "Upload failed", variant: "destructive" });
    } finally {
      setDocUploading(false);
    }
  }

  async function handleDownload(docId: string, fileName: string) {
    try {
      const res = await fetch(`/api/documents/${docId}/signed-url`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Could not get download URL");
      const { url } = await res.json();
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("download", fileName);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  const { data: asset, isLoading: isLoadingAsset } = useGetAsset(id!, {
    query: { enabled: !!id, queryKey: getGetAssetQueryKey(id!) }
  });

  const { data: complianceItems, isLoading: isLoadingCompliance } = useListAssetComplianceItems(
    id!,
    { query: { enabled: !!id, queryKey: getListAssetComplianceItemsQueryKey(id!) } }
  );

  const childParams = { parentId: id!, limit: 200 };
  const { data: childList, isLoading: isLoadingChildren } = useListAssets(childParams, {
    query: { enabled: !!id && asset?.assetType === "block", queryKey: ["listAssets", childParams] as any }
  });

  const { data: assetHistory, isLoading: isLoadingHistory } = useGetAssetHistory(id!, {
    query: { enabled: !!id, queryKey: ["getAssetHistory", id] as any },
  });

  const { data: allComplianceTypes } = useListComplianceTypes();
  const bulkAddCompliance = useBulkCreateComplianceItems();
  const deleteCompliance = useDeleteComplianceItem();
  const updateAsset = useUpdateAsset();

  const [, navigate] = useLocation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<{
    assetType: string; propertySubtype: string; status: string;
    bedrooms: string; heatingType: string; buildType: string; archetype: string;
    area: string; notes: string; propertyCategory: string; residentType: string; blockReference: string;
  }>({ assetType: "", propertySubtype: "", status: "", bedrooms: "", heatingType: "", buildType: "", archetype: "", area: "", notes: "", propertyCategory: "", residentType: "", blockReference: "" });

  const [fieldDefs, setFieldDefs] = useState<any[]>([]);
  const [customAttrs, setCustomAttrs] = useState<Record<string, string>>({});
  const [showManageFields, setShowManageFields] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [savingField, setSavingField] = useState(false);

  useEffect(() => {
    async function fetchFieldDefs() {
      try {
        const res = await fetch("/api/asset-field-definitions", {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) setFieldDefs(await res.json());
      } catch {}
    }
    fetchFieldDefs();
  }, []);

  useEffect(() => {
    if (asset && (asset as any).customAttributes) {
      setCustomAttrs((asset as any).customAttributes as Record<string, string>);
    }
  }, [asset]);

  function openEdit() {
    setEditForm({
      assetType: (asset as any)?.assetType ?? "property",
      propertySubtype: (asset as any)?.propertySubtype ?? "",
      status: (asset as any)?.status ?? "active",
      bedrooms: String((asset as any)?.bedrooms ?? ""),
      heatingType: (asset as any)?.heatingType ?? "",
      buildType: (asset as any)?.buildType ?? "",
      archetype: (asset as any)?.archetype ?? "",
      area: (asset as any)?.area ?? "",
      notes: (asset as any)?.notes ?? "",
      propertyCategory: (asset as any)?.propertyCategory ?? "",
      residentType: (asset as any)?.residentType ?? "",
      blockReference: (asset as any)?.blockReference ?? "",
    });
    setCustomAttrs((asset as any)?.customAttributes ?? {});
    setShowEdit(true);
  }

  async function handleDeleteAsset() {
    if (!id) return;
    setIsDeleting(true);
    try {
      const token = getToken();
      const resp = await fetch(`/api/assets/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Delete failed");
      toast({ title: "Asset deleted", description: "The asset has been removed." });
      navigate("/assets");
    } catch {
      toast({ title: "Error", description: "Could not delete asset. Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    try {
      const payload: Record<string, any> = {
        assetType: editForm.assetType,
        status: editForm.status,
        bedrooms: editForm.bedrooms ? Number(editForm.bedrooms) : undefined,
        heatingType: editForm.heatingType || undefined,
        buildType: editForm.buildType || undefined,
        archetype: editForm.archetype || undefined,
        area: editForm.area || undefined,
        notes: editForm.notes || undefined,
        propertyCategory: editForm.propertyCategory || undefined,
        residentType: editForm.residentType || undefined,
        blockReference: editForm.blockReference || undefined,
        customAttributes: Object.keys(customAttrs).length > 0 ? customAttrs : null,
      };
      if (editForm.assetType === "property") {
        payload.propertySubtype = editForm.propertySubtype || undefined;
      } else {
        payload.propertySubtype = null;
      }
      await updateAsset.mutateAsync({ assetId: id, data: payload });
      await queryClient.invalidateQueries({ queryKey: getGetAssetQueryKey(id) });
      setShowEdit(false);
      toast({ title: "Asset details updated" });
    } catch (err: any) {
      toast({ title: err?.message || "Failed to save changes", variant: "destructive" });
    }
  }

  const docsByComplianceItemId = documents.reduce<Record<string, any[]>>((acc, doc) => {
    if (doc.complianceItemId) {
      if (!acc[doc.complianceItemId]) acc[doc.complianceItemId] = [];
      acc[doc.complianceItemId].push(doc);
    }
    return acc;
  }, {});

  const existingTypeIds = new Set(
    (complianceItems as any[] | undefined)?.map((i: any) => i.complianceTypeId) ?? []
  );
  const activeTypes = (allComplianceTypes as any[] | undefined)?.filter((ct: any) => ct.isActive) ?? [];
  const availableToAdd = activeTypes.filter((ct: any) => !existingTypeIds.has(ct.id));

  function toggleAddType(ctId: string, checked: boolean) {
    setAddTypeIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(ctId); else next.delete(ctId);
      return next;
    });
  }

  async function handleAddCompliance() {
    if (!id || addTypeIds.size === 0) return;
    try {
      await bulkAddCompliance.mutateAsync({
        assetId: id,
        data: { complianceTypeIds: Array.from(addTypeIds) },
      });
      await queryClient.invalidateQueries({ queryKey: getListAssetComplianceItemsQueryKey(id) });
      setAddTypeIds(new Set());
      setShowManage(false);
      toast({ title: `${addTypeIds.size} compliance ${addTypeIds.size === 1 ? "item" : "items"} added` });
    } catch (err: any) {
      toast({ title: err?.message || "Failed to add compliance items", variant: "destructive" });
    }
  }

  async function handleRemoveCompliance(itemId: string, typeName?: string) {
    if (!id || !itemId) return;
    try {
      await deleteCompliance.mutateAsync({ assetId: id, itemId });
      await queryClient.invalidateQueries({ queryKey: getListAssetComplianceItemsQueryKey(id) });
      toast({ title: `${typeName || "Compliance item"} removed` });
    } catch (err: any) {
      toast({ title: err?.message || "Failed to remove compliance item", variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4 flex-1">
        <Button variant="outline" size="icon" asChild>
          <Link href="/assets"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {isLoadingAsset ? <Skeleton className="h-8 w-48" /> : (asset?.assetReference || "Asset Detail")}
            {!isLoadingAsset && asset && (
              <Badge variant={asset.status === "active" ? "default" : "secondary"} className="capitalize ml-2">
                {asset.status}
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isLoadingAsset ? <Skeleton className="h-4 w-64" /> : (asset?.fullAddress || asset?.addressLine1 || "No address")}
          </p>
        </div>
        {!isLoadingAsset && asset && (
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/assets/${id}/edit`}>
                <SquarePen className="h-4 w-4 mr-2" /> Edit Asset
              </Link>
            </Button>
            <Button
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </Button>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={v => { setActiveTab(v); if (v === "documents" || v === "compliance") loadDocuments(); }}>
        <TabsList className={`grid w-full ${asset?.assetType === "block" ? "grid-cols-5" : "grid-cols-4"} lg:w-auto lg:inline-flex`}>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="compliance">
            Compliance
            {complianceItems && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {(complianceItems as any[]).filter((i: any) => i.status === "overdue" || i.status === "due_soon").length > 0
                  ? (complianceItems as any[]).filter((i: any) => i.status === "overdue" || i.status === "due_soon").length
                  : (complianceItems as any[]).length}
              </Badge>
            )}
          </TabsTrigger>
          {asset?.assetType === "block" && (
            <TabsTrigger value="children">
              Units
              {childList?.total !== undefined && (
                <Badge variant="secondary" className="ml-2 text-xs">{childList.total}</Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="documents">
            Documents
            {documents.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{documents.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW ── */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Info className="h-4 w-4 text-muted-foreground" /> Property Attributes
                  </CardTitle>
                  {!isLoadingAsset && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setShowManageFields(true)}>
                        <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Add field
                      </Button>
                      {!showEdit && (
                        <Button variant="ghost" size="sm" onClick={openEdit}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingAsset ? (
                  <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-4 w-full" />)}</div>
                ) : showEdit ? (
                  <form onSubmit={handleSaveEdit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-assetType">Asset Type *</Label>
                        <Select value={editForm.assetType} onValueChange={v => setEditForm(f => ({ ...f, assetType: v, propertySubtype: v === "block" ? "" : f.propertySubtype }))}>
                          <SelectTrigger id="edit-assetType"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="property">Property</SelectItem>
                            <SelectItem value="block">Block of Flats</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {editForm.assetType === "property" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-subtype">Property Sub-Type *</Label>
                          <Select value={editForm.propertySubtype} onValueChange={v => setEditForm(f => ({ ...f, propertySubtype: v }))}>
                            <SelectTrigger id="edit-subtype"><SelectValue placeholder="Select sub-type" /></SelectTrigger>
                            <SelectContent>
                              {PROPERTY_SUBTYPES.map(s => (
                                <SelectItem key={s} value={s}>{SUBTYPE_LABELS[s] ?? s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-status">Status</Label>
                        <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                          <SelectTrigger id="edit-status"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                            <SelectItem value="archived">Archived</SelectItem>
                            <SelectItem value="sold">Sold</SelectItem>
                            <SelectItem value="demolished">Demolished</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-bedrooms">Bedrooms</Label>
                        <Input id="edit-bedrooms" type="number" min={0} max={20} value={editForm.bedrooms} onChange={e => setEditForm(f => ({ ...f, bedrooms: e.target.value }))} placeholder="e.g. 2" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-heating">Heating Type</Label>
                        <Input id="edit-heating" value={editForm.heatingType} onChange={e => setEditForm(f => ({ ...f, heatingType: e.target.value }))} placeholder="e.g. gas central" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-build">Build Type</Label>
                        <Input id="edit-build" value={editForm.buildType} onChange={e => setEditForm(f => ({ ...f, buildType: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-archetype">Archetype</Label>
                        <Input id="edit-archetype" value={editForm.archetype} onChange={e => setEditForm(f => ({ ...f, archetype: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-area">Area</Label>
                        <Input id="edit-area" value={editForm.area} onChange={e => setEditForm(f => ({ ...f, area: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-propcategory">Property Category</Label>
                        <Input id="edit-propcategory" value={editForm.propertyCategory} onChange={e => setEditForm(f => ({ ...f, propertyCategory: e.target.value }))} placeholder="e.g. Residential" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-residenttype">Resident Type</Label>
                        <Input id="edit-residenttype" value={editForm.residentType} onChange={e => setEditForm(f => ({ ...f, residentType: e.target.value }))} placeholder="e.g. Leaseholder" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-blockref">Block Reference</Label>
                        <Input id="edit-blockref" value={editForm.blockReference} onChange={e => setEditForm(f => ({ ...f, blockReference: e.target.value }))} placeholder="e.g. BLK-001" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-notes">Notes</Label>
                      <Input id="edit-notes" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
                    </div>
                    {fieldDefs.length > 0 && (
                      <div className="space-y-3 pt-2 border-t">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Additional Fields</p>
                          <button type="button" className="text-xs text-primary underline underline-offset-2" onClick={() => setShowManageFields(true)}>Manage fields</button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {fieldDefs.map(def => (
                            <div key={def.id} className="space-y-1.5">
                              <Label htmlFor={`custom-${def.id}`}>{def.label}</Label>
                              {def.fieldType === "boolean" ? (
                                <Select
                                  value={customAttrs[def.id] ?? ""}
                                  onValueChange={v => setCustomAttrs(prev => ({ ...prev, [def.id]: v }))}
                                >
                                  <SelectTrigger id={`custom-${def.id}`}><SelectValue placeholder="Select…" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="">—</SelectItem>
                                    <SelectItem value="yes">Yes</SelectItem>
                                    <SelectItem value="no">No</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  id={`custom-${def.id}`}
                                  type={def.fieldType === "number" ? "number" : def.fieldType === "date" ? "date" : "text"}
                                  value={customAttrs[def.id] ?? ""}
                                  onChange={e => setCustomAttrs(prev => ({ ...prev, [def.id]: e.target.value }))}
                                  placeholder={def.fieldType === "date" ? "YYYY-MM-DD" : `Enter ${def.label.toLowerCase()}…`}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button type="submit" size="sm" disabled={updateAsset.isPending}>
                        {updateAsset.isPending ? "Saving…" : "Save Changes"}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowEdit(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    {[
                      ["Asset Reference / UPRN", asset?.assetReference],
                      ["Asset Type", (asset as any)?.assetType === "property" ? "Property" : (asset as any)?.assetType === "block" ? "Block" : (asset as any)?.assetType],
                      ["Property Sub-Type", (asset as any)?.propertySubtype ? (SUBTYPE_LABELS[(asset as any).propertySubtype] ?? (asset as any).propertySubtype) : undefined],
                      ["Old UPRN", (asset as any)?.uprn],
                      ["Bedrooms", (asset as any)?.bedrooms],
                      ["Heating", (asset as any)?.heatingType],
                      ["Build Type", (asset as any)?.buildType],
                      ["Archetype", (asset as any)?.archetype],
                      ["Area", (asset as any)?.area],
                      ["Property Category", (asset as any)?.propertyCategory],
                      ["Resident Type", (asset as any)?.residentType],
                      ["Block Ref", (asset as any)?.blockReference],
                    ].map(([label, val]) => val ? (
                      <div key={String(label)}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium capitalize">{String(val)}</dd>
                      </div>
                    ) : null)}
                    {fieldDefs.length > 0 && (
                      <>
                        <div className="col-span-2 border-t mt-1 mb-0" />
                        {fieldDefs.map(def => {
                          const val = (asset as any)?.customAttributes?.[def.id];
                          return (
                            <div key={def.id}>
                              <dt className="text-muted-foreground">{def.label}</dt>
                              <dd className="font-medium">
                                {val !== undefined && val !== null && val !== ""
                                  ? String(val)
                                  : <span className="text-muted-foreground/40 font-normal">—</span>}
                              </dd>
                            </div>
                          );
                        })}
                      </>
                    )}
                    {fieldDefs.length === 0 && (
                      <div className="col-span-2 pt-1">
                        <button
                          className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 transition-colors"
                          onClick={() => setShowManageFields(true)}
                        >
                          + Add a custom field (e.g. EPC rating, construction date)
                        </button>
                      </div>
                    )}
                  </dl>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-muted-foreground" /> Address
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingAsset ? (
                  <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-4 w-full" />)}</div>
                ) : (
                  <div className="text-sm space-y-0.5 font-medium">
                    {asset?.addressLine1 && <div>{asset.addressLine1}</div>}
                    {asset?.addressLine2 && <div>{asset.addressLine2}</div>}
                    {asset?.addressLine3 && <div>{asset.addressLine3}</div>}
                    {asset?.addressLine4 && <div>{asset.addressLine4}</div>}
                    {asset?.postCode && <div className="mt-1 text-muted-foreground">{asset.postCode}</div>}
                    {!asset?.addressLine1 && !asset?.postCode && (
                      <div className="text-muted-foreground italic">No address details</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {asset?.notes && (
            <Card className="mt-4">
              <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
              <CardContent><p className="text-sm">{asset.notes}</p></CardContent>
            </Card>
          )}

        </TabsContent>

        {/* ── COMPLIANCE ── */}
        <TabsContent value="compliance" className="mt-6 space-y-4">

          {/* Manage / Add compliance types */}
          {!isLoadingCompliance && activeTypes.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    Compliance Types
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowManage(v => !v); setAddTypeIds(new Set()); }}
                  >
                    {showManage ? "Cancel" : availableToAdd.length > 0 ? `Manage (${availableToAdd.length} to add)` : "Manage"}
                  </Button>
                </div>
                {showManage && (
                  <CardDescription className="mt-1">
                    Tick to add new types. Untick existing (ticked) types to remove them from this asset.
                  </CardDescription>
                )}
              </CardHeader>
              {showManage && (
                <CardContent className="pt-0">
                  <div className="space-y-2 mb-4">
                    {activeTypes.map((ct: any) => {
                      const isExisting = existingTypeIds.has(ct.id);
                      return (
                        <div
                          key={ct.id}
                          className={`flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors ${isExisting ? "bg-muted/30 hover:bg-muted/50" : "hover:bg-muted/40"}`}
                        >
                          <Checkbox
                            id={`add-ct-${ct.id}`}
                            checked={isExisting || addTypeIds.has(ct.id)}
                            onCheckedChange={(v) => {
                              if (isExisting) {
                                if (!v) {
                                  const item = (complianceItems as any[])?.find((i: any) => i.complianceTypeId === ct.id);
                                  if (item && window.confirm(`Remove "${ct.name}" from this asset?\n\nThis will permanently delete this compliance requirement and all associated inspection records. This cannot be undone.`)) {
                                    handleRemoveCompliance(item.id, ct.name);
                                  }
                                }
                              } else {
                                toggleAddType(ct.id, !!v);
                              }
                            }}
                          />
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {ct.color && (
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: ct.color }}
                              />
                            )}
                            <label
                              htmlFor={`add-ct-${ct.id}`}
                              className={`text-sm font-medium ${isExisting ? "text-muted-foreground" : "cursor-pointer"}`}
                            >
                              {ct.name}
                            </label>
                            {ct.frequencyMonths && (
                              <span className="text-xs text-muted-foreground">
                                {ct.frequencyMonths === 12 ? "Annual" : ct.frequencyMonths === 6 ? "6-monthly" : ct.frequencyMonths === 24 ? "Biennial" : `Every ${ct.frequencyMonths} months`}
                              </span>
                            )}
                            {isExisting && (
                              <Badge variant="secondary" className="text-xs ml-auto">Configured</Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    onClick={handleAddCompliance}
                    disabled={addTypeIds.size === 0 || bulkAddCompliance.isPending}
                    size="sm"
                  >
                    {bulkAddCompliance.isPending
                      ? "Adding…"
                      : addTypeIds.size > 0
                        ? `Add ${addTypeIds.size} ${addTypeIds.size === 1 ? "Type" : "Types"}`
                        : "Select types above"}
                  </Button>
                </CardContent>
              )}
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Compliance Requirements</CardTitle>
              <CardDescription>All enabled compliance items for this asset</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingCompliance ? (
                <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : !(complianceItems as any[])?.length ? (
                <div className="text-sm text-muted-foreground py-12 text-center border-t">
                  No compliance items configured for this asset.
                  {availableToAdd.length > 0 && (
                    <div className="mt-3">
                      <Button variant="outline" size="sm" onClick={() => setShowManage(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add Compliance Types
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Inspection</TableHead>
                      <TableHead>Next Due</TableHead>
                      <TableHead>Certificate Ref</TableHead>
                      <TableHead>Docs</TableHead>
                      <TableHead className="w-36"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(complianceItems as any[]).filter((i: any) => i.isEnabled).map((item: any) => {
                      const itemDocs: any[] = docsByComplianceItemId[item.id] ?? [];
                      return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {item.complianceTypeColor && (
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: item.complianceTypeColor }}
                              />
                            )}
                            <span className="font-medium text-sm">{item.complianceTypeName}</span>
                          </div>
                        </TableCell>
                        <TableCell><StatusBadge status={item.status} /></TableCell>
                        <TableCell className="text-sm">{fmtDate(item.lastInspectionDate)}</TableCell>
                        <TableCell className="text-sm">
                          <span className={item.status === "overdue" ? "text-destructive font-medium" : item.status === "due_soon" ? "text-amber-600 font-medium" : ""}>
                            {fmtDate(item.nextDueDate)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.certificateRef || "-"}</TableCell>
                        <TableCell>
                          {itemDocs.length === 0 ? (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          ) : (
                            <div className="flex items-center gap-1 flex-wrap">
                              {itemDocs.slice(0, 3).map((doc: any) => (
                                <button
                                  key={doc.id}
                                  title={doc.fileName}
                                  onClick={() => handleDownload(doc.id, doc.fileName)}
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 hover:bg-primary/10 rounded px-1.5 py-0.5 border border-primary/20 transition-colors"
                                >
                                  <Paperclip className="h-3 w-3 flex-shrink-0" />
                                  <span className="max-w-[80px] truncate">{doc.fileName}</span>
                                </button>
                              ))}
                              {itemDocs.length > 3 && (
                                <span className="text-xs text-muted-foreground">+{itemDocs.length - 3} more</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/compliance-items/${item.id}/record`}>
                                <Plus className="h-3.5 w-3.5 mr-1" /> Log Record
                              </Link>
                            </Button>
                            <Button size="sm" variant="ghost" asChild>
                              <Link href={`/compliance-items/${item.id}`}>View</Link>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={deleteCompliance.isPending}
                              onClick={() => {
                                if (window.confirm(`Remove "${item.complianceTypeName}" from this asset?\n\nThis will permanently delete this compliance requirement and all associated inspection records. This cannot be undone.`)) {
                                  handleRemoveCompliance(item.id, item.complianceTypeName);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ); })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── CHILD UNITS (blocks only) ── */}
        {asset?.assetType === "block" && (
          <TabsContent value="children" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Home className="h-4 w-4 text-muted-foreground" />
                  Units in this Block
                </CardTitle>
                <CardDescription>Individual properties within this block of flats</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingChildren ? (
                  <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : !childList?.data?.length ? (
                  <div className="py-12 text-center text-sm text-muted-foreground border-t">No child units found.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset Ref / UPRN</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Old UPRN</TableHead>
                        <TableHead>Compliance</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(childList.data as any[]).map((child: any) => (
                        <TableRow key={child.id}>
                          <TableCell className="font-medium text-sm">{child.assetReference || "-"}</TableCell>
                          <TableCell className="text-sm">{child.fullAddress || child.addressLine1 || "-"}</TableCell>
                          <TableCell className="text-sm capitalize">{child.assetType}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{child.uprn || "-"}</TableCell>
                          <TableCell>
                            {child.complianceSummary && (
                              <div className="flex gap-1 flex-wrap">
                                {child.complianceSummary.overdue > 0 && (
                                  <Badge variant="destructive" className="text-xs">{child.complianceSummary.overdue} Overdue</Badge>
                                )}
                                {child.complianceSummary.dueSoon > 0 && (
                                  <Badge variant="secondary" className="text-xs">{child.complianceSummary.dueSoon} Due Soon</Badge>
                                )}
                                {child.complianceSummary.overdue === 0 && child.complianceSummary.dueSoon === 0 && child.complianceSummary.compliant > 0 && (
                                  <Badge variant="default" className="text-xs">Compliant</Badge>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" asChild>
                              <Link href={`/assets/${child.id}`}>View</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── DOCUMENTS ── */}
        <TabsContent value="documents" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    Documents
                  </CardTitle>
                  <CardDescription className="mt-1">All files attached to this property</CardDescription>
                </div>
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={docUploading}
                    onClick={() => docFileRef.current?.click()}
                  >
                    {docUploading ? (
                      <><Upload className="h-3.5 w-3.5 mr-1.5 animate-pulse" /> Uploading…</>
                    ) : (
                      <><Upload className="h-3.5 w-3.5 mr-1.5" /> Upload File</>
                    )}
                  </Button>
                  <input
                    ref={docFileRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.tiff,.tif,.doc,.docx,.xls,.xlsx,.csv"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleDocUpload(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {docsLoading ? (
                <div className="p-4 space-y-2">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground border-t">
                  <FileText className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No documents uploaded yet.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => docFileRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload first document
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Compliance</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead className="w-28"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc: any) => (
                      <TableRow key={doc.id}>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate max-w-[200px]" title={doc.fileName}>
                              {doc.fileName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs font-mono">
                            {fileIcon(doc.fileType ?? "")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {doc.complianceTypeName
                            ? <Badge variant="secondary" className="text-xs">{doc.complianceTypeName}</Badge>
                            : <span className="text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)} KB` : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {doc.createdAt ? (() => { try { return format(parseISO(doc.createdAt), "dd MMM yyyy"); } catch { return doc.createdAt; } })() : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[100px]">
                          {doc.uploadedByName ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDownload(doc.id, doc.fileName)}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" /> Download
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── HISTORY ── */}
        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Asset History</CardTitle>
              <CardDescription>Audit trail of changes to this asset and its compliance</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <div className="space-y-3">
                  {[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !(assetHistory as any[])?.length ? (
                <div className="text-sm text-muted-foreground py-8 text-center border-2 border-dashed rounded-md">
                  No history recorded for this asset yet.
                </div>
              ) : (
                <ol className="relative border-l border-border space-y-5 ml-3">
                  {(assetHistory as any[]).map((entry: any) => (
                    <li key={entry.id} className="ml-6">
                      <span className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-border text-muted-foreground">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3"/></svg>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold bg-muted rounded px-1.5 py-0.5 uppercase tracking-wide">{entry.action}</span>
                        <span className="text-xs text-muted-foreground">
                          {entry.createdAt ? (() => { try { return format(parseISO(entry.createdAt), "dd MMM yyyy, HH:mm"); } catch { return entry.createdAt; } })() : ""}
                        </span>
                        {entry.actorName && (
                          <span className="text-xs text-muted-foreground">· {entry.actorName}</span>
                        )}
                      </div>
                      {entry.newState && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {Object.entries(entry.newState as Record<string, any>)
                            .filter(([, v]) => v !== null && v !== undefined)
                            .slice(0, 4)
                            .map(([k, v]) => (
                              <span key={k} className="mr-3 capitalize">
                                <span className="font-medium">{k.replace(/_/g, " ")}:</span> {String(v)}
                              </span>
                            ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showManageFields} onOpenChange={setShowManageFields}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Custom Fields</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {fieldDefs.length > 0 ? (
              <div className="space-y-1">
                {fieldDefs.map(def => (
                  <div key={def.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div>
                      <span className="text-sm font-medium">{def.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground capitalize">({def.fieldType})</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 w-7 p-0"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/asset-field-definitions/${def.id}`, {
                            method: "DELETE",
                            headers: { Authorization: `Bearer ${getToken()}` },
                          });
                          if (res.ok) {
                            setFieldDefs(prev => prev.filter(d => d.id !== def.id));
                            toast({ title: `"${def.label}" removed` });
                          }
                        } catch {
                          toast({ title: "Error", description: "Could not remove field.", variant: "destructive" });
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No custom fields yet.</p>
            )}

            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add new field</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Field name, e.g. Ward code"
                  value={newFieldLabel}
                  onChange={e => setNewFieldLabel(e.target.value)}
                  className="flex-1"
                  onKeyDown={async e => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                />
                <Select value={newFieldType} onValueChange={setNewFieldType}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="boolean">Yes / No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManageFields(false)}>Close</Button>
            <Button
              disabled={!newFieldLabel.trim() || savingField}
              onClick={async () => {
                if (!newFieldLabel.trim()) return;
                setSavingField(true);
                try {
                  const res = await fetch("/api/asset-field-definitions", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${getToken()}`,
                    },
                    body: JSON.stringify({ label: newFieldLabel.trim(), fieldType: newFieldType }),
                  });
                  if (!res.ok) {
                    let errMsg = `Server error ${res.status}`;
                    try { const body = await res.json(); errMsg = body.error ?? errMsg; } catch {}
                    console.error("[AddField] POST failed:", res.status, errMsg);
                    throw new Error(errMsg);
                  }
                  const created = await res.json();
                  setFieldDefs(prev => [...prev, created]);
                  setNewFieldLabel("");
                  setNewFieldType("text");
                  toast({ title: `"${created.label}" field added` });
                } catch (err: any) {
                  const msg = err?.message ?? "Could not add field.";
                  console.error("[AddField] error:", msg);
                  toast({ title: "Error", description: msg, variant: "destructive" });
                } finally {
                  setSavingField(false);
                }
              }}
            >
              {savingField ? "Adding…" : "Add field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{asset?.assetReference || asset?.fullAddress || "this asset"}</strong> and all its compliance records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAsset}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
