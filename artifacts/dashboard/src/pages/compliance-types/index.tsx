import { Link } from "wouter";
import { useListComplianceTypes } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Download, Upload } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export default function ComplianceTypesPage() {
  const { data: complianceTypes, isLoading } = useListComplianceTypes();
  const { toast } = useToast();

  async function handleDownloadTemplate(typeId: string, typeName: string) {
    const token = getToken();
    try {
      const res = await fetch(`/api/compliance-imports/template/${typeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const blob = await res.blob();
      const safeName = typeName.replace(/[^a-z0-9]/gi, "_");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `compliance-template-${safeName}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Template downloaded", description: `${typeName} template saved.` });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Compliance Types</h1>
          <p className="text-muted-foreground mt-1">Manage compliance requirements and frequencies.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/compliance-imports">
              <Upload className="mr-2 h-4 w-4" />
              Import Records
            </Link>
          </Button>
          <Button asChild>
            <Link href="/compliance-types/new">
              <Plus className="mr-2 h-4 w-4" />
              Add Type
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <div className="rounded-md border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Frequency (Months)</TableHead>
                <TableHead>Due Soon (Days)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <Skeleton className="h-8 w-full max-w-[200px] mx-auto" />
                  </TableCell>
                </TableRow>
              ) : complianceTypes && complianceTypes.length > 0 ? (
                complianceTypes.map((type) => (
                  <TableRow key={type.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: type.color || '#ccc' }} />
                        {type.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">{type.code}</Badge>
                    </TableCell>
                    <TableCell>{type.frequencyMonths || 'N/A'}</TableCell>
                    <TableCell>{type.dueSoonDays}</TableCell>
                    <TableCell>
                      <Badge variant={type.isActive ? "default" : "secondary"}>
                        {type.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {type.isSystem ? (
                        <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">System</Badge>
                      ) : (
                        <Badge variant="outline">Custom</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-7"
                          onClick={() => handleDownloadTemplate(type.id, type.name)}
                          title="Download import template"
                        >
                          <Download className="h-3.5 w-3.5 mr-1" /> Template
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-7"
                          asChild
                          title="Import compliance records"
                        >
                          <Link href="/compliance-imports">
                            <Upload className="h-3.5 w-3.5 mr-1" /> Import
                          </Link>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/compliance-types/${type.id}/edit`}>Edit</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">No compliance types found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
