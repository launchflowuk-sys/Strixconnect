import { useState } from "react";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const { data: auditList, isLoading } = useListAuditLogs({ page, limit: 50 });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Audit Logs</h1>
        <p className="text-muted-foreground mt-1">System-wide trail of actions and changes.</p>
      </div>

      <Card>
        <div className="rounded-md border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    <Skeleton className="h-8 w-[200px] mx-auto" />
                  </TableCell>
                </TableRow>
              ) : auditList?.data && auditList.data.length > 0 ? (
                auditList.data.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm font-mono">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">
                      {log.actorName || "System"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase font-mono text-xs tracking-wider">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground capitalize">{log.entityType}</span>
                      {log.entityId && (
                        <span className="text-xs font-mono ml-2 text-zinc-400">({log.entityId.substring(0, 8)}…)</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">No audit logs found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {auditList && auditList.total > auditList.limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-muted-foreground">
              Page {page} of {Math.ceil(auditList.total / auditList.limit)}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * auditList.limit >= auditList.total}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
