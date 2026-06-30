import { Link } from "wouter";
import { useListTenants } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";

export default function TenantsPage() {
  const { data: tenantList, isLoading } = useListTenants();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Tenants</h1>
          <p className="text-muted-foreground mt-1">Super admin tenant management.</p>
        </div>
        <Button asChild>
          <Link href="/tenants/new">
            <Plus className="mr-2 h-4 w-4" />
            Create Tenant
          </Link>
        </Button>
      </div>

      <Card>
        <div className="rounded-md border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assets</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <Skeleton className="h-8 w-[200px] mx-auto" />
                  </TableCell>
                </TableRow>
              ) : tenantList?.data && tenantList.data.length > 0 ? (
                tenantList.data.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell className="font-medium">{tenant.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{tenant.slug}</TableCell>
                    <TableCell>
                      <Badge
                        variant={tenant.status === 'active' ? "default" : tenant.status === 'trial' ? "secondary" : "destructive"}
                        className="capitalize"
                      >
                        {tenant.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{tenant.assetCount ?? 0}</TableCell>
                    <TableCell>{tenant.userCount ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/tenants/${tenant.id}`}>Manage</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">No tenants found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
