import { Link } from "wouter";
import { useListTeams, useDeleteTeam } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Crown, UserPlus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function TeamsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: teams, isLoading } = useListTeams();
  const deleteTeam = useDeleteTeam();

  const handleDeleteTeam = (teamId: string, teamName: string) => {
    if (!confirm(`Delete team "${teamName}"? This cannot be undone.`)) return;
    deleteTeam.mutate(
      { teamId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["listTeams"] });
          toast({ title: "Team deleted" });
        },
        onError: (err: any) => toast({ title: err?.message || "Failed to delete", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Teams</h1>
          <p className="text-muted-foreground mt-1">Organise users into teams for compliance assignments.</p>
        </div>
        <Button asChild>
          <Link href="/teams/new">
            <Plus className="mr-2 h-4 w-4" /> New Team
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : !teams?.length ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">No teams yet. Create one to get started.</p>
            <Button className="mt-4" asChild>
              <Link href="/teams/new"><Plus className="mr-2 h-4 w-4" /> Create First Team</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card key={team.id} className="hover:border-primary/50 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold">{team.name}</CardTitle>
                <div className="flex gap-1">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    asChild
                    title="Manage team"
                  >
                    <Link href={`/teams/${team.id}`}>
                      <UserPlus className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDeleteTeam(team.id, team.name)}
                    title="Delete team"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {team.description && (
                  <p className="text-sm text-muted-foreground mb-3">{team.description}</p>
                )}
                <div className="space-y-1.5">
                  {(team.members as any[])?.length ? (
                    (team.members as any[]).map((m: any) => (
                      <div key={m.id} className="flex items-center gap-2 text-sm">
                        {m.isLead && <Crown className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                        <span className="font-medium truncate">
                          {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.username}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No members yet</p>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    {(team.members as any[])?.length ?? 0} member{((team.members as any[])?.length ?? 0) !== 1 ? "s" : ""}
                  </Badge>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" asChild>
                    <Link href={`/teams/${team.id}`}>Manage →</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
