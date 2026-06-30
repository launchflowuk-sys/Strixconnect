import { useState } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { 
  useGetDashboardSummary, 
  getGetDashboardSummaryQueryKey,
  useGetComplianceStatusBreakdown,
  getGetComplianceStatusBreakdownQueryKey,
  useGetOverdueItems,
  getGetOverdueItemsQueryKey,
  useGetAssetsByType,
  getGetAssetsByTypeQueryKey,
  useGetDueSoonItems,
  getGetDueSoonItemsQueryKey,
  useGetMyJobs,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Clock, ShieldAlert, FileWarning, ArrowRight, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

export default function DashboardPage() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: breakdown, isLoading: isLoadingBreakdown } = useGetComplianceStatusBreakdown();
  const { data: overdueItems, isLoading: isLoadingOverdue } = useGetOverdueItems();
  const { data: dueSoonItems, isLoading: isLoadingDueSoon } = useGetDueSoonItems();
  const { data: assetsByType, isLoading: isLoadingAssets } = useGetAssetsByType();
  const { data: myJobs, isLoading: isLoadingMyJobs } = useGetMyJobs();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of compliance and asset status across your portfolio.</p>
        </div>
        <Button asChild>
          <Link href="/assets" data-testid="btn-view-all-assets">View All Assets</Link>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Total Assets</CardTitle>
            <BuildingIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-[100px]" /> : (
              <div className="text-2xl font-bold">{summary?.totalAssets.toLocaleString() ?? 0}</div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Compliant</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-[100px]" /> : (
              <div className="text-2xl font-bold text-success">{summary?.compliant.toLocaleString() ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Active compliance items
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Due Soon</CardTitle>
            <Clock className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-[100px]" /> : (
              <div className="text-2xl font-bold text-warning">{summary?.dueSoon.toLocaleString() ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Items expiring in 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Overdue</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? <Skeleton className="h-8 w-[100px]" /> : (
              <div className="text-2xl font-bold text-destructive">{summary?.overdue.toLocaleString() ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Items past expiry date
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        
        {/* Compliance Breakdown Chart */}
        <Card className="col-span-1 lg:col-span-4">
          <CardHeader>
            <CardTitle>Compliance by Type</CardTitle>
            <CardDescription>Status breakdown across all compliance modules</CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            {isLoadingBreakdown ? (
              <Skeleton className="h-[300px] w-full" />
            ) : breakdown && breakdown.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdown} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="complianceTypeName" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <RechartsTooltip 
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                    />
                    <Bar dataKey="compliant" name="Compliant" stackId="a" fill="hsl(var(--success))" radius={[0, 0, 4, 4]} />
                    <Bar dataKey="dueSoon" name="Due Soon" stackId="a" fill="hsl(var(--warning))" />
                    <Bar dataKey="overdue" name="Overdue" stackId="a" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center border border-dashed rounded-md text-muted-foreground">
                No compliance data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assets by Type */}
        <Card className="col-span-1 lg:col-span-3">
          <CardHeader>
            <CardTitle>Assets by Type</CardTitle>
            <CardDescription>Distribution of properties</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingAssets ? (
              <Skeleton className="h-[300px] w-full" />
            ) : assetsByType && assetsByType.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={assetsByType}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="assetType"
                    >
                      {assetsByType.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(var(--primary))`} fillOpacity={1 - (index * 0.15)} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} 
                      formatter={(value: number, name: string) => [value, name.replace('_', ' ')]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center border border-dashed rounded-md text-muted-foreground">
                No asset data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Overdue Items Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                Critical Overdue Items
              </CardTitle>
              <CardDescription>Compliance items past their expiry date</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/compliance?status=overdue">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoadingOverdue ? (
              <div className="space-y-2">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : overdueItems && overdueItems.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Overdue By</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueItems.slice(0, 5).map(item => (
                    <TableRow key={item.itemId}>
                      <TableCell className="font-medium">
                        <Link href={`/assets/${item.assetId}`} className="hover:underline text-primary">
                          {item.assetReference}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.complianceTypeName}</Badge>
                      </TableCell>
                      <TableCell className="text-destructive font-medium">
                        {item.daysOverdue} days
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/assets/${item.assetId}`}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-8 text-center border border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 text-success mb-2 opacity-50" />
                <p>No overdue items!</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Due Soon Items Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-warning" />
                Expiring Soon
              </CardTitle>
              <CardDescription>Items requiring attention in next 30 days</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/compliance?status=due_soon">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoadingDueSoon ? (
              <div className="space-y-2">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : dueSoonItems && dueSoonItems.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Due In</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dueSoonItems.slice(0, 5).map(item => (
                    <TableRow key={item.itemId}>
                      <TableCell className="font-medium">
                        <Link href={`/assets/${item.assetId}`} className="hover:underline text-primary">
                          {item.assetReference}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.complianceTypeName}</Badge>
                      </TableCell>
                      <TableCell className="text-warning font-medium">
                        {item.daysUntilDue} days
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/assets/${item.assetId}`}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-8 text-center border border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground">
                <p>No items expiring soon</p>
              </div>
            )}
          </CardContent>
        </Card>

      {/* My Jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary" />
              My Jobs
            </CardTitle>
            <CardDescription>Work items assigned to you</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/jobs">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingMyJobs ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : myJobs && myJobs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myJobs.slice(0, 5).map((job: any) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">
                      <Link href={`/jobs/${job.id}`} className="hover:underline text-primary">
                        {job.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={job.priority === "urgent" ? "destructive" : job.priority === "high" ? "secondary" : "outline"}>
                        {job.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={job.status === "open" ? "outline" : job.status === "in_progress" ? "secondary" : "default"}>
                        {job.status?.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {job.dueDate ? format(parseISO(job.dueDate), "dd MMM") : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/jobs/${job.id}`}><ArrowRight className="h-4 w-4" /></Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center border border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground">
              <Briefcase className="h-8 w-8 mb-2 opacity-40" />
              <p>No jobs assigned to you</p>
            </div>
          )}
        </CardContent>
      </Card>

      </div>
    </div>
  );
}

function BuildingIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  );
}