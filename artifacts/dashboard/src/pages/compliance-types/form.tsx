import { useState, useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useListComplianceTypes,
  useCreateComplianceType,
  useUpdateComplianceType,
  useRenameCustomField,
  useDeleteCustomField,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ShieldCheck, Pencil, Trash2, Check, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const EMPTY = {
  name: "",
  code: "",
  color: "#6366f1",
  frequencyMonths: 12,
  dueSoonDays: 30,
  isActive: true,
  description: "",
  applicableTo: [] as string[],
  regulatoryBody: "",
  documentTemplate: "",
};

const ASSET_TYPES = [
  { value: "house", label: "House" },
  { value: "flat", label: "Flat" },
  { value: "block", label: "Block of Flats" },
  { value: "commercial", label: "Commercial" },
  { value: "garage", label: "Garage" },
  { value: "communal", label: "Communal Area" },
  { value: "other", label: "Other" },
];

interface CustomFieldDef {
  key: string;
  label: string;
}

interface EditingField {
  key: string;
  label: string;
}

export default function ComplianceTypeFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createType = useCreateComplianceType();
  const updateType = useUpdateComplianceType();
  const renameField = useRenameCustomField();
  const deleteField = useDeleteCustomField();

  const [form, setForm] = useState({ ...EMPTY });
  const [loaded, setLoaded] = useState(!isEdit);
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldDef | null>(null);

  const { data: allTypes } = useListComplianceTypes({
    query: { enabled: isEdit, queryKey: ["listComplianceTypes"] as any },
  });

  useEffect(() => {
    if (isEdit && allTypes) {
      const existing = (allTypes as any[]).find((t: any) => t.id === id);
      if (existing) {
        setForm({
          name: existing.name ?? "",
          code: existing.code ?? "",
          color: existing.color ?? "#6366f1",
          frequencyMonths: existing.frequencyMonths ?? 12,
          dueSoonDays: existing.dueSoonDays ?? 30,
          isActive: existing.isActive ?? true,
          description: existing.description ?? "",
          applicableTo: existing.applicableAssetTypes ?? [],
          regulatoryBody: existing.regulatoryBody ?? "",
          documentTemplate: existing.documentTemplate ?? "",
        });
        setCustomFields(
          Array.isArray(existing.customFieldDefinitions)
            ? existing.customFieldDefinitions
            : []
        );
        setLoaded(true);
      }
    }
  }, [isEdit, allTypes, id]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function toggleApplicable(val: string) {
    setForm(f => ({
      ...f,
      applicableTo: f.applicableTo.includes(val)
        ? f.applicableTo.filter(x => x !== val)
        : [...f.applicableTo, val],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) {
      toast({ title: "Name and code are required", variant: "destructive" });
      return;
    }
    const { applicableTo, ...rest } = form;
    const payload = {
      ...rest,
      frequencyMonths: Number(form.frequencyMonths),
      dueSoonDays: Number(form.dueSoonDays),
      applicableAssetTypes: applicableTo,
    };

    if (isEdit) {
      updateType.mutate({ typeId: id!, data: payload as any }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/api/compliance-types"] });
          toast({ title: "Compliance type updated" });
          navigate("/compliance-types");
        },
        onError: (err: any) => toast({ title: err?.message || "Update failed", variant: "destructive" }),
      });
    } else {
      createType.mutate({ data: payload as any }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/api/compliance-types"] });
          toast({ title: "Compliance type created" });
          navigate("/compliance-types");
        },
        onError: (err: any) => toast({ title: err?.message || "Create failed", variant: "destructive" }),
      });
    }
  }

  function handleStartEdit(field: CustomFieldDef) {
    setEditingField({ key: field.key, label: field.label });
  }

  function handleCancelEdit() {
    setEditingField(null);
  }

  function handleSaveRename() {
    if (!editingField || !id) return;
    const trimmed = editingField.label.trim();
    if (!trimmed) {
      toast({ title: "Label cannot be empty", variant: "destructive" });
      return;
    }
    renameField.mutate(
      { typeId: id, fieldKey: editingField.key, data: { label: trimmed } },
      {
        onSuccess: (updated: any) => {
          setCustomFields(
            Array.isArray(updated.customFieldDefinitions)
              ? updated.customFieldDefinitions
              : []
          );
          qc.invalidateQueries({ queryKey: ["/api/compliance-types"] });
          setEditingField(null);
          toast({ title: "Field renamed" });
        },
        onError: (err: any) =>
          toast({ title: err?.message || "Rename failed", variant: "destructive" }),
      }
    );
  }

  function handleConfirmDelete() {
    if (!deleteTarget || !id) return;
    deleteField.mutate(
      { typeId: id, fieldKey: deleteTarget.key },
      {
        onSuccess: (updated: any) => {
          setCustomFields(
            Array.isArray(updated.customFieldDefinitions)
              ? updated.customFieldDefinitions
              : []
          );
          qc.invalidateQueries({ queryKey: ["/api/compliance-types"] });
          setDeleteTarget(null);
          toast({ title: "Custom field removed" });
        },
        onError: (err: any) =>
          toast({ title: err?.message || "Delete failed", variant: "destructive" }),
      }
    );
  }

  const isPending = createType.isPending || updateType.isPending;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/compliance-types"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-7 w-7" />
            {isEdit ? "Edit Compliance Type" : "Add Compliance Type"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isEdit ? "Update the compliance type settings." : "Define a new compliance requirement for your assets."}
          </p>
        </div>
      </div>

      {isEdit && !loaded ? (
        <Card><CardContent className="p-6 space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent></Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Core Details */}
          <Card>
            <CardHeader>
              <CardTitle>Core Details</CardTitle>
              <CardDescription>Name, code, and scheduling configuration.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. Gas Safety (CP12)" value={form.name} onChange={set("name")} />
              </div>
              <div className="space-y-1.5">
                <Label>Code <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="e.g. GAS_CP12"
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, "_") }))}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">Unique short code. Used in imports and reports.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Colour</Label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="h-9 w-14 rounded border cursor-pointer p-0.5"
                  />
                  <Input
                    value={form.color}
                    onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="font-mono"
                    placeholder="#6366f1"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Inspection Frequency</Label>
                <Select
                  value={String(form.frequencyMonths)}
                  onValueChange={v => setForm(f => ({ ...f, frequencyMonths: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Monthly (1 month)</SelectItem>
                    <SelectItem value="3">Quarterly (3 months)</SelectItem>
                    <SelectItem value="6">6-Monthly</SelectItem>
                    <SelectItem value="12">Annual (12 months)</SelectItem>
                    <SelectItem value="18">18-Monthly</SelectItem>
                    <SelectItem value="24">2-Yearly (24 months)</SelectItem>
                    <SelectItem value="36">3-Yearly (36 months)</SelectItem>
                    <SelectItem value="60">5-Yearly (60 months)</SelectItem>
                    <SelectItem value="custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {!["1","3","6","12","18","24","36","60"].includes(String(form.frequencyMonths)) && (
                  <Input
                    type="number"
                    min={1}
                    value={form.frequencyMonths}
                    onChange={e => setForm(f => ({ ...f, frequencyMonths: Number(e.target.value) }))}
                    placeholder="Months"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Due Soon Warning (days before expiry)</Label>
                <Select
                  value={String(form.dueSoonDays)}
                  onValueChange={v => setForm(f => ({ ...f, dueSoonDays: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  placeholder="What this compliance type covers, relevant legislation, etc."
                  rows={3}
                  value={form.description}
                  onChange={set("description")}
                />
              </div>
            </CardContent>
          </Card>

          {/* Scope & Regulation */}
          <Card>
            <CardHeader>
              <CardTitle>Scope &amp; Regulation</CardTitle>
              <CardDescription>Which asset types require this, and the governing regulatory body.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Applicable Asset Types</Label>
                <p className="text-xs text-muted-foreground">Leave all unchecked to apply to all asset types.</p>
                <div className="flex flex-wrap gap-3">
                  {ASSET_TYPES.map(at => (
                    <label key={at.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={form.applicableTo.includes(at.value)}
                        onChange={() => toggleApplicable(at.value)}
                      />
                      <span className="text-sm">{at.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Regulatory Body</Label>
                <Input
                  placeholder="e.g. Health and Safety Executive (HSE)"
                  value={form.regulatoryBody}
                  onChange={set("regulatoryBody")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Certificate / Document Template Name</Label>
                <Input
                  placeholder="e.g. CP12, EICR, EPC"
                  value={form.documentTemplate}
                  onChange={set("documentTemplate")}
                />
              </div>
            </CardContent>
          </Card>

          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                />
                <Label>{form.isActive ? "Active — tracking enabled" : "Inactive — not tracked"}</Label>
              </div>
            </CardContent>
          </Card>

          {/* Additional Fields — only visible in edit mode */}
          {isEdit && (
            <Card>
              <CardHeader>
                <CardTitle>Additional Fields</CardTitle>
                <CardDescription>
                  Custom fields captured during import. You can rename a field label or remove it.
                  Removing a field definition does not erase values already stored on existing records.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {customFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No custom fields defined. They are created automatically when you import records with extra columns.
                  </p>
                ) : (
                  <div className="divide-y rounded-md border">
                    {customFields.map(field => (
                      <div key={field.key} className="flex items-center gap-3 px-3 py-2.5">
                        {editingField?.key === field.key ? (
                          <>
                            <Input
                              className="h-7 text-sm flex-1"
                              value={editingField.label}
                              onChange={e =>
                                setEditingField(prev => prev ? { ...prev, label: e.target.value } : prev)
                              }
                              onKeyDown={e => {
                                if (e.key === "Enter") { e.preventDefault(); handleSaveRename(); }
                                if (e.key === "Escape") handleCancelEdit();
                              }}
                              autoFocus
                            />
                            <Badge variant="outline" className="font-mono text-xs shrink-0">
                              {field.key}
                            </Badge>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-green-600 hover:text-green-700 shrink-0"
                              onClick={handleSaveRename}
                              disabled={renameField.isPending}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={handleCancelEdit}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="text-sm flex-1 font-medium">{field.label}</span>
                            <Badge variant="outline" className="font-mono text-xs shrink-0">
                              {field.key}
                            </Badge>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                              onClick={() => handleStartEdit(field)}
                              title="Rename label"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => setDeleteTarget(field)}
                              title="Remove field"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex items-center gap-3 pb-8">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Compliance Type"}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/compliance-types">Cancel</Link>
            </Button>
          </div>
        </form>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove custom field?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the field definition <strong>&quot;{deleteTarget?.label}&quot;</strong> (key:{" "}
              <code className="font-mono text-xs">{deleteTarget?.key}</code>) from this compliance type.
              <br /><br />
              Values already stored on existing compliance records will not be deleted — they will just
              no longer have a matching label displayed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteField.isPending ? "Removing…" : "Remove field"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
