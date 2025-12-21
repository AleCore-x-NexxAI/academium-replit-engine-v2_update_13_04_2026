import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Bug, 
  ArrowLeft, 
  Lock, 
  Eye, 
  CheckCircle, 
  XCircle, 
  Clock, 
  User,
  Globe,
  Monitor,
  Image,
  ExternalLink,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { BugReport, User as UserType } from "@shared/schema";

type BugReportWithUser = BugReport & { user?: UserType };

const STATUS_COLORS = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  reviewed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  dismissed: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
};

const STATUS_ICONS = {
  new: Clock,
  reviewed: Eye,
  resolved: CheckCircle,
  dismissed: XCircle,
};

export default function BugReports() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [selectedReport, setSelectedReport] = useState<BugReportWithUser | null>(null);
  const [authError, setAuthError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const authenticateMutation = useMutation({
    mutationFn: async (pwd: string) => {
      const response = await fetch("/api/bug-reports/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (!response.ok) {
        throw new Error("Invalid password");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setAuthenticated(true);
      setAuthToken(data.token);
      setAuthError("");
    },
    onError: () => {
      setAuthError("Incorrect password. Please try again.");
    },
  });

  const { data: reports, isLoading } = useQuery<BugReportWithUser[]>({
    queryKey: ["/api/bug-reports", authToken],
    queryFn: async () => {
      const response = await fetch("/api/bug-reports", {
        headers: { "X-Bug-Reports-Token": authToken },
      });
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    enabled: authenticated && !!authToken,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await fetch(`/api/bug-reports/${id}/status`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json",
          "X-Bug-Reports-Token": authToken,
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bug-reports", authToken] });
      toast({ title: "Status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    authenticateMutation.mutate(password);
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "Unknown";
    return new Date(date).toLocaleString();
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Bug Reports Access</CardTitle>
            <CardDescription>
              Enter the admin password to view bug reports
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  data-testid="input-bug-reports-password"
                />
                {authError && (
                  <p className="text-sm text-destructive">{authError}</p>
                )}
              </div>
              <Button 
                type="submit" 
                className="w-full"
                disabled={authenticateMutation.isPending}
                data-testid="button-bug-reports-login"
              >
                {authenticateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Access Reports
              </Button>
            </form>
            <div className="mt-4 text-center">
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <Bug className="h-6 w-6" />
                <h1 className="text-xl font-semibold">Bug Reports</h1>
              </div>
            </div>
            <Badge variant="outline" className="gap-1">
              {reports?.length || 0} reports
            </Badge>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : reports?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Bug className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No bug reports yet</h3>
              <p className="text-muted-foreground">
                When users submit bug reports, they'll appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {reports?.map((report) => {
              const StatusIcon = STATUS_ICONS[report.status];
              return (
                <Card 
                  key={report.id} 
                  className="hover-elevate cursor-pointer transition-colors"
                  onClick={() => setSelectedReport(report)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={STATUS_COLORS[report.status]}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {report.status}
                          </Badge>
                          {report.screenshot && (
                            <Badge variant="outline">
                              <Image className="h-3 w-3 mr-1" />
                              Has screenshot
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-medium mb-1 truncate">{report.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {report.description}
                        </p>
                        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {report.user?.firstName} {report.user?.lastName || "Anonymous"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(report.createdAt)}
                          </span>
                        </div>
                      </div>
                      <Select
                        value={report.status}
                        onValueChange={(value) => {
                          updateStatusMutation.mutate({ id: report.id, status: value });
                        }}
                      >
                        <SelectTrigger 
                          className="w-32" 
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">New</SelectItem>
                          <SelectItem value="reviewed">Reviewed</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                          <SelectItem value="dismissed">Dismissed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <Dialog open={!!selectedReport} onOpenChange={() => setSelectedReport(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedReport && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Bug className="h-5 w-5" />
                  {selectedReport.title}
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4 mt-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={STATUS_COLORS[selectedReport.status]}>
                    {selectedReport.status}
                  </Badge>
                  <Select
                    value={selectedReport.status}
                    onValueChange={(value) => {
                      updateStatusMutation.mutate({ id: selectedReport.id, status: value });
                      setSelectedReport({ ...selectedReport, status: value as BugReport['status'] });
                    }}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="reviewed">Reviewed</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="dismissed">Dismissed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Description</Label>
                  <p className="text-sm whitespace-pre-wrap bg-muted p-3 rounded-md">
                    {selectedReport.description}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3" /> Reported by
                    </Label>
                    <p className="text-sm">
                      {selectedReport.user?.firstName} {selectedReport.user?.lastName}
                      {selectedReport.user?.email && (
                        <span className="text-muted-foreground block">
                          {selectedReport.user.email}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Submitted
                    </Label>
                    <p className="text-sm">{formatDate(selectedReport.createdAt)}</p>
                  </div>
                </div>

                {selectedReport.pageUrl && (
                  <div className="space-y-1">
                    <Label className="text-muted-foreground flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Page URL
                    </Label>
                    <a 
                      href={selectedReport.pageUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      {selectedReport.pageUrl}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {selectedReport.browserInfo && (
                  <div className="space-y-1">
                    <Label className="text-muted-foreground flex items-center gap-1">
                      <Monitor className="h-3 w-3" /> Browser Info
                    </Label>
                    <p className="text-xs text-muted-foreground bg-muted p-2 rounded font-mono break-all">
                      {selectedReport.browserInfo}
                    </p>
                  </div>
                )}

                {selectedReport.screenshot && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground flex items-center gap-1">
                      <Image className="h-3 w-3" /> Screenshot
                    </Label>
                    <div className="border rounded-md overflow-hidden">
                      <img 
                        src={selectedReport.screenshot} 
                        alt="Bug report screenshot" 
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
