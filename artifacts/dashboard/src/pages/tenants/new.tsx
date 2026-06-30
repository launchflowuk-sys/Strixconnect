import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateTenant } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Building } from "lucide-react";

const EMPTY = {
  name: "",
  slug: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  plan: "trial",
  maxAssets: 1000,
  maxUsers: 10,
  addressLine1: "",
  city: "",
  postCode: "",
  notes: "",
};

export default function TenantNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createTenant = useCreateTenant();
  const [form, setForm] = useState({ ...EMPTY });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.slug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    const payload: Record<string, any> = { ...form };
    Object.keys(payload).forEach(k => { if (payload[k] === "") delete payload[k]; });
    payload.maxAssets = Number(payload.maxAssets);
    payload.maxUsers = Number(payload.maxUsers);

    createTenant.mutate({ data: payload as any }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/tenants"] });
        toast({ title: "Tenant created successfully" });
        navigate("/tenants");
      },
      onError: (err: any) => toast({ title: err?.message || "Failed to create tenant", variant: "destructive" }),
    });
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/tenants"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building className="h-7 w-7" /> Create Tenant
          </h1>
          <p className="text-muted-foreground mt-1">Onboard a new council or organisation onto the platform.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Organisation Details</CardTitle>
            <CardDescription>Basic identity for this tenant on the platform.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Organisation Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Thurrock Council"
                value={form.name}
                onChange={e => {
                  const name = e.target.value;
                  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                  setForm(f => ({ ...f, name, slug: f.slug === "" || f.slug === slug.slice(0, -1) ? slug : f.slug }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Slug <span className="text-destructive">*</span></Label>
              <Input
                placeholder="thurrock-council"
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Used in URLs and identifiers. Lowercase, hyphens only.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input placeholder="Civic Offices, New Road" value={form.addressLine1} onChange={set("addressLine1")} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input placeholder="Grays" value={form.city} onChange={set("city")} />
            </div>
            <div className="space-y-1.5">
              <Label>Postcode</Label>
              <Input placeholder="RM17 6SL" value={form.postCode} onChange={set("postCode")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Primary Contact</CardTitle>
            <CardDescription>The main administrator contact for this tenant.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Contact Name</Label>
              <Input placeholder="Jane Smith" value={form.contactName} onChange={set("contactName")} />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Email</Label>
              <Input type="email" placeholder="jane.smith@thurrock.gov.uk" value={form.contactEmail} onChange={set("contactEmail")} />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Phone</Label>
              <Input type="tel" placeholder="01375 652652" value={form.contactPhone} onChange={set("contactPhone")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan &amp; Limits</CardTitle>
            <CardDescription>Subscription tier and resource limits for this tenant.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={form.plan} onValueChange={v => setForm(f => ({ ...f, plan: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Trial (30 days)</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Max Assets</Label>
              <Input type="number" min={1} value={form.maxAssets} onChange={e => setForm(f => ({ ...f, maxAssets: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Max Users</Label>
              <Input type="number" min={1} value={form.maxUsers} onChange={e => setForm(f => ({ ...f, maxUsers: Number(e.target.value) }))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent>
            <Textarea placeholder="Any setup notes, special requirements, or contract details…" rows={3} value={form.notes} onChange={set("notes")} />
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pb-8">
          <Button type="submit" disabled={createTenant.isPending}>
            {createTenant.isPending ? "Creating…" : "Create Tenant"}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/tenants">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
