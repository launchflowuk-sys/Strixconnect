import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useGetMyTenant, useUpdateMyTenant, getGetMyTenantQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Users, UserCog, ClipboardCheck, Upload, ArrowRight, Bell } from "lucide-react";

export default function SettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: tenant, isLoading } = useGetMyTenant({
    query: { queryKey: getGetMyTenantQueryKey() },
  });

  const updateTenant = useUpdateMyTenant();
  const [orgSaved, setOrgSaved] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);

  const [orgForm, setOrgForm] = useState({ name: "", contactEmail: "", contactName: "" });
  const [notifForm, setNotifForm] = useState({ notificationsEnabled: true, notificationEmail: "" });

  useEffect(() => {
    if (!tenant) return;
    const t = tenant as any;
    setOrgForm({
      name: t.name ?? "",
      contactEmail: t.contactEmail ?? "",
      contactName: t.contactName ?? "",
    });
    setNotifForm({
      notificationsEnabled: t.notificationsEnabled !== false,
      notificationEmail: t.notificationEmail ?? "",
    });
  }, [tenant]);

  function saveOrg() {
    updateTenant.mutate(
      { data: orgForm as any },
      {
        onSuccess: () => {
          setOrgSaved(true);
          setTimeout(() => setOrgSaved(false), 3000);
          qc.invalidateQueries({ queryKey: getGetMyTenantQueryKey() });
          toast({ title: "Organisation details saved" });
        },
        onError: () => toast({ title: "Failed to save", variant: "destructive" }),
      }
    );
  }

  function saveNotifications() {
    updateTenant.mutate(
      { data: notifForm as any },
      {
        onSuccess: () => {
          setNotifSaved(true);
          setTimeout(() => setNotifSaved(false), 3000);
          qc.invalidateQueries({ queryKey: getGetMyTenantQueryKey() });
          toast({ title: "Notification preferences saved" });
        },
        onError: () => toast({ title: "Failed to save", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your workspace, team, and notification preferences.</p>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button variant="outline" className="justify-between h-auto py-4 px-5" asChild>
          <Link href="/compliance-types">
            <div className="flex items-center gap-3">
              <ClipboardCheck className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="text-left">
                <div className="font-medium">Compliance Types</div>
                <div className="text-xs text-muted-foreground font-normal">Manage the 29 inspection types</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Button>
        <Button variant="outline" className="justify-between h-auto py-4 px-5" asChild>
          <Link href="/users">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="text-left">
                <div className="font-medium">Users</div>
                <div className="text-xs text-muted-foreground font-normal">Manage users and roles</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Button>
        <Button variant="outline" className="justify-between h-auto py-4 px-5" asChild>
          <Link href="/teams">
            <div className="flex items-center gap-3">
              <UserCog className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="text-left">
                <div className="font-medium">Teams</div>
                <div className="text-xs text-muted-foreground font-normal">Manage work teams and assignments</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Button>
        <Button variant="outline" className="justify-between h-auto py-4 px-5" asChild>
          <Link href="/imports">
            <div className="flex items-center gap-3">
              <Upload className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="text-left">
                <div className="font-medium">Import Assets</div>
                <div className="text-xs text-muted-foreground font-normal">Upload spreadsheet / download template</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Button>
      </div>

      <Separator />

      {/* Organisation Details */}
      <Card>
        <CardHeader>
          <CardTitle>Organisation Details</CardTitle>
          <CardDescription>Basic information about this council workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="org-name">Organisation Name</Label>
                <Input id="org-name" value={orgForm.name} onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Thurrock Council" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-name">Primary Contact Name</Label>
                <Input id="contact-name" value={orgForm.contactName} onChange={e => setOrgForm(f => ({ ...f, contactName: e.target.value }))} placeholder="Full name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-email">Primary Contact Email</Label>
                <Input id="contact-email" type="email" value={orgForm.contactEmail} onChange={e => setOrgForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="compliance@council.gov.uk" />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={saveOrg} disabled={updateTenant.isPending}>
                  {updateTenant.isPending ? "Saving…" : "Save Changes"}
                </Button>
                {orgSaved && (
                  <span className="flex items-center gap-1.5 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Email Notifications</CardTitle>
          </div>
          <CardDescription>
            Control whether the nightly compliance check sends email alerts for overdue and due-soon items.
            Emails go to all active tenant admins and compliance managers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium text-sm">Enable nightly compliance alerts</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Send daily emails when items become overdue or due soon
                  </p>
                </div>
                <Switch
                  checked={notifForm.notificationsEnabled}
                  onCheckedChange={v => setNotifForm(f => ({ ...f, notificationsEnabled: v }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notif-email">Additional notification email <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="notif-email"
                  type="email"
                  value={notifForm.notificationEmail}
                  onChange={e => setNotifForm(f => ({ ...f, notificationEmail: e.target.value }))}
                  placeholder="e.g. compliance-alerts@council.gov.uk"
                  disabled={!notifForm.notificationsEnabled}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to send only to active admin and compliance manager accounts.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={saveNotifications} disabled={updateTenant.isPending}>
                  {updateTenant.isPending ? "Saving…" : "Save Preferences"}
                </Button>
                {notifSaved && (
                  <span className="flex items-center gap-1.5 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> Saved
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Plan & Limits */}
      <Card>
        <CardHeader>
          <CardTitle>Plan & Limits</CardTitle>
          <CardDescription>Current subscription and usage limits for this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold">{(tenant as any)?.maxAssets ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Max Assets</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold">{(tenant as any)?.maxUsers ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Max Users</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <Badge variant={(tenant as any)?.status === "active" ? "default" : "secondary"} className="capitalize">
                  {(tenant as any)?.status ?? "—"}
                </Badge>
                <div className="text-xs text-muted-foreground mt-1">Status</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
