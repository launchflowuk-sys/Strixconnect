import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useListTeams,
  useAddTeamMember,
  useRemoveTeamMember,
  useDeleteTeam,
  useListUsers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Crown, Trash2, UserPlus, Users } from "lucide-react";

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [isLead, setIsLead] = useState(false);

  const { data: teams, isLoading } = useListTeams();
  const { data: userList } = useListUsers({ limit: 200 });
  const addMember = useAddTeamMember();
  const removeMember = useRemoveTeamMember();
  const deleteTeam = useDeleteTeam();

  const team = teams?.find((t: any) => t.id === id);
  const existingMemberIds = team?.members?.map((m: any) => m.userId) ?? [];
  const availableUsers = (userList?.data as any[] ?? []).filter((u: any) => !existingMemberIds.includes(u.id));

  function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUserId) return;
    addMember.mutate(
      { teamId: id!, data: { userId: selectedUserId, isLead } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["listTeams"] });
          setSelectedUserId("");
          setIsLead(false);
          toast({ title: "Member added" });
        },
        onError: (err: any) => toast({ title: err?.message || "Failed to add member", variant: "destructive" }),
      }
    );
  }

  function handleRemoveMember(userId: string) {
    removeMember.mutate(
      { teamId: id!, userId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["listTeams"] });
          toast({ title: "Member removed" });
        },
        onError: (err: any) => toast({ title: err?.message || "Failed to remove", variant: "destructive" }),
      }
    );
  }

  function handleDeleteTeam() {
    if (!confirm(`Are you sure you want to delete team "${team?.name}"? This cannot be undone.`)) return;
    deleteTeam.mutate(
      { teamId: id! },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["listTeams"] });
          toast({ title: "Team deleted" });
          window.history.back();
        },
        onError: (err: any) => toast({ title: err?.message || "Failed to delete", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/teams"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          {isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Users className="h-7 w-7" /> {team?.name ?? "Team"}
            </h1>
          )}
          {team?.description && (
            <p className="text-muted-foreground mt-1">{team.description}</p>
          )}
        </div>
      </div>

      {/* Members list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {team?.members?.length ?? 0} member{(team?.members?.length ?? 0) !== 1 ? "s" : ""} in this team
            </CardDescription>
          </div>
          <Badge variant="outline">
            {team?.members?.length ?? 0} member{(team?.members?.length ?? 0) !== 1 ? "s" : ""}
          </Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !team?.members?.length ? (
            <p className="text-sm text-muted-foreground italic py-4 text-center">No members yet. Add one below.</p>
          ) : (
            <ul className="divide-y">
              {team.members.map((m: any) => (
                <li key={m.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                      {m.firstName?.[0] ?? m.username?.[0] ?? "?"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        {m.isLead && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                        <span className="font-medium text-sm">
                          {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.username}
                        </span>
                        {m.isLead && <Badge variant="outline" className="text-xs">Lead</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{m.email ?? m.username}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveMember(m.userId)}
                    title="Remove from team"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add member form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Add Member
          </CardTitle>
          <CardDescription>Add a user from your organisation to this team.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="space-y-1.5">
              <Label>User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder={availableUsers.length ? "Select a user…" : "All users already added"} />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.username}
                      {u.email ? ` — ${u.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is-lead"
                className="rounded"
                checked={isLead}
                onChange={e => setIsLead(e.target.checked)}
              />
              <Label htmlFor="is-lead">Make this person the team lead</Label>
            </div>
            <Button
              type="submit"
              disabled={!selectedUserId || addMember.isPending || !availableUsers.length}
            >
              {addMember.isPending ? "Adding…" : "Add Member"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete this team</p>
              <p className="text-xs text-muted-foreground">Permanently removes the team. Members will not be deleted.</p>
            </div>
            <Button variant="destructive" size="sm" onClick={handleDeleteTeam} disabled={deleteTeam.isPending}>
              {deleteTeam.isPending ? "Deleting…" : "Delete Team"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
