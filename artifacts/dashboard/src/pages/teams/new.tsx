import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateTeam } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users } from "lucide-react";

export default function TeamNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createTeam = useCreateTeam();
  const [form, setForm] = useState({ name: "", description: "" });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Team name is required", variant: "destructive" });
      return;
    }
    createTeam.mutate(
      { data: { name: form.name.trim(), description: form.description.trim() || undefined } },
      {
        onSuccess: (created: any) => {
          qc.invalidateQueries({ queryKey: ["listTeams"] });
          toast({ title: "Team created" });
          navigate(`/teams/${created.id}`);
        },
        onError: (err: any) => toast({ title: err?.message || "Failed to create team", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/teams"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-7 w-7" /> Create Team
          </h1>
          <p className="text-muted-foreground mt-1">Organise users into a team for compliance assignments.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Team Details</CardTitle>
            <CardDescription>Once created you can add members from the team page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Team Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Gas Safety Team"
                value={form.name}
                onChange={set("name")}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                placeholder="What does this team handle? What compliance areas are they responsible for?"
                rows={4}
                value={form.description}
                onChange={set("description")}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 pb-8">
          <Button type="submit" disabled={createTeam.isPending}>
            {createTeam.isPending ? "Creating…" : "Create Team"}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/teams">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
