import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, UserPlus } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  tenant_admin: "Tenant Admin",
  compliance_manager: "Compliance Manager",
  team_member: "Team Member",
  auditor: "Auditor (read-only)",
};

const EMPTY = {
  username: "", email: "", firstName: "", lastName: "",
  password: "", confirmPassword: "", role: "team_member",
  jobTitle: "", department: "", phoneNumber: "",
};

export default function UserNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createUser = useCreateUser();
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState("");

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.username.trim() || !form.email.trim() || !form.password.trim()) {
      setError("Username, email, and password are required.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    const payload: Record<string, any> = {
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
    };
    if (form.firstName.trim()) payload.firstName = form.firstName.trim();
    if (form.lastName.trim()) payload.lastName = form.lastName.trim();
    if (form.jobTitle.trim()) payload.jobTitle = form.jobTitle.trim();
    if (form.department.trim()) payload.department = form.department.trim();
    if (form.phoneNumber.trim()) payload.phoneNumber = form.phoneNumber.trim();

    createUser.mutate(
      { data: payload as any },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
          toast({ title: "User created successfully" });
          navigate("/users");
        },
        onError: (err: any) => setError(err?.message ?? "Failed to create user."),
      }
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/users"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UserPlus className="h-7 w-7" /> Add User
          </h1>
          <p className="text-muted-foreground mt-1">Create a new user account for this tenant.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Personal Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input placeholder="Jane" value={form.firstName} onChange={set("firstName")} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input placeholder="Smith" value={form.lastName} onChange={set("lastName")} />
            </div>
            <div className="space-y-1.5">
              <Label>Job Title</Label>
              <Input placeholder="Compliance Officer" value={form.jobTitle} onChange={set("jobTitle")} />
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input placeholder="Housing & Properties" value={form.department} onChange={set("department")} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input type="tel" placeholder="01375 652652" value={form.phoneNumber} onChange={set("phoneNumber")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account Credentials</CardTitle>
            <CardDescription>Login credentials for this user.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Username <span className="text-destructive">*</span></Label>
              <Input placeholder="jane.smith" value={form.username} onChange={set("username")} />
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" placeholder="jane.smith@thurrock.gov.uk" value={form.email} onChange={set("email")} />
            </div>
            <div className="space-y-1.5">
              <Label>Password <span className="text-destructive">*</span></Label>
              <Input type="password" placeholder="Minimum 8 characters" value={form.password} onChange={set("password")} />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm Password</Label>
              <Input type="password" placeholder="Repeat password" value={form.confirmPassword} onChange={set("confirmPassword")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role &amp; Permissions</CardTitle>
            <CardDescription>Controls what this user can see and do.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <label key={value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${form.role === value ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                  <input
                    type="radio"
                    name="role"
                    value={value}
                    checked={form.role === value}
                    onChange={() => setForm(f => ({ ...f, role: value }))}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="font-medium text-sm">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {value === "tenant_admin" && "Full admin access — manages users, settings, and all data."}
                      {value === "compliance_manager" && "Can manage compliance types, assign jobs, and update records."}
                      {value === "team_member" && "Can view assets and update compliance records assigned to them."}
                      {value === "auditor" && "Read-only access to all compliance data and reports."}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
        )}

        <div className="flex items-center gap-3 pb-8">
          <Button type="submit" disabled={createUser.isPending}>
            {createUser.isPending ? "Creating…" : "Create User"}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/users">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
