import { useEffect } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  Save,
  Loader2,
  Building2,
  Users,
  Target,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Scenario } from "@shared/schema";

const scenarioFormSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  domain: z.string().min(1, "Please select a domain"),
  difficultyLevel: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
  role: z.string().min(3, "Role must be at least 3 characters"),
  objective: z.string().min(10, "Objective must be at least 10 characters"),
  introText: z.string().min(20, "Introduction must be at least 20 characters"),
  companyName: z.string().optional(),
  industry: z.string().optional(),
  companySize: z.string().optional(),
  situationBackground: z.string().optional(),
  timelineContext: z.string().optional(),
  industryContext: z.string().optional(),
  competitiveEnvironment: z.string().optional(),
  regulatoryEnvironment: z.string().optional(),
  culturalContext: z.string().optional(),
  resourceConstraints: z.string().optional(),
  keyConstraintsText: z.string().optional(),
  learningObjectivesText: z.string().optional(),
});

type ScenarioFormData = z.infer<typeof scenarioFormSchema>;

const DOMAINS = [
  "Marketing", "Ethics", "HR", "Strategy", "Crisis", "Finance",
  "Operations", "Leadership", "Sustainability", "Innovation",
  "Mergers & Acquisitions", "Supply Chain",
];

const INDUSTRIES = [
  "Technology", "Healthcare", "Finance", "Manufacturing", "Retail",
  "Education", "Non-profit", "Energy", "Media & Entertainment",
  "Real Estate", "Transportation",
];

export default function ScenarioEdit() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  const { data: scenario, isLoading: scenarioLoading, error: scenarioError } = useQuery<Scenario>({
    queryKey: ["/api/scenarios", scenarioId],
    enabled: !!scenarioId && !!user,
  });

  const form = useForm<ScenarioFormData>({
    resolver: zodResolver(scenarioFormSchema),
    defaultValues: {
      title: "",
      description: "",
      domain: "",
      difficultyLevel: "intermediate",
      role: "",
      objective: "",
      introText: "",
      companyName: "",
      industry: "",
      companySize: "",
      situationBackground: "",
      timelineContext: "",
      industryContext: "",
      competitiveEnvironment: "",
      regulatoryEnvironment: "",
      culturalContext: "",
      resourceConstraints: "",
      keyConstraintsText: "",
      learningObjectivesText: "",
    },
  });

  useEffect(() => {
    if (scenario) {
      const initialState = scenario.initialState as any;
      form.reset({
        title: scenario.title,
        description: scenario.description || "",
        domain: scenario.domain,
        difficultyLevel: initialState?.difficultyLevel || "intermediate",
        role: initialState?.playerRole || "",
        objective: initialState?.objective || "",
        introText: initialState?.introText || "",
        companyName: initialState?.companyName || "",
        industry: initialState?.industry || "",
        companySize: initialState?.companySize || "",
        situationBackground: initialState?.situationBackground || "",
        timelineContext: initialState?.timelineContext || "",
        industryContext: initialState?.industryContext || "",
        competitiveEnvironment: initialState?.competitiveEnvironment || "",
        regulatoryEnvironment: initialState?.regulatoryEnvironment || "",
        culturalContext: initialState?.culturalContext || "",
        resourceConstraints: initialState?.resourceConstraints || "",
        keyConstraintsText: Array.isArray(initialState?.keyConstraints) 
          ? initialState.keyConstraints.join("\n") 
          : "",
        learningObjectivesText: Array.isArray(initialState?.learningObjectives)
          ? initialState.learningObjectives.join("\n")
          : "",
      });
    }
  }, [scenario, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: ScenarioFormData) => {
      const currentState = scenario?.initialState as any || {};
      const updatedScenario = {
        title: data.title,
        description: data.description,
        domain: data.domain,
        initialState: {
          ...currentState,
          playerRole: data.role,
          objective: data.objective,
          introText: data.introText,
          companyName: data.companyName,
          industry: data.industry,
          companySize: data.companySize,
          situationBackground: data.situationBackground,
          timelineContext: data.timelineContext,
          industryContext: data.industryContext,
          competitiveEnvironment: data.competitiveEnvironment,
          regulatoryEnvironment: data.regulatoryEnvironment,
          culturalContext: data.culturalContext,
          resourceConstraints: data.resourceConstraints,
          difficultyLevel: data.difficultyLevel,
          keyConstraints: data.keyConstraintsText?.split("\n").filter(Boolean) || [],
          learningObjectives: data.learningObjectivesText?.split("\n").filter(Boolean) || [],
        },
      };
      const response = await apiRequest("PUT", `/api/scenarios/${scenarioId}`, updatedScenario);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios"] });
      toast({ title: "Scenario updated successfully" });
      navigate("/");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update scenario", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (scenarioError && isUnauthorizedError(scenarioError as Error)) {
      toast({ title: "Session Expired", description: "Please sign in again.", variant: "destructive" });
      setTimeout(() => { window.location.href = "/api/login"; }, 500);
    }
  }, [scenarioError, toast]);

  if (authLoading || scenarioLoading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const isProfessorOrAdmin = user.role === "professor" || user.role === "admin";
  if (!isProfessorOrAdmin) {
    navigate("/");
    return null;
  }

  const onSubmit = (data: ScenarioFormData) => {
    updateMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild data-testid="button-back">
              <Link href="/">
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">Edit Scenario</h1>
          </div>
          <Button 
            onClick={form.handleSubmit(onSubmit)} 
            disabled={updateMutation.isPending}
            data-testid="button-save"
          >
            {updateMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <BookOpen className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Basic Information</h2>
              </div>
              <div className="grid gap-6">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Scenario title" {...field} data-testid="input-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Brief description" rows={3} {...field} data-testid="input-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="domain"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Domain</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-domain">
                              <SelectValue placeholder="Select domain" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {DOMAINS.map((d) => (
                              <SelectItem key={d} value={d}>{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="difficultyLevel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Difficulty</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-difficulty">
                              <SelectValue placeholder="Select difficulty" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="beginner">Beginner</SelectItem>
                            <SelectItem value="intermediate">Intermediate</SelectItem>
                            <SelectItem value="advanced">Advanced</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <Building2 className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Company Context</h2>
              </div>
              <div className="grid gap-6">
                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Company name" {...field} data-testid="input-company" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="industry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Industry</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger data-testid="select-industry">
                              <SelectValue placeholder="Select industry" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {INDUSTRIES.map((i) => (
                              <SelectItem key={i} value={i}>{i}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companySize"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Size</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger data-testid="select-size">
                              <SelectValue placeholder="Select size" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="startup">Startup (1-50)</SelectItem>
                            <SelectItem value="small">Small (51-200)</SelectItem>
                            <SelectItem value="medium">Medium (201-1000)</SelectItem>
                            <SelectItem value="large">Large (1001-5000)</SelectItem>
                            <SelectItem value="enterprise">Enterprise (5000+)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="situationBackground"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Situation Background</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Describe the situation..." rows={4} {...field} data-testid="input-background" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <Users className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Player Role</h2>
              </div>
              <div className="grid gap-6">
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., CEO, Marketing Director" {...field} data-testid="input-role" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="objective"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Objective</FormLabel>
                      <FormControl>
                        <Textarea placeholder="What must the player achieve?" rows={2} {...field} data-testid="input-objective" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="introText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Introduction Text</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Opening narrative shown to the player..." rows={4} {...field} data-testid="input-intro" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <Target className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Learning Objectives</h2>
              </div>
              <div className="grid gap-6">
                <FormField
                  control={form.control}
                  name="learningObjectivesText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Learning Objectives (one per line)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Enter each objective on a new line..." rows={4} {...field} data-testid="input-objectives" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="keyConstraintsText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Key Constraints (one per line)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Enter each constraint on a new line..." rows={3} {...field} data-testid="input-constraints" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Card>
          </form>
        </Form>
      </main>
    </div>
  );
}
