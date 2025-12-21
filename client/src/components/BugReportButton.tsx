import { useState, useRef } from "react";
import { Bug, Send, Loader2, Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import html2canvas from "html2canvas";

export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const { toast } = useToast();

  const captureScreenshot = async () => {
    setCapturingScreenshot(true);
    try {
      // Temporarily hide the dialog to capture the page
      const dialogElement = document.querySelector('[role="dialog"]');
      if (dialogElement) {
        (dialogElement as HTMLElement).style.visibility = 'hidden';
      }
      
      // Small delay to ensure dialog is hidden
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        logging: false,
        scale: 0.5, // Reduce size to keep base64 manageable
      });
      
      // Show dialog again
      if (dialogElement) {
        (dialogElement as HTMLElement).style.visibility = 'visible';
      }
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      setScreenshot(dataUrl);
      toast({
        title: "Screenshot captured",
        description: "The current page has been captured.",
      });
    } catch (error) {
      console.error("Failed to capture screenshot:", error);
      toast({
        title: "Screenshot failed",
        description: "Could not capture screenshot, but you can still submit the report.",
        variant: "destructive",
      });
    } finally {
      setCapturingScreenshot(false);
    }
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bug-reports", {
        title,
        description,
        pageUrl: window.location.href,
        browserInfo: navigator.userAgent,
        screenshot,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Bug report submitted",
        description: "Thank you for your feedback! We'll look into this.",
      });
      setTitle("");
      setDescription("");
      setScreenshot(null);
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to submit",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.length < 3 || description.length < 10) {
      toast({
        title: "Please provide more details",
        description: "Title should be at least 3 characters and description at least 10 characters.",
        variant: "destructive",
      });
      return;
    }
    submitMutation.mutate();
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset state when closing
      setScreenshot(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
          data-testid="button-bug-report"
        >
          <Bug className="h-6 w-6" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Report a Bug
          </DialogTitle>
          <DialogDescription>
            Found an issue? Let us know and we'll fix it as soon as possible.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="bug-title">Title</Label>
            <Input
              id="bug-title"
              placeholder="Brief description of the issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-bug-title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bug-description">Description</Label>
            <Textarea
              id="bug-description"
              placeholder="Please describe what happened, what you expected, and any steps to reproduce..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              data-testid="input-bug-description"
            />
          </div>
          
          <div className="space-y-2">
            <Label>Screenshot (optional)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={captureScreenshot}
                disabled={capturingScreenshot}
                data-testid="button-capture-screenshot"
              >
                {capturingScreenshot ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : screenshot ? (
                  <Check className="h-4 w-4 mr-2 text-green-500" />
                ) : (
                  <Camera className="h-4 w-4 mr-2" />
                )}
                {screenshot ? "Screenshot captured" : "Capture screenshot"}
              </Button>
              {screenshot && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setScreenshot(null)}
                >
                  Remove
                </Button>
              )}
            </div>
            {screenshot && (
              <div className="mt-2 rounded-md overflow-hidden border">
                <img 
                  src={screenshot} 
                  alt="Screenshot preview" 
                  className="w-full max-h-32 object-cover object-top"
                />
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Current page and browser info will be included automatically.
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              data-testid="button-bug-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitMutation.isPending}
              data-testid="button-bug-submit"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Submit Report
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
