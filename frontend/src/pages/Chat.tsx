import { useState } from "react";
import ChatSidebar from "@/components/chat_components/ChatSidebar";
import ChatWindow from "@/components/chat_components/ChatWindow";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  FileText,
  Link,
  Loader2,
  CheckCircle,
  XCircleIcon,
} from "lucide-react";

// Custom Toast Notification Component
interface ToastNotification {
  id: string;
  type: "success" | "error";
  title: string;
  messages: string[];
}

// URL Modal Component
function UrlInputModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (url: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onSubmit(url.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="bg-card rounded-2xl shadow-2xl p-8 max-w-lg w-full mx-4 animate-scale-in">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="rounded-full p-4 bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
            <Link className="h-10 w-10 text-white" strokeWidth={2.5} />
          </div>
        </div>

        {/* Title */}
        <h3 className="text-center text-2xl font-bold text-foreground mb-2">
          Upload URL
        </h3>
        <p className="text-center text-sm text-muted-foreground mb-6">
          Enter the URL you want to ingest into the system
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full px-4 py-3 border-2 border-input bg-background text-foreground rounded-xl focus:border-ring focus:outline-none transition-colors mb-6"
            required
            autoFocus
          />

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-muted hover:bg-muted/80 text-foreground font-semibold py-3 px-6 rounded-xl transition-all duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToastNotification({
  notification,
  onClose,
}: {
  notification: ToastNotification;
  onClose: () => void;
}) {
  const isError = notification.type === "error";
  const bgColor = isError
    ? "from-red-50 via-red-50 to-red-100 dark:from-red-950/60 dark:via-red-950/60 dark:to-red-900/60"
    : "from-sky-400 to-sky-500 dark:from-sky-500 dark:to-sky-600";
  const iconBgColor = isError
    ? "bg-gradient-to-br from-red-500 to-red-600"
    : "bg-gradient-to-br from-white/30 to-white/20";
  const buttonColor = isError
    ? "bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700"
    : "bg-white/20 hover:bg-white/30 border border-white/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in">
      <div
        className={`bg-gradient-to-b ${bgColor} rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 animate-scale-in`}
      >
        {/* Success/Error Icon Circle */}
        <div className="flex justify-center mb-6">
          <div className={`rounded-full p-4 ${iconBgColor} shadow-lg`}>
            {isError ? (
              <XCircleIcon className="h-12 w-12 text-white" strokeWidth={1.5} />
            ) : (
              <CheckCircle className="h-12 w-12 text-white" strokeWidth={2.5} />
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-center text-2xl font-bold text-white mb-4">
          {notification.title}
        </h3>

        {/* Messages */}
        <div className="space-y-2 mb-6 text-center">
          {notification.messages.map((msg, idx) => (
            <p key={idx} className="text-sm text-white/90 leading-relaxed">
              {msg}
            </p>
          ))}
        </div>

        {/* Continue/Retry Button */}
        <button
          onClick={onClose}
          className={`w-full ${buttonColor} text-white font-semibold py-3 px-6 rounded-full transition-all duration-200 shadow-md hover:shadow-lg backdrop-blur-sm`}
        >
          {isError ? "Retry" : "Continue"}
        </button>
      </div>
    </div>
  );
}

const RAG_API_BASE_URL = import.meta.env.VITE_RAG_API_BASE_URL;

export default function Chat() {
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [sidebarKey, setSidebarKey] = useState(0);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingUrl, setUploadingUrl] = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [notification, setNotification] = useState<ToastNotification | null>(
    null
  );
  const { user, token } = useAuth();

  const showNotification = (
    type: "success" | "error",
    title: string,
    messages: string[]
  ) => {
    const id = Date.now().toString();
    setNotification({ id, type, title, messages });

    // Auto-dismiss after 10 seconds for all notifications
    setTimeout(() => {
      setNotification(null);
    }, 10000);
  };

  const handleUploadPdf = async () => {
    if (!token || user?.role !== "admin") {
      showNotification("error", "Access Denied", [
        "Admin privileges required to upload PDFs",
      ]);
      return;
    }

    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pdf";
      input.multiple = true;
      input.onchange = async () => {
        if (input.files && input.files.length > 0) {
          setUploadingPdf(true);

          const files = Array.from(input.files);
          const results: string[] = [];
          const errors: string[] = [];

          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
              const formData = new FormData();
              formData.append("file", file);

              const res = await fetch(
                `${RAG_API_BASE_URL}/ingest/pdf`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                  body: formData,
                }
              );

              if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.detail || "PDF upload failed");
              }

              const data = await res.json();
              results.push(`📄 ${file.name}`);
              results.push(`Chunks: ${data.chunks} | Doc ID: ${data.doc_id}`);
              if (i < files.length - 1) results.push(""); // Add spacing between files
            } catch (err: any) {
              console.error(`Error uploading ${file.name}:`, err);
              errors.push(`${file.name}: ${err.message}`);
            }
          }

          setUploadingPdf(false);

          // Show notification
          if (results.length > 0 && errors.length === 0) {
            showNotification(
              "success",
              files.length === 1
                ? "PDF Uploaded Successfully!"
                : "PDFs Uploaded Successfully!",
              results
            );
          } else if (results.length > 0 && errors.length > 0) {
            showNotification("error", "Partial Upload", [
              ...results,
              "",
              "Failed uploads:",
              ...errors,
            ]);
          } else {
            showNotification("error", "PDF Upload Failed!", [
              "Error in sending the data. Please try again.",
            ]);
          }
        }
      };
      input.click();
    } catch (err: any) {
      console.error(err);
      setUploadingPdf(false);
      showNotification("error", "PDF Upload Failed!", [
        "Error in sending the data. Please try again."
      ]);
    }
  };

  const handleUploadUrl = async () => {
    if (!token || user?.role !== "admin") {
      showNotification("error", "Access Denied", [
        "Admin privileges required to upload URLs",
      ]);
      return;
    }

    setShowUrlModal(true);
  };

  const processUrlUpload = async (url: string) => {
    setShowUrlModal(false);
    setUploadingUrl(true);

    try {
      const res = await fetch(`${RAG_API_BASE_URL}/ingest/url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "URL ingestion failed");
      }
      const data = await res.json();

      showNotification("success", "URL Ingested Successfully!", [
        `🔗 ${url}`,
        `Chunks: ${data.chunks} | Doc ID: ${data.doc_id}`,
      ]);
    } catch (err: any) {
      console.error(err);
      showNotification("error", "URL Ingestion Failed!", [
        "Error in sending the data. Please try again."
      ]);
    } finally {
      setUploadingUrl(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* URL Input Modal */}
      {showUrlModal && (
        <UrlInputModal
          onSubmit={processUrlUpload}
          onClose={() => setShowUrlModal(false)}
        />
      )}

      {/* Toast Notification */}
      {notification && (
        <ToastNotification
          notification={notification}
          onClose={() => setNotification(null)}
        />
      )}

      {/* Page header */}
      <header className="container mx-auto py-8 pt-8 pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Chat Support</h1>
          <p className="text-sm text-muted-foreground mt-1">AI-powered health assistant</p>
        </div>
      </header>

      {/* Main content - Fixed height container */}
      <main
        className="container mx-auto px-8 py-4"
        style={{ height: "calc(100vh - 112px)" }}
      >
        <div className="flex gap-9 h-full">
          {/* Sidebar */}
          <div className="h-full shrink-0">
            <ChatSidebar
              currentChatId={currentChatId}
              onSelectChat={setCurrentChatId}
              refreshKey={sidebarKey}
            />
          </div>

          {/* Chat area - Full height, no admin panel inside */}
          <div className="flex-1 h-full">
            <ChatWindow
              chatId={currentChatId}
              onNewChat={(id) => setCurrentChatId(id)}
              onTitleUpdate={() => setSidebarKey(k => k + 1)}
            />
          </div>
        </div>
      </main>

      {/* Admin/User Panel - Outside fixed height container */}
      <div className="container mx-auto px-8 pb-4">
        <div className="flex gap-9">
          {/* Spacer to align with sidebar */}
          <div style={{ width: "57px" }}></div>

          {/* Panel aligned with chat area */}
          <div className="flex-1">
            {user?.role === "admin" && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">
                    Admin Panel
                  </span>
                  <span className="text-xs text-muted-foreground">Role: {user.role}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUploadPdf}
                      disabled={uploadingPdf}
                      className="border-primary/30 bg-card hover:bg-primary/10 text-primary transition-all duration-200 cursor-pointer shadow-sm"
                    >
                      {uploadingPdf ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <FileText className="h-4 w-4 mr-2" />
                          Upload PDF
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUploadUrl}
                      disabled={uploadingUrl}
                      className="border-primary/30 bg-card hover:bg-primary/10 text-primary transition-all duration-200 cursor-pointer shadow-sm"
                    >
                      {uploadingUrl ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Link className="h-4 w-4 mr-2" />
                          Upload URL
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground ml-2">
                    Document Upload System
                  </div>
                </div>
              </div>
            )}

            {user?.role !== "admin" && user && (
              <div className="bg-muted/30 border border-border rounded-lg p-3 shadow-sm py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    User Panel
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Role: {user.role}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Chat-only access • Admin privileges required for uploads
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes scale-in {
          from {
            transform: scale(0.9);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
        .animate-scale-in {
          animation: scale-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}