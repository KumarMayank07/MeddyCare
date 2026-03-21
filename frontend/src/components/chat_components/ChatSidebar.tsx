import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Plus,
  MoreVertical,
  User,
  Trash2,
  Share2,
  Edit2,
  Archive,
  Check,
  X,
  Clock,
  MessageSquare,
  Search,
} from "lucide-react";
import apiService from "@/lib/api";
import ProfileModal from "@/components/ProfileModal";

interface ChatSidebarProps {
  currentChatId: string | null;
  onSelectChat: (chatId: string | null) => void;
  refreshKey?: number;  // increment to force a chat list reload (e.g. after auto-title)
}

interface ChatItem {
  _id: string;
  created_at: string;
  updated_at?: string;
  title?: string;
  archived?: boolean;
}

// Custom Modal Component
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "info";
}

function CustomModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  type = "info",
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-xl font-semibold text-foreground mb-2">{title}</h2>
          <p className="text-muted-foreground mb-6">{message}</p>

          <div className="flex gap-3 justify-end">
            {cancelText && (
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-border text-foreground hover:bg-muted transition-colors text-sm font-medium"
              >
                {cancelText}
              </button>
            )}
            {confirmText && onConfirm && (
              <button
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={cn(
                  "px-4 py-2 rounded-xl text-white transition-colors text-sm font-medium",
                  type === "danger"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-primary hover:bg-primary/90"
                )}
              >
                {confirmText}
              </button>
            )}
            {!confirmText && (
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground transition-colors text-sm font-medium"
              >
                OK
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ChatSidebar({
  currentChatId,
  onSelectChat,
  refreshKey,
}: ChatSidebarProps) {
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedChats, setArchivedChats] = useState<ChatItem[]>([]);
  const [historyOverlayOpen, setHistoryOverlayOpen] = useState(false);
  const mountedRef = useRef(true);

  const [showProfileModal, setShowProfileModal] = useState(false);

  const { user } = useAuth();
  const storedProfileImage = user?.profileImage ?? null;

  const [search, setSearch] = useState("");
  const filteredChats = search
    ? chats.filter(c => (c.title ?? "Chat").toLowerCase().includes(search.toLowerCase()))
    : chats;

  // Modal states
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: "danger" | "info";
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  const parseTime = (s?: string) => {
    if (!s) return 0;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
    const d = new Date(s);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  };

  const sortByTimeDesc = (arr: ChatItem[]) =>
    arr
      .slice()
      .sort((a, b) => parseTime(b.created_at) - parseTime(a.created_at));

  const formatLocalTime = (utcTimestamp: string) => {
    if (!utcTimestamp) return "";
    // MongoDB returns timestamps without timezone suffix (e.g. "2026-03-19T17:05:00").
    // Without a "Z", JavaScript treats it as local time instead of UTC → wrong time shown.
    // Appending "Z" forces UTC interpretation so toLocaleString converts to local time correctly.
    const normalized = /[Zz]|[+-]\d{2}:\d{2}$/.test(utcTimestamp)
      ? utcTimestamp
      : utcTimestamp + "Z";
    const date = new Date(normalized);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  async function loadChats() {
    setLoading(true);
    try {
      const data = await apiService.ragGetChats();
      const all: ChatItem[] = data?.chats ?? [];
      if (!mountedRef.current) return;

      const active = sortByTimeDesc(all.filter((c) => !c.archived));
      const archived = sortByTimeDesc(all.filter((c) => c.archived));

      setChats(active);
      setArchivedChats(archived);
    } catch (err) {
      console.error("Failed to load chats:", err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // Re-fetch when parent signals a title update (e.g. after auto-title is saved)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) loadChats();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load chats on mount and whenever a new chat is created (null → real ID).
  // Switching between existing chats does NOT re-fetch the list.
  const prevChatIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    mountedRef.current = true;
    const prev = prevChatIdRef.current;
    prevChatIdRef.current = currentChatId;

    const isInitialMount  = prev === undefined;
    const isNewChatAdded  = prev === null && currentChatId !== null;

    if (isInitialMount || isNewChatAdded) {
      loadChats();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [currentChatId]);

  const handleNewChat = () => {
    onSelectChat(null);
  };

  const handleArchiveToggle = async (chatId: string, archive = true) => {
    const prevChats = [...chats];
    const prevArchived = [...archivedChats];

    let chatToMove =
      chats.find((c) => c._id === chatId) ||
      archivedChats.find((c) => c._id === chatId);

    try {
      if (!chatToMove) {
        try {
          const data = await apiService.ragGetChats();
          const all: ChatItem[] = data?.chats ?? [];
          chatToMove =
            all.find((c) => c._id === chatId) ||
            chats.find((c) => c._id === chatId) ||
            archivedChats.find((c) => c._id === chatId);
        } catch {
          // ignore fetch error
        }
      }

      if (chatToMove) {
        if (archive) {
          setChats((prev) => prev.filter((c) => c._id !== chatId));
          setArchivedChats((prev) =>
            sortByTimeDesc([...prev, { ...chatToMove!, archived: true }])
          );
        } else {
          setArchivedChats((prev) => prev.filter((c) => c._id !== chatId));
          setChats((prev) =>
            sortByTimeDesc([...prev, { ...chatToMove!, archived: false }])
          );
        }
      }

      await apiService.ragArchiveChat(chatId, archive);

      if (archive && currentChatId === chatId) onSelectChat(null);
    } catch (err) {
      console.error("Failed to archive/unarchive chat:", err);
      setModalState({
        isOpen: true,
        title: "Error",
        message: "Failed to archive/unarchive chat. Please try again.",
        type: "danger",
      });

      setChats(prevChats);
      setArchivedChats(prevArchived);
    }
  };

  const startRename = (chat: ChatItem) => {
    setEditingChatId(chat._id);
    setEditValue(chat.title ?? "");
  };

  const saveRename = async (chatId: string) => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      setModalState({
        isOpen: true,
        title: "Invalid Title",
        message: "Chat title cannot be empty. Please enter a valid title.",
        type: "info",
      });
      return;
    }

    const words = trimmed.split(" ").filter((word) => word.length > 0);
    if (words.length > 10) {
      setModalState({
        isOpen: true,
        title: "Title Too Long",
        message:
          "Chat title cannot exceed 10 words. Please shorten your title.",
        type: "info",
      });
      return;
    }

    const prevChats = [...chats];
    const prevArchived = [...archivedChats];

    try {
      setChats((prev) =>
        prev.map((c) => (c._id === chatId ? { ...c, title: trimmed } : c))
      );
      setArchivedChats((prev) =>
        prev.map((c) => (c._id === chatId ? { ...c, title: trimmed } : c))
      );
      setEditingChatId(null);
      setEditValue("");

      await apiService.ragRenameChat(chatId, trimmed);
    } catch (err) {
      console.error("Rename failed", err);
      setModalState({
        isOpen: true,
        title: "Rename Failed",
        message: "Failed to rename the chat. Please try again.",
        type: "danger",
      });

      setChats(prevChats);
      setArchivedChats(prevArchived);
      setEditingChatId(null);
      setEditValue("");
    }
  };

  const cancelRename = () => {
    setEditingChatId(null);
    setEditValue("");
  };

  const handleDelete = async (chatId: string) => {
    const chatToDelete =
      chats.find((c) => c._id === chatId) ||
      archivedChats.find((c) => c._id === chatId);
    const chatTitle = chatToDelete?.title || "Untitled Chat";

    setModalState({
      isOpen: true,
      title: "Delete chat?",
      message: `This will delete "${chatTitle}".`,
      confirmText: "Delete",
      cancelText: "Cancel",
      type: "danger",
      onConfirm: async () => {
        try {
          const result = await apiService.ragDeleteChat(chatId);
          setChats((p) => p.filter((c) => c._id !== chatId));
          setArchivedChats((p) => p.filter((c) => c._id !== chatId));
          if (currentChatId === chatId) onSelectChat(null);
          if ((result as any)?.notSupported) {
            setModalState({
              isOpen: true,
              title: "Note",
              message:
                "Server does not support delete. Chat has been removed locally.",
              type: "info",
            });
          }
        } catch (err) {
          console.error("Failed to delete chat:", err);
          setModalState({
            isOpen: true,
            title: "Delete Failed",
            message: "Failed to delete the chat. Please try again.",
            type: "danger",
          });
        }
      },
    });
  };

  const handleShare = async (chatId: string) => {
    try {
      if (typeof apiService.ragShareChat === "function") {
        const res = await apiService.ragShareChat(chatId);
        const url = (res as any)?.shareUrl ?? (res as any)?.url;
        if (url) {
          await navigator.clipboard.writeText(url);
          setModalState({
            isOpen: true,
            title: "Share Link Copied!",
            message:
              "The share link has been successfully copied to your clipboard. You can now paste and share it with others.",
            type: "info",
          });
          return;
        }
      }
      const fallback = `${window.location.origin}/chat/${chatId}`;
      await navigator.clipboard.writeText(fallback);
      setModalState({
        isOpen: true,
        title: "Share Link Copied!",
        message:
          "The share link has been successfully copied to your clipboard. You can now paste and share it with others.",
        type: "info",
      });
    } catch (err) {
      console.error("Share failed", err);
      setModalState({
        isOpen: true,
        title: "Share Failed",
        message: "Failed to generate share link. Please try again.",
        type: "danger",
      });
    }
  };

  const handleProfileClick = () => {
    setShowProfileModal(true);
  };

  const renderChatRow = (chat: ChatItem, isArchived = false) => {
    const isSelected = chat._id === currentChatId;
    const key = chat._id;

    return (
      <div
        key={key}
        className={cn(
          "group rounded-lg px-2 py-1",
          isSelected ? "bg-accent border border-border/40" : "hover:bg-accent/50",
          "cursor-pointer transition-colors"
        )}
        onClick={() => {
          onSelectChat(chat._id);
          setHistoryOverlayOpen(false);
        }}
      >
        <div className="min-w-0">
          {editingChatId === chat._id ? (
            <div className="flex gap-1 items-center w-full">
              <div className="flex-1 relative">
                <input
                  className="w-full rounded-lg border border-border px-2 py-1 text-sm bg-background text-foreground"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename(chat._id);
                    if (e.key === "Escape") cancelRename();
                  }}
                  placeholder="Enter chat title (max 10 words)"
                  maxLength={100}
                  autoFocus
                  style={{
                    textAlign: "left",
                    direction: "ltr",
                  }}
                  onFocus={(e) => {
                    const len = (e.target as HTMLInputElement).value.length;
                    (e.target as HTMLInputElement).setSelectionRange(len, len);
                  }}
                />
                <div className="absolute -bottom-4 left-0 text-xs text-muted-foreground">
                  {
                    editValue
                      .trim()
                      .split(" ")
                      .filter((w) => w.length > 0).length
                  }
                  /10 words
                </div>
              </div>
              <div className="flex gap-1 shrink-0 ml-1">
                <button
                  className="p-1 rounded-md hover:bg-green-100 dark:hover:bg-green-900/30 bg-green-50 dark:bg-green-900/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    saveRename(chat._id);
                  }}
                  title="Save"
                >
                  <Check className="w-3 h-3 text-green-600" />
                </button>
                <button
                  className="p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 bg-red-50 dark:bg-red-900/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelRename();
                  }}
                  title="Cancel"
                >
                  <X className="w-3 h-3 text-red-600" />
                </button>
              </div>
            </div>
          ) : (
            <div className="grid items-center gap-1" style={{ gridTemplateColumns: "1fr 28px" }}>
              <div className="overflow-hidden">
                <p className="text-xs font-medium truncate leading-tight">
                  {chat.title ?? "Chat"}
                </p>
                <p className="text-[10px] text-muted-foreground truncate leading-tight">
                  {formatLocalTime(chat.updated_at ?? chat.created_at)}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded-md text-foreground hover:bg-muted/80 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" className="z-[60]">
                  <DropdownMenuItem onClick={() => handleShare(chat._id)}>
                    <Share2 className="mr-2 h-4 w-4" /> Share
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => startRename(chat)}>
                    <Edit2 className="mr-2 h-4 w-4" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleArchiveToggle(chat._id, !isArchived)}>
                    <Archive className="mr-2 h-4 w-4" /> {isArchived ? "Unarchive" : "Archive"}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(chat._id)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    );
  };

  const collapseButtonTitle = isOpen ? "Collapse sidebar" : "Open sidebar";

  return (
    <>
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        totalChats={chats.length + archivedChats.length}
        archivedCount={archivedChats.length}
      />

      <div
        className={cn(
          "flex flex-col border-r border-border/60 h-full transition-all duration-300 bg-card relative rounded-xl shadow-md min-h-0",
          isOpen ? "w-64" : "w-14"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div
              onClick={() => setIsOpen((s) => !s)}
              title={collapseButtonTitle}
              className={cn(
                "rounded-lg p-1 py-2 hover:bg-muted flex items-center justify-center select-none cursor-pointer transition-colors"
              )}
            >
              <img
                src="/vision_icon.png"
                alt="MeddyCare"
                className="w-7 h-7 rounded-full object-cover"
              />
            </div>

            {isOpen && (
              <div className="flex flex-col">
                <span className="font-bold text-base select-none tracking-tight">MeddyCare</span>
                <span className="text-xs text-muted-foreground select-none">
                  Eye health assistant
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {isOpen ? (
            <>
              <div className="p-2 border-b space-y-1.5">
                <Button
                  onClick={handleNewChat}
                  className="w-full justify-start bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
                  size="sm"
                >
                  <Plus className="h-3 w-3 mr-2" />
                  New Chat
                </Button>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    className="w-full rounded-lg border border-input bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Search chats…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-1 px-2 py-1">
                  <div className="px-2 py-1 mt-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Recents
                    </span>
                  </div>

                  {loading && (
                    <p className="text-sm text-muted-foreground px-2">
                      Loading chats...
                    </p>
                  )}
                  {filteredChats.map((chat) => renderChatRow(chat, false))}
                  {!loading && filteredChats.length === 0 && (
                    <p className="text-sm text-muted-foreground px-2">
                      {search ? "No chats match your search." : "No chats yet."}
                    </p>
                  )}
                  <div className="mt-2 p-1 py-4">
                    <div
                      className="flex items-center justify-between px-1 cursor-pointer"
                      onClick={() => setArchivedOpen((s) => !s)}
                    >
                      <div className="flex items-center gap-2">
                        <Archive className="w-4 h-4" />
                        <span className="text-sm font-medium">Archived</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {archivedOpen
                          ? "Hide"
                          : `${archivedChats.length} archived`}
                      </div>
                    </div>

                    {archivedOpen && archivedChats.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {archivedChats.map((a) => renderChatRow(a, true))}
                      </div>
                    )}

                    {archivedOpen && archivedChats.length === 0 && (
                      <p className="text-sm text-muted-foreground px-2 mt-2">
                        No archived chats.
                      </p>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex flex-col items-center py-3 space-y-3">
              <button
                title="New chat"
                className="p-2 rounded-lg bg-primary hover:bg-primary/90 transition-colors text-primary-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNewChat();
                }}
              >
                <Plus className="h-4 w-4" />
              </button>

              <button
                title="Recent"
                className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  if (chats.length > 0) onSelectChat(chats[0]._id);
                }}
              >
                <Clock className="h-5 w-5" />
              </button>

              <button
                title="History"
                className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setHistoryOverlayOpen((s) => !s);
                }}
              >
                <MessageSquare className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>

        <div className="p-2 border-t border-border/50 mt-auto">
          {isOpen ? (
            <Button
              variant="ghost"
              className="w-full justify-start px-12 hover:bg-muted rounded-lg"
              onClick={handleProfileClick}
            >
              <div className="h-9 w-9 mr-2 rounded-full bg-muted border border-border flex items-center justify-center overflow-hidden shrink-0">
                {storedProfileImage
                  ? <img src={storedProfileImage} alt="avatar" className="w-full h-full object-cover" />
                  : <User className="h-5 w-5 text-muted-foreground" />
                }
              </div>
              <span className="text-sm font-medium text-foreground">Profile</span>
            </Button>
          ) : (
            <div className="flex justify-center">
              <button
                onClick={handleProfileClick}
                title="Profile"
                className="rounded-full bg-muted hover:bg-muted/80 border border-border transition-colors overflow-hidden h-9 w-9 flex items-center justify-center"
              >
                {storedProfileImage
                  ? <img src={storedProfileImage} alt="avatar" className="w-full h-full object-cover" />
                  : <User className="h-5 w-5 text-muted-foreground" />
                }
              </button>
            </div>
          )}
        </div>
      </div>

      {historyOverlayOpen && !isOpen && (
        <div
          className="fixed left-16 top-20 z-50 w-80 max-h-[70vh] bg-card border border-border shadow-xl rounded-xl overflow-hidden"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm text-foreground">History</span>
            </div>
            <button
              className="p-1 rounded-lg hover:bg-muted transition-colors"
              onClick={() => setHistoryOverlayOpen(false)}
              aria-label="Close history"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="p-2 overflow-auto max-h-[calc(70vh-56px)]">
            {loading && (
              <p className="text-sm text-muted-foreground px-2">
                Loading chats...
              </p>
            )}

            {chats.map((c) => (
              <div key={c._id} className="mb-2">
                <div
                  className="flex items-center justify-between rounded-md p-2 hover:bg-accent/30 cursor-pointer"
                  onClick={() => {
                    onSelectChat(c._id);
                    setHistoryOverlayOpen(false);
                  }}
                >
                  <div>
                    <div className="text-sm font-medium truncate">
                      {c.title ?? "Chat"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatLocalTime(c.created_at)}
                    </div>
                  </div>
                  <button
                    title="Delete"
                    className="p-1 rounded-lg hover:bg-muted transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c._id);
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              </div>
            ))}

            {chats.length === 0 && (
              <p className="text-sm text-muted-foreground">No chats yet.</p>
            )}
          </div>
        </div>
      )}

      <CustomModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={modalState.onConfirm}
        title={modalState.title}
        message={modalState.message}
        confirmText={modalState.confirmText}
        cancelText={modalState.cancelText}
        type={modalState.type}
      />
    </>
  );
}