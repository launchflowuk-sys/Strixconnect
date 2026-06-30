import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useGetAsset,
  getGetAssetQueryKey,
  useUpdateAsset,
  useListAssets,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Building2 } from "lucide-react";

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

export default function AssetEditPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateAsset = useUpdateAsset();

  const { data: asset, isLoading } = useGetAsset(id!, {
    query: { enabled: !!id, queryKey: getGetAssetQueryKey(id!) },
  });

  const { data: blockList } = useListAssets(
    { assetType: "block", status: "active", limit: 200 },
    { query: { queryKey: ["listAssets", "blocks"] as any } }
  );

  const [form, setForm] = useState({
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
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!asset || ready) return;
    const a = asset as any;
    setForm({
      assetReference: a.assetReference ?? "",
      assetType: a.assetType ?? "property",
      propertySubtype: a.propertySubtype ?? "",
      status: a.status ?? "active",
      fullAddress: a.fullAddress ?? "",
      addressLine1: a.addressLine1 ?? "",
      addressLine2: a.addressLine2 ?? "",
      addressLine3: a.addressLine3 ?? "",
      addressLine4: a.addressLine4 ?? "",
      postCode: a.postCode ?? "",
      uprn: a.uprn ?? "",
      blockReference: a.blockReference ?? "",
      parentId: a.parentAssetId ?? "",
      bedrooms: a.bedrooms != null ? String(a.bedrooms) : "",
      heatingType: a.heatingType ?? "",
      buildType: a.buildType ?? "",
      archetype: a.archetype ?? "",
      area: a.area != null ? String(a.area) : "",
      propertyCategory: a.propertyCategory ?? "",
      residentType: a.residentType ?? "",
      notes: a.notes ?? "",
    });
    setReady(true);
  }, [asset, ready]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    if (!form.assetReference.trim()) {
      toast({ title: "Asset Reference / UPRN is required", variant: "destructive" });
      return;
    }
    if (form.assetType === "property" && !form.propertySubtype) {
      toast({ title: "Property Sub-Type is required for properties", variant: "destructive" });
      return;
    }

    const payload: Record<string, any> = {
      assetReference: form.assetReference,
      assetType: form.assetType,
      status: form.status,
      fullAddress: form.fullAddress || undefined,
      addressLine1: form.addressLine1 || undefined,
      addressLine2: form.addressLine2 || undefined,
      addressLine3: form.addressLine3 || undefined,
      addressLine4: form.addressLine4 || undefined,
      postCode: form.postCode || undefined,
      uprn: form.uprn || undefined,
      blockReference: form.blockReference || undefined,
      parentAssetId: form.parentId || undefined,
      bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
      heatingType: form.heatingType || undefined,
      buildType: form.buildType || undefined,
      archetype: form.archetype || undefined,
      area: form.area ? Number(form.area) : undefined,
      propertyCategory: form.propertyCategory || undefined,
      residentType: form.residentType || undefined,
      notes: form.notes || undefined,
    };
    if (form.assetType === "property") {
      payload.propertySubtype = form.propertySubtype;
    } else {
      payload.propertySubtype = null;
    }

    try {
      await updateAsset.mutateAsync({ assetId: id, data: payload as any });
      await queryClient.invalidateQueries({ queryKey: getGetAssetQueryKey(id) });
      toast({ title: "Asset updated successfully" });
      navigate(`/assets/${id}`);
    } catch (err: any) {
      toast({ title: err?.message || "Failed to save changes", variant: "destructive" });
    }
  }

  if (isLoading || !ready) {
    return (
      <div className="flex flex-col gap-6 max-w-4xl">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/assets/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href={`/assets/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-7 w-7" /> Edit Asset
          </h1>
          <p className="text-muted-foreground mt-1">
            {(asset as any)?.assetReference} — {(asset as any)?.fullAddress || (asset as any)?.addressLine1 || "No address"}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Identity */}
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
              <Select value={form.assetType} onValueChange={v => setForm(f => ({ ...f, assetType: v, propertySubtype: v === "block" ? "" : f.propertySubtype }))}>
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
                  <SelectItem value="inactive">Inactive</SelectItem>
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
                <Select value={form.parentId || "_none"} onValueChange={v => setForm(f => ({ ...f, parentId: v === "_none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None</SelectItem>
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
              <Select value={form.propertyCategory || "_none"} onValueChange={v => setForm(f => ({ ...f, propertyCategory: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
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
              <Select value={form.residentType || "_none"} onValueChange={v => setForm(f => ({ ...f, residentType: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
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
              <Select value={form.buildType || "_none"} onValueChange={v => setForm(f => ({ ...f, buildType: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  <SelectItem value="traditional">Traditional</SelectItem>
                  <SelectItem value="non_traditional">Non-Traditional</SelectItem>
                  <SelectItem value="system_built">System Built</SelectItem>
                  <SelectItem value="modern_methods">Modern Methods</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Heating Type</Label>
              <Select value={form.heatingType || "_none"} onValueChange={v => setForm(f => ({ ...f, heatingType: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
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
              <Select value={form.archetype || "_none"} onValueChange={v => setForm(f => ({ ...f, archetype: v === "_none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
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
          <Button type="submit" disabled={updateAsset.isPending}>
            {updateAsset.isPending ? "Saving…" : "Save Changes"}
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/assets/${id}`}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
