import React, { Component, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import SiteHeader from "./components/layout/SiteHeader";
import SiteFooter from "./components/layout/SiteFooter";

// Lazy-load all pages so the initial bundle stays small
const Index          = lazy(() => import("./pages/Index"));
const NotFound       = lazy(() => import("./pages/NotFound"));
const Auth           = lazy(() => import("./pages/Auth"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const UserDashboard  = lazy(() => import("./pages/user/UserDashboard"));
const DoctorDashboard = lazy(() => import("./pages/doctor/DoctorDashboard"));
const Chat           = lazy(() => import("./pages/Chat"));
const Doctors        = lazy(() => import("./pages/Doctors"));
const Reminders      = lazy(() => import("./pages/Reminders"));
const Reports        = lazy(() => import("./pages/Reports"));
const VerifyEmail    = lazy(() => import("./pages/VerifyEmail"));

// ── Page loading fallback ────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
    </div>
  );
}

// ── Global error boundary ────────────────────────────────────────────────────
interface ErrorBoundaryState { hasError: boolean; message: string }
class ErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Uncaught error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
          <h1 className="text-2xl font-bold text-destructive">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md">{this.state.message || "An unexpected error occurred."}</p>
          <button
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => { this.setState({ hasError: false, message: "" }); window.location.href = "/"; }}
          >
            Go to Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── TanStack Query client ────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <div className="min-h-screen flex flex-col bg-background">
              <SiteHeader />
              <main className="flex-1">
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    {/* Public routes */}
                    <Route path="/" element={<Index />} />
                    <Route path="/auth" element={<Auth />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />

                    {/* Admin-only route */}
                    <Route
                      path="/admin"
                      element={
                        <ProtectedRoute requiredRole="admin">
                          <AdminDashboard />
                        </ProtectedRoute>
                      }
                    />

                    {/* Doctor-only route */}
                    <Route
                      path="/doctor"
                      element={
                        <ProtectedRoute requiredRole="doctor">
                          <DoctorDashboard />
                        </ProtectedRoute>
                      }
                    />

                    {/* User (and doctor/admin) protected routes */}
                    <Route
                      path="/dashboard"
                      element={
                        <ProtectedRoute>
                          <UserDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/chat"
                      element={
                        <ProtectedRoute>
                          <Chat />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/doctors"
                      element={
                        <ProtectedRoute>
                          <Doctors />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/reminders"
                      element={
                        <ProtectedRoute>
                          <Reminders />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/reports"
                      element={
                        <ProtectedRoute>
                          <Reports />
                        </ProtectedRoute>
                      }
                    />

                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </main>
              <SiteFooter />
            </div>
          </BrowserRouter>
        </TooltipProvider>
        </NotificationProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
