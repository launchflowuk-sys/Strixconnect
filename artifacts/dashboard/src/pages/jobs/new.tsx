import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Briefcase } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useListAssets } from "@workspace/api-client-react";

const EMPTY = {
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
  assetId: "",
  location: "",
  estimatedCost: "",
  contractorName: "",
  contractorRef: "",
  tags: "",
};

export default function JobNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);

  const { data: assetList } = useListAssets(
    { status: "active", limit: 200 },
    { query: { queryKey: ["listAssets", "active-jobs"] as any } }
  );

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast({ title: "Job title is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, any> = { ...form };
      Object.keys(payload).forEach(k => { if (payload[k] === "" || payload[k] === null) delete payload[k]; });
      if (payload.estimatedCost) payload.estimatedCost = Number(payload.estimatedCost);
      if (payload.tags) payload.tags = payload.tags.split(",").map((t: string) => t.trim()).filter(Boolean);

      const created = await apiClient.post("/jobs", payload);
      qc.invalidateQueries({ queryKey: ["listJobs"] });
      toast({ title: "Job created" });
      navigate(`/jobs/${(created as any).id}`);
    } catch (err: any) {
      toast({ title: err?.message || "Failed to create job", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/jobs"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Briefcase className="h-7 w-7" /> New Job
          </h1>
          <p className="text-muted-foreground mt-1">Create a remedial work order or follow-on action.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Job Details</CardTitle>
            <CardDescription>What needs to be done, and how urgent is it?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. Replace faulty boiler at 14 High Street" value={form.title} onChange={set("title")} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                placeholder="Detailed description of the work required, any access instructions, hazards, etc."
                rows={5}
                value={form.description}
                onChange={set("description")}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low — no immediate risk</SelectItem>
                    <SelectItem value="medium">Medium — action required</SelectItem>
                    <SelectItem value="high">High — urgent action needed</SelectItem>
                    <SelectItem value="critical">Critical — immediate action required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={set("dueDate")} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Asset &amp; Location</CardTitle>
            <CardDescription>Link this job to a specific asset.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Asset</Label>
              <Select value={form.assetId} onValueChange={v => setForm(f => ({ ...f, assetId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an asset (optional)…" />
                </SelectTrigger>
                <SelectContent>
                  {(assetList?.data as any[] ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.assetReference} — {a.fullAddress || a.addressLine1 || "No address"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Specific Location / Room</Label>
              <Input placeholder="e.g. Boiler cupboard, 1st floor bathroom" value={form.location} onChange={set("location")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contractor &amp; Cost</CardTitle>
            <CardDescription>Optional contractor assignment and cost estimate.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Contractor Name</Label>
              <Input placeholder="e.g. Thames Gas Services Ltd" value={form.contractorName} onChange={set("contractorName")} />
            </div>
            <div className="space-y-1.5">
              <Label>Contractor Job Ref</Label>
              <Input placeholder="e.g. TGS-2024-0042" value={form.contractorRef} onChange={set("contractorRef")} />
            </div>
            <div className="space-y-1.5">
              <Label>Estimated Cost (£)</Label>
              <Input type="number" min={0} step="0.01" placeholder="0.00" value={form.estimatedCost} onChange={set("estimatedCost")} />
            </div>
            <div className="space-y-1.5">
              <Label>Tags</Label>
              <Input placeholder="gas, boiler, emergency (comma separated)" value={form.tags} onChange={set("tags")} />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pb-8">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create Job"}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/jobs">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
