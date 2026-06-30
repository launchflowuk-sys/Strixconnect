import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { getToken, clearToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent, SidebarGroup, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, SidebarFooter, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LayoutDashboard, Building2, ClipboardCheck, Settings, Users, Building, FileText, LogOut, Upload, UserCog, Briefcase, ClipboardList, BarChart2, Files } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const token = getToken();

  useEffect(() => {
    if (!token) {
      setLocation("/login");
    }
  }, [token, setLocation]);

  const { data: user, isLoading, isError } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    }
  });

  const logout = useLogout();

  const handleLogout = () => {
    clearToken();
    logout.mutate(undefined, {
      onSettled: () => setLocation("/login")
    });
  };

  useEffect(() => {
    if (isError) {
      clearToken();
      setLocation("/login");
    }
  }, [isError, setLocation]);

  if (!token) {
    return null;
  }

  if (isLoading) {
    return <div className="flex h-screen w-screen items-center justify-center bg-background"><p>Loading...</p></div>;
  }

  if (!user) {
    return null;
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <Sidebar variant="sidebar" collapsible="icon">
          <SidebarHeader className="px-4 py-6">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
                C
              </div>
              <span className="font-semibold text-lg tracking-tight truncate">ComplianceOS</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Dashboard">
                    <Link href="/dashboard" data-testid="nav-dashboard">
                      <LayoutDashboard className="h-4 w-4" />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Assets">
                    <Link href="/assets" data-testid="nav-assets">
                      <Building2 className="h-4 w-4" />
                      <span>Assets</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Compliance">
                    <Link href="/compliance" data-testid="nav-compliance">
                      <ClipboardCheck className="h-4 w-4" />
                      <span>Compliance</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Jobs">
                    <Link href="/jobs" data-testid="nav-jobs">
                      <Briefcase className="h-4 w-4" />
                      <span>Jobs</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Service Records">
                    <Link href="/service-records" data-testid="nav-service-records">
                      <ClipboardList className="h-4 w-4" />
                      <span>Service Records</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Documents">
                    <Link href="/documents" data-testid="nav-documents">
                      <Files className="h-4 w-4" />
                      <span>Documents</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                
                {(user.role === 'super_admin' || user.role === 'tenant_admin') && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Compliance Types">
                      <Link href="/compliance-types" data-testid="nav-compliance-types">
                        <ClipboardCheck className="h-4 w-4" />
                        <span>Compliance Types</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                {(user.role === 'super_admin' || user.role === 'tenant_admin') && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Users">
                      <Link href="/users" data-testid="nav-users">
                        <Users className="h-4 w-4" />
                        <span>Users</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                {(user.role === 'super_admin' || user.role === 'tenant_admin') && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Teams">
                      <Link href="/teams" data-testid="nav-teams">
                        <UserCog className="h-4 w-4" />
                        <span>Teams</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                {(user.role === 'super_admin' || user.role === 'tenant_admin' || user.role === 'compliance_manager') && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Import Assets">
                      <Link href="/imports" data-testid="nav-imports">
                        <Upload className="h-4 w-4" />
                        <span>Import Assets</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                {user.role === 'super_admin' && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Tenants">
                      <Link href="/tenants" data-testid="nav-tenants">
                        <Building className="h-4 w-4" />
                        <span>Tenants</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                {(user.role === 'super_admin' || user.role === 'tenant_admin' || user.role === 'compliance_manager' || user.role === 'auditor') && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Reports">
                      <Link href="/reports" data-testid="nav-reports">
                        <BarChart2 className="h-4 w-4" />
                        <span>Reports</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Audit Logs">
                    <Link href="/audit-logs" data-testid="nav-audit-logs">
                      <FileText className="h-4 w-4" />
                      <span>Audit Logs</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Settings">
                    <Link href="/settings" data-testid="nav-settings">
                      <Settings className="h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t border-sidebar-border p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium truncate">{user.firstName} {user.lastName}</span>
                <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                <span className="text-xs font-mono mt-1 text-sidebar-primary truncate capitalize">{user.role.replace('_', ' ')}</span>
              </div>
              <Button variant="outline" size="sm" className="w-full justify-start text-sidebar-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={handleLogout} data-testid="btn-logout">
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>
        
        <main className="flex-1 overflow-auto bg-background flex flex-col">
          <header className="h-14 border-b border-border px-4 flex items-center shrink-0">
            <SidebarTrigger />
          </header>
          <div className="p-6 md:p-8 flex-1 w-full max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
