import { useState } from "react";
import { Bug, Send, Loader2 } from "lucide-react";
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

async function captureScreenshot(): Promise<string | null> {
  console.log('[Screenshot] Starting capture...');
  try {
    const html2canvas = (await import("html2canvas")).default;
    console.log('[Screenshot] html2canvas loaded');
    
    // Hide dialogs/portals during capture
    const portals = document.querySelectorAll('[data-radix-portal]');
    portals.forEach(p => (p as HTMLElement).style.visibility = 'hidden');
    
    console.log('[Screenshot] Calling html2canvas with onclone...');
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: 0.4,
      backgroundColor: '#ffffff',
      width: window.innerWidth,
      height: window.innerHeight,
      ignoreElements: (element) => {
        return element.hasAttribute('data-radix-portal');
      },
      onclone: (clonedDoc) => {
        // Remove all style elements and links to avoid color() parsing
        clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => el.remove());
        
        // Add simple inline styles to preserve basic layout
        const style = clonedDoc.createElement('style');
        style.textContent = `
          * { 
            box-sizing: border-box; 
            font-family: system-ui, -apple-system, sans-serif;
            color: #1a1a1a !important;
            background-color: transparent !important;
            border-color: #e5e7eb !important;
          }
          body { 
            background-color: #f9fafb !important; 
            padding: 16px;
          }
          h1, h2, h3, h4 { 
            color: #111827 !important; 
            margin: 8px 0;
          }
          button, a { 
            background-color: #3b82f6 !important; 
            color: white !important; 
            padding: 8px 16px;
            border-radius: 6px;
            display: inline-block;
            margin: 4px;
          }
          input, textarea { 
            border: 1px solid #d1d5db !important; 
            padding: 8px;
            border-radius: 4px;
          }
          [class*="card"], [class*="Card"] {
            background-color: #ffffff !important;
            border: 1px solid #e5e7eb !important;
            border-radius: 8px;
            padding: 16px;
            margin: 8px;
          }
          nav, header {
            background-color: #ffffff !important;
            border-bottom: 1px solid #e5e7eb !important;
            padding: 12px;
          }
          [data-radix-portal] { display: none !important; }
        `;
        clonedDoc.head.appendChild(style);
      }
    });
    console.log('[Screenshot] Canvas created:', canvas.width, 'x', canvas.height);
    
    // Restore portals
    portals.forEach(p => (p as HTMLElement).style.visibility = '');
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    console.log('[Screenshot] DataURL created, length:', dataUrl.length);
    
    if (dataUrl.length < 100) {
      console.error('[Screenshot] DataURL too short, likely failed');
      return null;
    }
    
    return dataUrl;
  } catch (error) {
    console.error('[Screenshot] Capture failed with error:', error);
    return null;
  }
}

export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const submitMutation = useMutation({
    mutationFn: async (screenshotData: string | null) => {
      const response = await apiRequest("POST", "/api/bug-reports", {
        title,
        description,
        pageUrl: window.location.href,
        browserInfo: navigator.userAgent,
        screenshot: screenshotData,
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
      setOpen(false);
      setIsSubmitting(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to submit",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
      setIsSubmitting(false);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.length < 3 || description.length < 10) {
      toast({
        title: "Please provide more details",
        description: "Title should be at least 3 characters and description at least 10 characters.",
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    
    let screenshot: string | null = null;
    try {
      screenshot = await captureScreenshot();
    } catch (e) {
      console.warn('Screenshot failed, continuing without it:', e);
    }
    
    submitMutation.mutate(screenshot);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isSubmitting) {
      setOpen(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          className="!fixed !bottom-4 !right-4 h-12 w-12 rounded-full shadow-lg"
          style={{ zIndex: 9999 }}
          data-testid="button-bug-report"
        >
          <Bug className="h-5 w-5" />
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
              disabled={isSubmitting}
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
              disabled={isSubmitting}
              data-testid="input-bug-description"
            />
          </div>

          <div className="text-xs text-muted-foreground">
            A screenshot will be captured automatically along with page and browser info.
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
              data-testid="button-bug-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="button-bug-submit"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {isSubmitting ? "Submitting..." : "Submit Report"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
