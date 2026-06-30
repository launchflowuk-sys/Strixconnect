import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateAsset,
  useListAssets,
  useListComplianceTypes,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Building2, ShieldCheck } from "lucide-react";

const FREQUENCY_LABEL: Record<number, string> = {
  1: "Monthly", 3: "Quarterly", 6: "6-monthly", 12: "Annual",
  24: "Biennial", 36: "3-yearly", 60: "5-yearly",
};
function freqLabel(months: number | null | undefined) {
  if (!months) return null;
  return FREQUENCY_LABEL[months] ?? `Every ${months} months`;
}

const PROPERTY_SUBTYPES = [
  { value: "house", label: "House" },
  { value: "flat", label: "Flat" },
  { value: "maisonette", label: "Maisonette" },
  { value: "bungalow", label: "Bungalow" },
  { value: "commercial", label: "Commercial" },
  { value: "garage", label: "Garage" },
  { value: "communal", label: "Communal Area" },
  { value: "land", label: "Land" },
  { value: "hmo", label: "HMO" },
  { value: "traveller_site", label: "Traveller Site" },
  { value: "other", label: "Other" },
];

const EMPTY = {
  assetReference: "",
  assetType: "property",
  propertySubtype: "",
  status: "active",
  fullAddress: "",
  addressLine1: "",
  addressLine2: "",
  addressLine3: "",
  addressLine4: "",
  postCode: "",
  uprn: "",
  blockReference: "",
  parentId: "",
  bedrooms: "",
  heatingType: "",
  buildType: "",
  archetype: "",
  area: "",
  propertyCategory: "",
  residentType: "",
  notes: "",
};

export default function AssetNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createAsset = useCreateAsset();
  const [form, setForm] = useState({ ...EMPTY });

  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(new Set());
  const [manuallyUnchecked, setManuallyUnchecked] = useState<Set<string>>(new Set());

  const { data: blockList } = useListAssets(
    { assetType: "block", status: "active", limit: 200 },
    { query: { queryKey: ["listAssets", "blocks"] as any } }
  );

  const { data: complianceTypes } = useListComplianceTypes();
  const activeTypes = (complianceTypes as any[] | undefined)?.filter((ct: any) => ct.isActive) ?? [];

  const complianceKey = form.assetType === "property" ? (form.propertySubtype || "property") : form.assetType;

  useEffect(() => {
    if (!activeTypes.length) return;
    setSelectedTypeIds(prev => {
      const next = new Set(prev);
      for (const ct of activeTypes) {
        const applicable = ct.applicableAssetTypes ?? [];
        const matches =
          applicable.includes(complianceKey) ||
          (form.assetType === "property" && applicable.includes("property")) ||
          (form.propertySubtype && applicable.includes(form.propertySubtype));
        if (matches && !manuallyUnchecked.has(ct.id)) {
          next.add(ct.id);
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complianceKey, complianceTypes]);

  function toggleType(id: string, checked: boolean) {
    setSelectedTypeIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
    setManuallyUnchecked(prev => {
      const next = new Set(prev);
      if (checked) next.delete(id); else next.add(id);
      return next;
    });
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.assetReference.trim()) {
      toast({ title: "Asset Reference / UPRN is required", variant: "destructive" });
      return;
    }
    if (form.assetType === "property" && !form.propertySubtype) {
      toast({ title: "Property Sub-Type is required for properties", variant: "destructive" });
      return;
    }
    const payload: Record<string, any> = { ...form };
    Object.keys(payload).forEach(k => { if (payload[k] === "" || payload[k] === null) delete payload[k]; });
    if (payload.bedrooms) payload.bedrooms = Number(payload.bedrooms);
    if (payload.area) payload.area = Number(payload.area);
    if (selectedTypeIds.size > 0) {
      payload.complianceTypeIds = Array.from(selectedTypeIds);
    }

    try {
      const created: any = await createAsset.mutateAsync({ data: payload as any });
      toast({ title: "Asset created" });
      navigate(`/assets/${created.id}`);
    } catch (err: any) {
      toast({ title: err?.message || "Failed to create asset", variant: "destructive" });
    }
  }

  const isPending = createAsset.isPending;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/assets"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-7 w-7" /> Add Asset
          </h1>
          <p className="text-muted-foreground mt-1">Register a new property in the portfolio.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Core Identity */}
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>Core asset identifiers used across the system.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ref">Asset Reference / UPRN <span className="text-destructive">*</span></Label>
              <Input id="ref" placeholder="e.g. THU-001234" value={form.assetReference} onChange={set("assetReference")} />
            </div>
            <div className="space-y-1.5">
              <Label>Asset Type <span className="text-destructive">*</span></Label>
              <Select value={form.assetType} onValueChange={v => setForm(f => ({ ...f, assetType: v, propertySubtype: "" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="property">Property</SelectItem>
                  <SelectItem value="block">Block of Flats</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.assetType === "property" && (
              <div className="space-y-1.5">
                <Label>Property Sub-Type <span className="text-destructive">*</span></Label>
                <Select value={form.propertySubtype} onValueChange={v => setForm(f => ({ ...f, propertySubtype: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select sub-type…" /></SelectTrigger>
                  <SelectContent>
                    {PROPERTY_SUBTYPES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="sold">Sold</SelectItem>
                  <SelectItem value="demolished">Demolished</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uprn">Old UPRN</Label>
              <Input id="uprn" placeholder="100012345678" value={form.uprn} onChange={set("uprn")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blockRef">Block Reference</Label>
              <Input id="blockRef" placeholder="e.g. BLK-001" value={form.blockReference} onChange={set("blockReference")} />
            </div>
            {form.assetType === "property" && (
              <div className="space-y-1.5">
                <Label>Parent Block</Label>
                <Select value={form.parentId} onValueChange={v => setForm(f => ({ ...f, parentId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select block (optional)…" /></SelectTrigger>
                  <SelectContent>
                    {blockList?.data?.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.assetReference} — {b.fullAddress || b.addressLine1 || "No address"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
            <CardDescription>Full postal address for this property.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="fullAddress">Full Address (single line)</Label>
              <Input id="fullAddress" placeholder="123 High Street, Grays, Thurrock, RM17 6SL" value={form.fullAddress} onChange={set("fullAddress")} />
              <p className="text-xs text-muted-foreground">Used for display and search. Populate structured fields below for complete records.</p>
            </div>
            <Separator className="col-span-2" />
            <div className="space-y-1.5">
              <Label htmlFor="addr1">Address Line 1</Label>
              <Input id="addr1" placeholder="123 High Street" value={form.addressLine1} onChange={set("addressLine1")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addr2">Address Line 2</Label>
              <Input id="addr2" placeholder="Flat 2B" value={form.addressLine2} onChange={set("addressLine2")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addr3">Town / City</Label>
              <Input id="addr3" placeholder="Grays" value={form.addressLine3} onChange={set("addressLine3")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addr4">County</Label>
              <Input id="addr4" placeholder="Essex" value={form.addressLine4} onChange={set("addressLine4")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc">Postcode</Label>
              <Input id="pc" placeholder="RM17 6SL" value={form.postCode} onChange={set("postCode")} className="uppercase" />
            </div>
          </CardContent>
        </Card>

        {/* Property Attributes */}
        <Card>
          <CardHeader>
            <CardTitle>Property Attributes</CardTitle>
            <CardDescription>Physical and classification details used for compliance matching and reporting.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Property Category</Label>
              <Select value={form.propertyCategory} onValueChange={v => setForm(f => ({ ...f, propertyCategory: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general_needs">General Needs</SelectItem>
                  <SelectItem value="sheltered">Sheltered</SelectItem>
                  <SelectItem value="supported">Supported</SelectItem>
                  <SelectItem value="temporary">Temporary</SelectItem>
                  <SelectItem value="shared_ownership">Shared Ownership</SelectItem>
                  <SelectItem value="leasehold">Leasehold</SelectItem>
                  <SelectItem value="right_to_buy">Right to Buy</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Resident Type</Label>
              <Select value={form.residentType} onValueChange={v => setForm(f => ({ ...f, residentType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="council_tenant">Council Tenant</SelectItem>
                  <SelectItem value="leaseholder">Leaseholder</SelectItem>
                  <SelectItem value="shared_owner">Shared Owner</SelectItem>
                  <SelectItem value="freeholder">Freeholder</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Build Type</Label>
              <Select value={form.buildType} onValueChange={v => setForm(f => ({ ...f, buildType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="traditional">Traditional</SelectItem>
                  <SelectItem value="non_traditional">Non-Traditional</SelectItem>
                  <SelectItem value="system_built">System Built</SelectItem>
                  <SelectItem value="modern_methods">Modern Methods</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Heating Type</Label>
              <Select value={form.heatingType} onValueChange={v => setForm(f => ({ ...f, heatingType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gas_central">Gas Central Heating</SelectItem>
                  <SelectItem value="electric">Electric</SelectItem>
                  <SelectItem value="district">District / Communal</SelectItem>
                  <SelectItem value="heat_pump">Heat Pump</SelectItem>
                  <SelectItem value="solid_fuel">Solid Fuel</SelectItem>
                  <SelectItem value="oil">Oil</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Archetype</Label>
              <Select value={form.archetype} onValueChange={v => setForm(f => ({ ...f, archetype: v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="detached">Detached</SelectItem>
                  <SelectItem value="semi_detached">Semi-Detached</SelectItem>
                  <SelectItem value="terraced">Terraced</SelectItem>
                  <SelectItem value="end_terrace">End of Terrace</SelectItem>
                  <SelectItem value="maisonette">Maisonette</SelectItem>
                  <SelectItem value="purpose_built_flat">Purpose Built Flat</SelectItem>
                  <SelectItem value="converted_flat">Converted Flat</SelectItem>
                  <SelectItem value="bungalow">Bungalow</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bedrooms">Bedrooms</Label>
              <Input id="bedrooms" type="number" min={0} max={20} placeholder="0" value={form.bedrooms} onChange={set("bedrooms")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="area">Floor Area (m²)</Label>
              <Input id="area" type="number" min={0} placeholder="e.g. 72" value={form.area} onChange={set("area")} />
            </div>
          </CardContent>
        </Card>

        {/* Property Compliance Elements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              Property Compliance Elements
            </CardTitle>
            <CardDescription>
              Select the compliance checks that apply to this property.
              {activeTypes.length > 0 && " Recommended items for this asset type are pre-ticked."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No compliance types configured — add them in Settings.
              </p>
            ) : (
              <div className="space-y-2">
                {activeTypes.map((ct: any) => {
                  const applicable = ct.applicableAssetTypes ?? [];
                  const isRecommended =
                    applicable.includes(complianceKey) ||
                    (form.assetType === "property" && applicable.includes("property")) ||
                    (form.propertySubtype && applicable.includes(form.propertySubtype));
                  const freq = freqLabel(ct.frequencyMonths);
                  return (
                    <div
                      key={ct.id}
                      className="flex items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-muted/40 transition-colors"
                    >
                      <Checkbox
                        id={`ct-${ct.id}`}
                        checked={selectedTypeIds.has(ct.id)}
                        onCheckedChange={(v) => toggleType(ct.id, !!v)}
                      />
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {ct.color && (
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: ct.color }}
                          />
                        )}
                        <label
                          htmlFor={`ct-${ct.id}`}
                          className="text-sm font-medium cursor-pointer truncate"
                        >
                          {ct.name}
                        </label>
                        {freq && (
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {freq}
                          </span>
                        )}
                      </div>
                      {isRecommended && (
                        <Badge variant="secondary" className="text-xs flex-shrink-0">
                          Recommended
                        </Badge>
                      )}
                    </div>
                  );
                })}
                {selectedTypeIds.size > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    {selectedTypeIds.size} compliance {selectedTypeIds.size === 1 ? "item" : "items"} will be created with this asset.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Any additional notes about this asset…"
              rows={4}
              value={form.notes}
              onChange={set("notes")}
            />
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pb-8">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create Asset"}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/assets">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
