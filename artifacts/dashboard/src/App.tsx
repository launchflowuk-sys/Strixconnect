import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message ?? "Unknown error" };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", height: "100vh", width: "100vw", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px", fontFamily: "sans-serif" }}>
          <p style={{ fontWeight: 600, color: "#dc2626" }}>Something went wrong</p>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", maxWidth: 400, textAlign: "center" }}>{this.state.message}</p>
          <button
            style={{ marginTop: 8, padding: "6px 16px", borderRadius: 6, border: "1px solid #d1d5db", cursor: "pointer" }}
            onClick={() => { this.setState({ hasError: false, message: "" }); window.location.href = "/"; }}
          >
            Return to dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Pages
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";

import AssetsPage from "@/pages/assets/index";
import AssetDetailPage from "@/pages/assets/[id]";
import AssetNewPage from "@/pages/assets/new";
import AssetEditPage from "@/pages/assets/edit";

import CompliancePage from "@/pages/compliance/index";
import ComplianceBulkAssignPage from "@/pages/compliance/bulk-assign";
import ComplianceTypeDashboard from "@/pages/compliance/[typeId]";
import ComplianceItemDetailPage from "@/pages/compliance-items/[itemId]";
import ComplianceRecordPage from "@/pages/compliance-items/record";
import ComplianceTypesPage from "@/pages/compliance-types/index";
import ComplianceTypeFormPage from "@/pages/compliance-types/form";

import UsersPage from "@/pages/users/index";
import UserNewPage from "@/pages/users/new";

import TeamsPage from "@/pages/teams/index";
import TeamNewPage from "@/pages/teams/new";
import TeamDetailPage from "@/pages/teams/[id]";

import ImportsPage from "@/pages/imports/index";
import ComplianceImportsPage from "@/pages/compliance-imports/index";

import TenantsPage from "@/pages/tenants/index";
import TenantNewPage from "@/pages/tenants/new";
import TenantDetailPage from "@/pages/tenants/[id]";

import AuditLogsPage from "@/pages/audit-logs/index";
import SettingsPage from "@/pages/settings/index";

import JobsPage from "@/pages/jobs/index";
import JobNewPage from "@/pages/jobs/new";
import JobDetailPage from "@/pages/jobs/[id]";

import ServiceRecordsPage from "@/pages/service-records/index";
import ServiceRecordUploadPage from "@/pages/service-records/upload";
import ServiceRecordDetailPage from "@/pages/service-records/[id]";

import ReportsPage from "@/pages/reports/index";
import DocumentsPage from "@/pages/documents/index";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component }: { component: any }) {
  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />

      <Route path="/" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />

      {/* Assets — /new before /:id so "new" isn't matched as an id */}
      <Route path="/assets/new" component={() => <ProtectedRoute component={AssetNewPage} />} />
      <Route path="/assets/:id/edit" component={() => <ProtectedRoute component={AssetEditPage} />} />
      <Route path="/assets/:id" component={() => <ProtectedRoute component={AssetDetailPage} />} />
      <Route path="/assets" component={() => <ProtectedRoute component={AssetsPage} />} />

      {/* Compliance */}
      <Route path="/compliance/bulk-assign" component={() => <ProtectedRoute component={ComplianceBulkAssignPage} />} />
      <Route path="/compliance/:typeId" component={() => <ProtectedRoute component={ComplianceTypeDashboard} />} />
      <Route path="/compliance" component={() => <ProtectedRoute component={CompliancePage} />} />
      <Route path="/compliance-items/:itemId/record" component={() => <ProtectedRoute component={ComplianceRecordPage} />} />
      <Route path="/compliance-items/:itemId" component={() => <ProtectedRoute component={ComplianceItemDetailPage} />} />

      {/* Compliance Types — /new and /:id/edit before list */}
      <Route path="/compliance-types/new" component={() => <ProtectedRoute component={ComplianceTypeFormPage} />} />
      <Route path="/compliance-types/:id/edit" component={() => <ProtectedRoute component={ComplianceTypeFormPage} />} />
      <Route path="/compliance-types" component={() => <ProtectedRoute component={ComplianceTypesPage} />} />

      {/* Jobs — /new before /:id */}
      <Route path="/jobs/new" component={() => <ProtectedRoute component={JobNewPage} />} />
      <Route path="/jobs/:id" component={() => <ProtectedRoute component={JobDetailPage} />} />
      <Route path="/jobs" component={() => <ProtectedRoute component={JobsPage} />} />

      {/* Service Records */}
      <Route path="/service-records/upload" component={() => <ProtectedRoute component={ServiceRecordUploadPage} />} />
      <Route path="/service-records/:id" component={() => <ProtectedRoute component={ServiceRecordDetailPage} />} />
      <Route path="/service-records" component={() => <ProtectedRoute component={ServiceRecordsPage} />} />

      {/* Users — /new before list */}
      <Route path="/users/new" component={() => <ProtectedRoute component={UserNewPage} />} />
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} />} />

      {/* Teams — /new before /:id */}
      <Route path="/teams/new" component={() => <ProtectedRoute component={TeamNewPage} />} />
      <Route path="/teams/:id" component={() => <ProtectedRoute component={TeamDetailPage} />} />
      <Route path="/teams" component={() => <ProtectedRoute component={TeamsPage} />} />

      {/* Tenants — /new before /:id */}
      <Route path="/tenants/new" component={() => <ProtectedRoute component={TenantNewPage} />} />
      <Route path="/tenants/:id" component={() => <ProtectedRoute component={TenantDetailPage} />} />
      <Route path="/tenants" component={() => <ProtectedRoute component={TenantsPage} />} />

      <Route path="/documents" component={() => <ProtectedRoute component={DocumentsPage} />} />

      <Route path="/compliance-imports" component={() => <ProtectedRoute component={ComplianceImportsPage} />} />
      <Route path="/imports" component={() => <ProtectedRoute component={ImportsPage} />} />
      <Route path="/audit-logs" component={() => <ProtectedRoute component={AuditLogsPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route path="/reports" component={() => <ProtectedRoute component={ReportsPage} />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
