import { useEffect, useState, useRef } from "react";
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
} from "lucide-react";
import apiService from "@/lib/api";

interface ChatSidebarProps {
  currentChatId: string | null;
  onSelectChat: (chatId: string | null) => void;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-3">{title}</h2>
          <p className="text-gray-600 mb-6">{message}</p>

          <div className="flex gap-3 justify-end">
            {cancelText && (
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-md border border-gray-300 hover:bg-gray-50 transition-colors"
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
                  "px-4 py-2 rounded-md text-white transition-colors",
                  type === "danger"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-teal-600 hover:bg-teal-700"
                )}
              >
                {confirmText}
              </button>
            )}
            {!confirmText && (
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white transition-colors"
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

export default function ChatSidebar({
  currentChatId,
  onSelectChat,
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
    const date = new Date(utcTimestamp);
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

  useEffect(() => {
    mountedRef.current = true;
    loadChats();
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
    setModalState({
      isOpen: true,
      title: "Profile Settings",
      message:
        "Your profile settings will be available soon. Stay tuned for personalized features and account management options!",
      type: "info",
    });
  };

  const renderChatRow = (chat: ChatItem, isArchived = false) => {
    const isSelected = chat._id === currentChatId;
    const key = chat._id;

    return (
      <div
        key={key}
        className={cn(
          "flex items-center justify-between group rounded-md px-2 py-1",
          isSelected ? "bg-accent" : "hover:bg-accent/60",
          "cursor-pointer"
        )}
        onClick={() => {
          onSelectChat(chat._id);
          setHistoryOverlayOpen(false);
        }}
      >
        <div className="flex flex-col flex-1 min-w-0">
          {editingChatId === chat._id ? (
            <div className="flex gap-1 items-center w-full">
              <div className="flex-1 relative">
                <input
                  className="w-full rounded-md border px-2 py-1 text-sm bg-white"
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
                <div className="absolute -bottom-4 left-0 text-xs text-gray-500">
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
                  className="p-1 rounded-md hover:bg-gray-100 bg-green-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    saveRename(chat._id);
                  }}
                  title="Save"
                >
                  <Check className="w-3 h-3 text-green-600" />
                </button>
                <button
                  className="p-1 rounded-md hover:bg-gray-100 bg-red-50"
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
            <>
              <span className="text-sm font-medium truncate">
                {chat.title ?? "Chat"}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatLocalTime(chat.created_at)}
              </span>
            </>
          )}
        </div>

        {editingChatId !== chat._id && (
          <div className="ml-2 flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Chat actions"
                >
                  <MoreVertical className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem asChild>
                  <button
                    className="w-full text-left px-2 py-1 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShare(chat._id);
                    }}
                  >
                    <Share2 className="mr-2 inline-block w-4 h-4" /> Share
                  </button>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <button
                    className="w-full text-left px-2 py-1 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(chat);
                    }}
                  >
                    <Edit2 className="mr-2 inline-block w-4 h-4" /> Rename
                  </button>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <button
                    className="w-full text-left px-2 py-1 hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleArchiveToggle(chat._id, !isArchived);
                    }}
                  >
                    <Archive className="mr-2 inline-block w-4 h-4" />
                    {isArchived ? "Unarchive" : "Archive"}
                  </button>
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <button
                    className="w-full text-left px-2 py-1 text-red-600 hover:bg-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(chat._id);
                    }}
                  >
                    <Trash2 className="mr-2 inline-block w-4 h-4" /> Delete
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    );
  };

  const collapseButtonTitle = isOpen ? "Collapse sidebar" : "Open sidebar";

  return (
    <>
      <div
        className={cn(
          "flex flex-col border-r h-full transition-all duration-300 bg-white relative rounded-lg shadow-sm min-h-0",
          isOpen ? "w-64" : "w-14"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b">
          <div className="flex items-center gap-2">
            <div
              onClick={() => setIsOpen((s) => !s)}
              title={collapseButtonTitle}
              className={cn(
                "rounded-md p-1 py-2 hover:bg-gray-100 flex items-center justify-center select-none cursor-pointer"
              )}
            >
              <img
                src="/vision_icon.png"
                alt="iCare"
                className="w-7 h-7 rounded-full object-cover"
              />
            </div>

            {isOpen && (
              <div className="flex flex-col">
                <span className="font-bold text-base select-none">iCare</span>
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
              <div className="p-2 border-b">
                <Button
                  onClick={handleNewChat}
                  className="w-full justify-start bg-teal-600 hover:bg-teal-700 text-white"
                  size="sm"
                >
                  <Plus className="h-3 w-3 mr-2" />
                  New Chat
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-1 p-1">
                  <div className="px-2 py-1 mt-1">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Recents
                    </span>
                  </div>

                  {loading && (
                    <p className="text-sm text-muted-foreground px-2">
                      Loading chats...
                    </p>
                  )}
                  {chats.map((chat) => renderChatRow(chat, false))}
                  {!loading && chats.length === 0 && (
                    <p className="text-sm text-muted-foreground px-2">
                      No chats yet.
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
                className="p-2 rounded-md bg-teal-600 hover:bg-teal-700 transition-colors text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNewChat();
                }}
              >
                <Plus className="h-4 w-4" />
              </button>

              <button
                title="Recent"
                className="p-2 rounded-md hover:bg-gray-100 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  if (chats.length > 0) onSelectChat(chats[0]._id);
                }}
              >
                <Clock className="h-5 w-5" />
              </button>

              <button
                title="History"
                className="p-2 rounded-md hover:bg-gray-100 transition-colors"
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

        <div className="p-2 border-t mt-auto">
          {isOpen ? (
            <Button
              variant="ghost"
              className="w-full justify-start px-12"
              onClick={handleProfileClick}
            >
              <div className="h-9 w-9 mr-2 rounded-full bg-gray-200 flex items-center justify-center p-2 py-2">
                <User className="h-5 w-5 text-gray-600" />
              </div>
              Profile
            </Button>
          ) : (
            <div className="flex justify-center">
              <button
                onClick={handleProfileClick}
                title="Profile"
                className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition-colors py-2"
              >
                <User className="h-5 w-5 text-gray-600" />
              </button>
            </div>
          )}
        </div>
      </div>

      {historyOverlayOpen && !isOpen && (
        <div
          className="fixed left-14 top-16 z-50 w-80 max-h-[70vh] bg-white shadow-lg rounded-md overflow-hidden border"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span className="font-medium">History</span>
            </div>
            <button
              className="p-1 rounded hover:bg-gray-100"
              onClick={() => setHistoryOverlayOpen(false)}
              aria-label="Close history"
            >
              <X className="w-4 h-4" />
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
                    className="p-1 rounded hover:bg-gray-100"
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