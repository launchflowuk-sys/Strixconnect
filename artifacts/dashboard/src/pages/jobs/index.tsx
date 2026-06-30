import { useState } from "react";
import { Link } from "wouter";
import { useListJobs } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Briefcase, AlertCircle, Clock, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";

const PRIORITY_COLOR: Record<string, string> = {
  critical: "destructive",
  high: "destructive",
  medium: "secondary",
  low: "outline",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  open: <AlertCircle className="h-3 w-3" />,
  assigned: <Clock className="h-3 w-3" />,
  in_progress: <Clock className="h-3 w-3 text-blue-500" />,
  awaiting_evidence: <Clock className="h-3 w-3 text-orange-500" />,
  completed: <CheckCircle2 className="h-3 w-3 text-green-600" />,
  cancelled: <XCircle className="h-3 w-3 text-muted-foreground" />,
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In Progress",
  awaiting_evidence: "Awaiting Evidence",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function JobsPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListJobs({
    page,
    limit: 25,
    ...(statusFilter && statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(priorityFilter && priorityFilter !== "all" ? { priority: priorityFilter } : {}),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="h-6 w-6" /> Jobs
          </h1>
          <p className="text-muted-foreground mt-1">Remedial works and follow-on actions</p>
        </div>
        <Button asChild>
          <Link href="/jobs/new">
            <Plus className="h-4 w-4 mr-2" /> New Job
          </Link>
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter || "all"} onValueChange={v => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="awaiting_evidence">Awaiting Evidence</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter || "all"} onValueChange={v => { setPriorityFilter(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell>
              </TableRow>
            )}
            {!isLoading && data?.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No jobs found</TableCell>
              </TableRow>
            )}
            {data?.data?.map((job: any) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium">
                  <Link href={`/jobs/${job.id}`} className="hover:underline">{job.title}</Link>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {job.asset ? (
                    <Link href={`/assets/${job.assetId}`} className="hover:underline">
                      {job.asset.assetReference || job.asset.fullAddress || job.assetId?.slice(0, 8)}
                    </Link>
                  ) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={PRIORITY_COLOR[job.priority] as any} className="capitalize text-xs">
                    {job.priority}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1 text-sm">
                    {STATUS_ICON[job.status]}
                    {STATUS_LABEL[job.status] || job.status}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {job.dueDate ? format(new Date(job.dueDate), "dd MMM yyyy") : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {job.assignee?.firstName ? `${job.assignee.firstName} ${job.assignee.lastName || ''}`.trim() : job.assignee?.username || "Unassigned"}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/jobs/${job.id}`}>View</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data && data.total > data.limit && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page}</span>
          <Button variant="outline" size="sm" disabled={page * data.limit >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
