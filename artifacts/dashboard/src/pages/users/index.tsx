import { useState } from "react";
import { Link } from "wouter";
import {
  useListUsers, useDeactivateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Plus, UserX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const ROLE_LABELS: Record<string, string> = {
  tenant_admin: "Tenant Admin",
  compliance_manager: "Compliance Manager",
  team_member: "Team Member",
  auditor: "Auditor",
};

export default function UsersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const deactivateUser = useDeactivateUser();

  const params = { search: search || undefined, limit: 50 };
  const { data: userList, isLoading } = useListUsers(params, {
    query: { queryKey: getListUsersQueryKey(params) },
  });

  const handleDeactivate = (userId: string) => {
    if (!confirm("Deactivate this user? They will no longer be able to log in.")) return;
    deactivateUser.mutate(
      { userId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey(params) });
          toast({ title: "User deactivated" });
        },
        onError: (err: any) => toast({ title: err?.message || "Failed to deactivate", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Users</h1>
          <p className="text-muted-foreground mt-1">Manage user access and roles for this tenant.</p>
        </div>
        <Button asChild>
          <Link href="/users/new">
            <Plus className="mr-2 h-4 w-4" /> Add User
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users…"
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : userList?.data?.length ? (
              userList.data.map((user: any) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.firstName || user.lastName
                      ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
                      : <span className="text-muted-foreground italic">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">{user.email}</TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">{user.username}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-xs">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? "default" : "secondary"}>
                      {user.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {user.lastLoginAt
                      ? (() => { try { return format(parseISO(user.lastLoginAt), "dd MMM yyyy"); } catch { return user.lastLoginAt; } })()
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    {user.isActive && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Deactivate user"
                        onClick={() => handleDeactivate(user.id)}
                      >
                        <UserX className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
