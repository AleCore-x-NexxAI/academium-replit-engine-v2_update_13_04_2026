import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Lightbulb, BookOpen, Loader2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

interface RubricCriterion {
  name: string;
  description: string;
  weight: number;
}

interface InputConsoleProps {
  onSubmit: (text: string) => void;
  mode: "guided" | "assessment";
  options?: string[];
  isProcessing: boolean;
  isGameOver: boolean;
  onViewResults?: () => void;
  rubric?: { criteria: RubricCriterion[] };
  currentFeedback?: {
    score: number;
    message: string;
    hint?: string;
  } | null;
  onRequestHint?: () => Promise<string>;
}

export function InputConsole({
  onSubmit,
  mode,
  options = [],
  isProcessing,
  isGameOver,
  onViewResults,
  rubric,
  currentFeedback,
  onRequestHint,
}: InputConsoleProps) {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHint, setIsLoadingHint] = useState(false);
  const [currentHint, setCurrentHint] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleRequestHint = async () => {
    if (!onRequestHint || isLoadingHint) return;
    setIsLoadingHint(true);
    try {
      const hint = await onRequestHint();
      setCurrentHint(hint);
    } catch (error) {
      console.error("Failed to get hint:", error);
    } finally {
      setIsLoadingHint(false);
    }
  };

  useEffect(() => {
    if (!isProcessing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isProcessing]);

  const handleSubmit = async () => {
    if (!input.trim() || isProcessing || isSubmitting || isGameOver) return;

    setIsSubmitting(true);
    try {
      await onSubmit(input.trim());
      setInput("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOptionClick = (option: string) => {
    if (!isProcessing && !isGameOver) {
      setInput(option);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isDisabled = isProcessing || isGameOver;

  return (
    <div className="border-t bg-background p-4">
      <AnimatePresence>
        {mode === "guided" && options.length > 0 && !isGameOver && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-4 h-4 text-chart-4" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Suggested Actions
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {options.map((option, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="cursor-pointer hover-elevate px-3 py-1.5 text-sm"
                  onClick={() => handleOptionClick(option)}
                  data-testid={`option-chip-${index}`}
                >
                  {option}
                </Badge>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isGameOver
                ? "Simulation has ended"
                : "What would you like to do?"
            }
            disabled={isDisabled}
            className="min-h-24 max-h-48 resize-none text-base"
            data-testid="input-decision"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={handleSubmit}
            disabled={!input.trim() || isDisabled}
            className="h-10"
            data-testid="button-submit-decision"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Submit
              </>
            )}
          </Button>

          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                data-testid="button-review-rubric"
              >
                <BookOpen className="w-3 h-3 mr-1" />
                Rubric
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Scoring Rubric</DialogTitle>
                <DialogDescription>
                  Your decisions will be evaluated on these criteria
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                {rubric?.criteria?.length ? (
                  rubric.criteria.map((criterion, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{criterion.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {criterion.weight}%
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {criterion.description}
                      </p>
                      <Progress value={criterion.weight} className="h-1" />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No rubric criteria available for this scenario.
                  </p>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleRequestHint}
                disabled={isLoadingHint || isGameOver}
                data-testid="button-get-hint"
              >
                {isLoadingHint ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Lightbulb className="w-3 h-3 mr-1" />
                )}
                Hint
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md" data-testid="dialog-hint-content">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2" data-testid="text-hint-title">
                  <Lightbulb className="w-5 h-5 text-chart-4" />
                  Guidance
                </DialogTitle>
                <DialogDescription>
                  Here's some guidance to help with your decision
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                {currentHint ? (
                  <p className="text-sm leading-relaxed" data-testid="text-current-hint">{currentHint}</p>
                ) : currentFeedback?.hint ? (
                  <div className="space-y-3">
                    <p className="text-sm leading-relaxed" data-testid="text-feedback-hint-dialog">{currentFeedback.hint}</p>
                    {currentFeedback.message && (
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <p className="text-xs font-medium mb-1">Previous Feedback:</p>
                        <p className="text-sm text-muted-foreground" data-testid="text-previous-feedback">{currentFeedback.message}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-default-hint">
                    Consider the stakeholders involved - employees, customers, investors, and the broader community. 
                    Think about both short-term gains and long-term consequences of your decisions.
                  </p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {currentFeedback && !isGameOver && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 p-3 bg-muted/30 rounded-lg border xl:hidden"
          data-testid="inline-feedback-panel"
        >
          <div className="flex items-start gap-2">
            <Lightbulb className="w-4 h-4 text-chart-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium mb-1" data-testid="text-feedback-label">Feedback</p>
              <p className="text-sm text-muted-foreground" data-testid="text-feedback-message">{currentFeedback.message}</p>
              {currentFeedback.hint && (
                <p className="text-xs text-muted-foreground italic mt-2" data-testid="text-feedback-hint">
                  Hint: {currentFeedback.hint}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {isGameOver && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 text-center space-y-3"
        >
          <p className="text-sm text-destructive">
            The simulation has ended.
          </p>
          {onViewResults && (
            <Button onClick={onViewResults} data-testid="button-view-results">
              <BarChart3 className="w-4 h-4 mr-2" />
              View Full Results
            </Button>
          )}
        </motion.div>
      )}
    </div>
  );
}
