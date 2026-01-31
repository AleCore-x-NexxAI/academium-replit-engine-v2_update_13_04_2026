import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import type { User } from "@shared/schema";

type AllowedRole = "student" | "professor" | "admin";

interface RoleProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: AllowedRole[];
  fallbackPath?: string;
}

export function RoleProtectedRoute({ 
  children, 
  allowedRoles, 
  fallbackPath = "/" 
}: RoleProtectedRouteProps) {
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/" />;
  }

  const userRole = user.role as AllowedRole;
  const hasAccess = allowedRoles.includes(userRole) || user.isSuperAdmin;

  if (!hasAccess) {
    return <Redirect to={fallbackPath} />;
  }

  return <>{children}</>;
}
