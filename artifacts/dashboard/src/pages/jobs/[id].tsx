import { useState, useRef } from "react";
import { useParams, Link } from "wouter";
import { useGetJob, useCompleteJob, useCancelJob, useAddJobComment, useUpdateJob } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { format } from "date-fns";
import {
  ArrowLeft, Briefcase, AlertCircle, CheckCircle2, XCircle,
  Clock, Paperclip, MessageSquare, Plus, Download, Trash2,
  ChevronRight, User, Calendar,
} from "lucide-react";

const PRIORITY_COLOR: Record<string, string> = {
  critical: "destructive", high: "destructive", medium: "secondary", low: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open", assigned: "Assigned", in_progress: "In Progress",
  awaiting_evidence: "Awaiting Evidence", completed: "Completed", cancelled: "Cancelled",
};

function PriorityBadge({ priority }: { priority: string }) {
  return <Badge variant={PRIORITY_COLOR[priority] as any} className="capitalize">{priority}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className="capitalize">{STATUS_LABEL[status] || status}</Badge>;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [spawningFollowOn, setSpawningFollowOn] = useState(false);
  const [followOnForm, setFollowOnForm] = useState({ title: "", priority: "medium", dueDate: "" });
  const [editingStatus, setEditingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: job, isLoading } = useGetJob(id!);
  const completeJob = useCompleteJob();
  const cancelJob = useCancelJob();
  const addComment = useAddJobComment();
  const updateJob = useUpdateJob();

  function invalidate() { qc.invalidateQueries({ queryKey: ["getJob", id] }); }

  async function handleComplete() {
    try {
      await completeJob.mutateAsync({ jobId: id!, data: { notes: completionNotes } });
      toast({ title: "Job completed" });
      setCompleting(false);
      invalidate();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  async function handleCancel() {
    if (!confirm("Cancel this job?")) return;
    try {
      await cancelJob.mutateAsync({ jobId: id! });
      toast({ title: "Job cancelled" });
      invalidate();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  async function handleComment() {
    if (!comment.trim()) return;
    try {
      await addComment.mutateAsync({ jobId: id!, data: { body: comment.trim() } });
      setComment("");
      invalidate();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  async function handleStatusUpdate() {
    try {
      await updateJob.mutateAsync({ jobId: id!, data: { status: newStatus } });
      toast({ title: "Status updated" });
      setEditingStatus(false);
      invalidate();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  async function handleFollowOn() {
    if (!followOnForm.title.trim()) return;
    try {
      await apiClient.post(`/jobs/${id}/follow-on`, followOnForm);
      toast({ title: "Follow-on job created" });
      setSpawningFollowOn(false);
      invalidate();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  async function handleUpload(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`/api/documents/upload?jobId=${id}`, {
        method: "POST",
        headers: {
          "x-filename": encodeURIComponent(file.name),
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: buf,
      });
      if (!res.ok) throw new Error();
      toast({ title: "Document uploaded" });
      invalidate();
    } catch { toast({ title: "Upload failed", variant: "destructive" }); }
  }

  async function handleDeleteDoc(docId: string) {
    try {
      await apiClient.delete(`/documents/${docId}`);
      toast({ title: "Document removed" });
      invalidate();
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!job) return <div className="p-6">Job not found.</div>;

  const isClosed = job.status === "completed" || job.status === "cancelled";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" asChild>
        <Link href="/jobs"><ArrowLeft className="h-4 w-4 mr-1" /> All Jobs</Link>
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <PriorityBadge priority={job.priority} />
            <StatusBadge status={job.status} />
            {job.asset && (
              <Link href={`/assets/${job.assetId}`} className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                {String((job.asset as any).assetReference || (job.asset as any).fullAddress || "Asset")}
              </Link>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!isClosed && (
            <>
              <Button variant="outline" size="sm" onClick={() => { setNewStatus(job.status); setEditingStatus(true); }}>
                Update Status
              </Button>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                <XCircle className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" onClick={() => setCompleting(true)}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Complete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Assigned to</p>
          <p className="font-medium flex items-center gap-1">
            <User className="h-3 w-3" />
            {(job.assignee as any)?.firstName ? `${(job.assignee as any).firstName} ${(job.assignee as any).lastName || ""}`.trim() : (String((job.assignee as any)?.username || "") || "Unassigned")}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Due Date</p>
          <p className="font-medium flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {job.dueDate ? format(new Date(job.dueDate), "dd MMM yyyy") : "—"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Created</p>
          <p className="font-medium">{format(new Date(job.createdAt), "dd MMM yyyy")}</p>
        </div>
        {job.completionDate && (
          <div>
            <p className="text-muted-foreground">Completed</p>
            <p className="font-medium">{format(new Date(job.completionDate), "dd MMM yyyy")}</p>
          </div>
        )}
      </div>

      {job.description && (
        <div className="bg-muted/40 rounded-lg p-4 text-sm whitespace-pre-wrap">{job.description}</div>
      )}
      {job.completionNotes && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-green-800 mb-1">Completion Notes</p>
          <p className="text-green-700">{job.completionNotes}</p>
        </div>
      )}

      <Separator />

      {/* Evidence / Documents */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><Paperclip className="h-4 w-4" /> Evidence & Documents</h2>
          {!isClosed && (
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Plus className="h-4 w-4 mr-1" /> Upload
            </Button>
          )}
          <input ref={fileInput} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.csv,.doc,.docx" onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ""; }} />
        </div>
        {job.documents?.length === 0 && <p className="text-sm text-muted-foreground">No documents attached.</p>}
        <div className="space-y-2">
          {job.documents?.map((doc: any) => (
            <div key={doc.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
              <span className="font-medium truncate max-w-xs">{doc.fileName}</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" asChild>
                  <a href={`/api/documents/${doc.id}/download?inline=true`} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
                {!isClosed && (
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteDoc(doc.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Follow-on jobs */}
      {((job.followOnJobs?.length ?? 0) > 0 || !isClosed) && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Follow-on Jobs</h2>
            {!isClosed && (
              <Button variant="outline" size="sm" onClick={() => setSpawningFollowOn(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Follow-on
              </Button>
            )}
          </div>
          {job.followOnJobs?.length === 0 && <p className="text-sm text-muted-foreground">No follow-on jobs.</p>}
          <div className="space-y-2">
            {job.followOnJobs?.map((fj: any) => (
              <Link key={fj.id} href={`/jobs/${fj.id}`} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm hover:bg-muted/40">
                <span className="font-medium">{fj.title}</span>
                <StatusBadge status={fj.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Comments */}
      <div>
        <h2 className="font-semibold flex items-center gap-2 mb-3"><MessageSquare className="h-4 w-4" /> Comments</h2>
        {job.comments?.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
        <div className="space-y-3 mb-4">
          {job.comments?.map((c: any) => (
            <div key={c.id} className="border rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <span className="font-medium text-foreground">{c.user?.displayName || c.user?.username}</span>
                <span>{format(new Date(c.createdAt), "dd MMM yyyy HH:mm")}</span>
              </div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
        </div>
        {!isClosed && (
          <div className="flex gap-2">
            <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Add a comment…" className="flex-1" />
            <Button size="sm" onClick={handleComment} disabled={!comment.trim()}>Post</Button>
          </div>
        )}
      </div>

      {/* Complete dialog */}
      <Dialog open={completing} onOpenChange={setCompleting}>
        <DialogContent>
          <DialogHeader><DialogTitle>Complete Job</DialogTitle></DialogHeader>
          <div>
            <Label>Completion Notes</Label>
            <Textarea value={completionNotes} onChange={e => setCompletionNotes(e.target.value)} rows={3} placeholder="Optional summary of work done…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleting(false)}>Cancel</Button>
            <Button onClick={handleComplete}>Mark Complete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status update dialog */}
      <Dialog open={editingStatus} onOpenChange={setEditingStatus}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Status</DialogTitle></DialogHeader>
          <Select value={newStatus} onValueChange={setNewStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["open","assigned","in_progress","awaiting_evidence"].map(s => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStatus(false)}>Cancel</Button>
            <Button onClick={handleStatusUpdate}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Follow-on dialog */}
      <Dialog open={spawningFollowOn} onOpenChange={setSpawningFollowOn}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Follow-on Job</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title *</Label>
              <Input value={followOnForm.title} onChange={e => setFollowOnForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={followOnForm.priority} onValueChange={v => setFollowOnForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={followOnForm.dueDate} onChange={e => setFollowOnForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpawningFollowOn(false)}>Cancel</Button>
            <Button onClick={handleFollowOn} disabled={!followOnForm.title.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
