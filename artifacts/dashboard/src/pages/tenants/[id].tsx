import { useParams, Link } from "wouter";
import {
  useGetTenantStats,
  useSuspendTenant,
  useActivateTenant,
  useListTenants,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Building, Users, LayoutList, AlertTriangle } from "lucide-react";

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const suspend = useSuspendTenant();
  const activate = useActivateTenant();

  const { data: tenantList, isLoading: isLoadingTenant } = useListTenants();
  const tenant = (tenantList?.data as any[] | undefined)?.find((t: any) => t.id === id);

  const { data: stats, isLoading: isLoadingStats } = useGetTenantStats(id!, {
    query: { enabled: !!id, queryKey: ["getTenantStats", id] as any },
  });

  function handleSuspend() {
    suspend.mutate({ tenantId: id! }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/tenants"] });
        toast({ title: "Tenant suspended" });
      },
      onError: (e: any) => toast({ title: e.message || "Failed to suspend", variant: "destructive" }),
    });
  }

  function handleActivate() {
    activate.mutate({ tenantId: id! }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/tenants"] });
        toast({ title: "Tenant activated" });
      },
      onError: (e: any) => toast({ title: e.message || "Failed to activate", variant: "destructive" }),
    });
  }

  const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
    active: "default",
    trial: "secondary",
    suspended: "destructive",
  };

  const STAT_CARDS = [
    { label: "Total Assets", value: stats?.assetCount, icon: Building, color: "text-blue-600" },
    { label: "Users", value: stats?.userCount, icon: Users, color: "text-violet-600" },
    { label: "Compliance Items", value: stats?.complianceItemCount, icon: LayoutList, color: "text-emerald-600" },
    { label: "Overdue Items", value: stats?.overdueCount, icon: AlertTriangle, color: "text-destructive" },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/tenants"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          {isLoadingTenant ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{tenant?.name ?? "Tenant"}</h1>
              {tenant?.status && (
                <Badge variant={STATUS_VARIANT[tenant.status] ?? "secondary"} className="capitalize">
                  {tenant.status}
                </Badge>
              )}
            </div>
          )}
          <p className="text-muted-foreground mt-1 font-mono text-sm">{tenant?.slug}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-4 w-4 ${color}`} />
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
              {isLoadingStats ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p className="text-2xl font-bold">{value ?? 0}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tenant Info */}
      {tenant && (
        <Card>
          <CardHeader>
            <CardTitle>Organisation Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ["Plan", tenant.plan],
                ["Contact Name", tenant.contactName],
                ["Contact Email", tenant.contactEmail],
                ["Max Assets", tenant.maxAssets],
                ["Max Users", tenant.maxUsers],
                ["Created", tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—"],
              ].map(([label, val]) => (
                <div key={String(label)}>
                  <dt className="text-muted-foreground capitalize">{label}</dt>
                  <dd className="font-medium mt-0.5">{val ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>Manage this tenant's access and status.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {tenant?.status !== "suspended" ? (
            <Button
              variant="destructive"
              onClick={handleSuspend}
              disabled={suspend.isPending || isLoadingTenant}
            >
              {suspend.isPending ? "Suspending…" : "Suspend Tenant"}
            </Button>
          ) : (
            <Button
              onClick={handleActivate}
              disabled={activate.isPending || isLoadingTenant}
            >
              {activate.isPending ? "Activating…" : "Activate Tenant"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
