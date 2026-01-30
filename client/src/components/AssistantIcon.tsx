import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AssistantIconProps {
  className?: string;
}

export function AssistantIcon({ className }: AssistantIconProps) {
  return (
    <div className={cn("fixed bottom-4 right-4 z-50", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="w-10 h-10 rounded-full bg-muted/80 backdrop-blur-sm border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Asistente"
            data-testid="button-assistant"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs">
          <p className="text-sm">Pasa el cursor sobre los íconos ⓘ para ver información sobre cada campo.</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
