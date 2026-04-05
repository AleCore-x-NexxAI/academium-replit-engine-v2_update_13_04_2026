import { Component, type ReactNode } from "react";
import { Brain, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string | null }) {
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
  }

  handleRefresh = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      const lang = localStorage.getItem("academium-language") || "es";
      const isEn = lang === "en";

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <Card className="max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold mb-2">
              {isEn ? "Something went wrong" : "Algo sali\u00f3 mal"}
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              {isEn
                ? "An unexpected error occurred. Try refreshing the page."
                : "Ocurri\u00f3 un error inesperado. Intenta actualizar la p\u00e1gina."}
            </p>
            <div className="flex flex-col gap-3">
              <Button onClick={this.handleRefresh} data-testid="button-error-refresh">
                <RefreshCw className="w-4 h-4 mr-2" />
                {isEn ? "Refresh page" : "Actualizar p\u00e1gina"}
              </Button>
              <Button variant="outline" onClick={this.handleGoHome} data-testid="button-error-home">
                <Brain className="w-4 h-4 mr-2" />
                {isEn ? "Go back to home" : "Volver al inicio"}
              </Button>
            </div>
            {this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  {isEn ? "Technical details" : "Detalles t\u00e9cnicos"}
                </summary>
                <pre className="mt-2 text-xs text-muted-foreground bg-muted p-3 rounded-md overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
