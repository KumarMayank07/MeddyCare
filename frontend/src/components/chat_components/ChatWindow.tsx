import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User, Bot, Download, ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import apiService from "@/lib/api";

const RAG_API_BASE_URL = import.meta.env.VITE_RAG_API_BASE_URL;

interface Source {
  doc_id?: string;
  doc_title?: string;
  text?: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  id?: string;
  sources?: Source[];
  suggestions?: string[];
  streaming?: boolean;
}

interface Props {
  chatId: string | null;
  onNewChat?: (chatId: string) => void;
  onTitleUpdate?: (chatId: string, title: string) => void;
}

// ── helpers (module-level — stable across renders) ────────────────────────────

/**
 * Normalize any timestamp the server may return to a UTC ISO string.
 * Python FastAPI serialises naive datetime objects without "Z" — appending it
 * forces UTC interpretation so toLocaleString converts to local time correctly.
 */
function normalizeToIso(ts?: unknown): string {
  if (!ts) return new Date().toISOString();
  if (typeof ts === "number") {
    const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts;
    return new Date(ms).toISOString();
  }
  if (typeof ts === "string") {
    const n = Number(ts);
    if (!Number.isNaN(n)) {
      const ms = n < 1_000_000_000_000 ? n * 1000 : n;
      return new Date(ms).toISOString();
    }
    const withZ =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ts) &&
      !/Z|[+-]\d{2}:?\d{2}$/.test(ts)
        ? ts + "Z"
        : ts;
    const d = new Date(withZ);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function formatLocalTime(utcTs: string): string {
  return new Date(utcTs).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ChatWindow({ chatId, onNewChat, onTitleUpdate }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [openSources, setOpenSources] = useState<Set<number>>(new Set());

  const rootRef      = useRef<HTMLDivElement | null>(null);
  const messagesRef  = useRef<HTMLDivElement | null>(null);
  const inputRef     = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef   = useRef(false);        // sync guard against double-submit
  const justCreatedRef = useRef(false);      // skip reload when chatId set after first send
  const abortRef     = useRef<AbortController | null>(null);  // cancel in-flight SSE on unmount
  const [allowAutoFocus, setAllowAutoFocus] = useState(true);

  // ── abort in-flight SSE stream on unmount ───────────────────────────────
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── scroll to bottom whenever messages change ─────────────────────────────
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      });
    });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [messages]);

  // ── load history when chatId changes ─────────────────────────────────────
  useEffect(() => {
    if (!chatId) {
      setMessages([{
        role: "assistant",
        text: "Welcome to MeddyCare's support — Our assistant can help interpret results, explain next steps, and guide you to relevant resources.",
        timestamp: new Date().toISOString(),
      }]);
      setOpenSources(new Set());
      return;
    }

    // Skip reload if chatId was just assigned after first send — messages are
    // already correct in local state. Prevents the flicker/disappear bug.
    if (justCreatedRef.current) {
      justCreatedRef.current = false;
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiService.ragGetMessages(chatId)
      .then((data) => {
        if (cancelled) return;
        setMessages(
          (data.messages || []).map((m: any) => ({
            role:      m.role,
            text:      m.text,
            timestamp: normalizeToIso(m.timestamp),
            id:        m._id ?? m.id,
          }))
        );
        setOpenSources(new Set());
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([{
          role: "assistant",
          text: "⚠️ Error loading chat history. Please refresh the page.",
          timestamp: new Date().toISOString(),
        }]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [chatId]);

  // ── auto-focus input when clicking inside the chat window ────────────────
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) {
        setAllowAutoFocus(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        setAllowAutoFocus(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (!allowAutoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [messages.length, loading, allowAutoFocus]);

  // ── export chat as .txt ───────────────────────────────────────────────────
  function exportChat() {
    const lines = messages
      .filter(m => !m.streaming)
      .map(m =>
        `[${m.role === "user" ? "You" : "Assistant"}] ${formatLocalTime(m.timestamp)}\n${m.text}`
      )
      .join("\n\n---\n\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meddycare-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── send (SSE streaming) ──────────────────────────────────────────────────
  /**
   * Streaming architecture via Server-Sent Events:
   *   1. Add user message + streaming placeholder atomically.
   *   2. POST to /chat/stream; consume SSE chunks with ReadableStream.
   *   3. meta event  → attach sources to placeholder, call onNewChat for new chats.
   *   4. delta event → append text to placeholder (streaming cursor visible).
   *   5. done event  → finalise message, attach suggestions/id, call onTitleUpdate.
   *   6. error event → display error in placeholder bubble.
   */
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading || sendingRef.current) return;
    sendingRef.current = true;

    const inputText = input.trim();
    setInput("");
    setLoading(true);

    // Add user message + streaming assistant placeholder in one state update
    setMessages(prev => [
      ...prev,
      { role: "user",      text: inputText,         timestamp: new Date().toISOString() },
      { role: "assistant", text: "",                 timestamp: new Date().toISOString(), streaming: true },
    ]);

    const token = apiService.getToken();

    // Helper: mutate the last (streaming) message
    const updateLast = (updater: (last: Message) => Message) => {
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.length - 1;
        if (updated[idx]?.streaming) {
          updated[idx] = updater(updated[idx]);
        }
        return updated;
      });
    };

    // Abort any previous in-flight stream before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${RAG_API_BASE_URL}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: inputText, chat_id: chatId, top_k: 5 }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Error ${response.status}`);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer         = "";
      let resolvedChatId = chatId;
      let accumulated    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop()!; // keep trailing incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          let event: any;
          try { event = JSON.parse(json); } catch { continue; }

          if (event.type === "meta") {
            resolvedChatId = event.chat_id;
            updateLast(last => ({ ...last, sources: event.sources ?? [] }));
            // Notify parent of new chat at the earliest opportunity
            if (!chatId && resolvedChatId && onNewChat) {
              justCreatedRef.current = true;
              onNewChat(resolvedChatId);
            }
          } else if (event.type === "delta") {
            accumulated += event.text;
            const text = accumulated;
            updateLast(last => ({ ...last, text }));
          } else if (event.type === "done") {
            const suggestions = event.suggestions ?? [];
            const messageId   = event.message_id;
            updateLast(last => ({
              ...last,
              text:       accumulated,
              streaming:  false,
              id:         messageId,
              suggestions,
              timestamp:  new Date().toISOString(),
            }));
            // Trigger sidebar title refresh once title is saved in DB
            if (event.title && resolvedChatId && onTitleUpdate) {
              onTitleUpdate(resolvedChatId, event.title);
            }
          } else if (event.type === "error") {
            throw new Error(event.text || event.message || "Stream error");
          }
        }
      }
    } catch (err: unknown) {
      // Silently ignore aborted requests (user navigated away or started a new send)
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "";
      const expired      = msg.includes("401") || msg.includes("expired");
      const isNetworkErr = !msg || msg.includes("Failed to fetch") || msg.includes("NetworkError");
      setMessages(prev => {
        const updated = [...prev];
        const last    = updated[updated.length - 1];
        if (last?.streaming) {
          updated[updated.length - 1] = {
            ...last,
            text: expired
              ? "⚠️ Session expired. Please log in again."
              : isNetworkErr
                ? "⚠️ Could not reach the chat service. Make sure the RAG service is running on port 8600."
                : `⚠️ ${msg}`,
            streaming: false,
          };
        }
        return updated;
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
      sendingRef.current = false;
    }
  }

  // ── markdown renderer (bold + citation cleanup) ──────────────────────────
  function renderText(text: string) {
    // Strip raw [doc:UUID] citations — sources are shown in the panel below
    const cleaned = text.replace(/\s*\[doc:[^\]]+\]/g, "");
    const parts = cleaned.split(/(\*\*\*.*?\*\*\*|\*\*.*?\*\*)/gs);
    return parts.map((part, i) => {
      if (part.startsWith("***") && part.endsWith("***"))
        return <strong key={i}>{part.slice(3, -3)}</strong>;
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      return <span key={i}>{part}</span>;
    });
  }

  // ── toggle sources panel for a message index ──────────────────────────────
  function toggleSources(idx: number) {
    setOpenSources(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="h-full">
      <Card className="h-full flex flex-col shadow-md border border-border/60 rounded-2xl min-h-0 overflow-hidden">

        {/* Export button — only shown once there's content beyond the welcome */}
        {messages.length > 1 && (
          <div className="flex justify-end px-4 py-2 border-b border-border/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={exportChat}
              className="gap-1.5 text-muted-foreground hover:text-foreground text-xs h-7"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        )}

        {/* Messages */}
        <div ref={messagesRef} className="flex-1 overflow-auto space-y-4 p-4 min-h-0">
          {loading && messages.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Loading chat history…</p>
          )}

          {messages.map((msg, idx) => (
            <div key={msg.id ?? idx}>

              {/* Bubble row */}
              <div className={`flex gap-3 items-end ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <Avatar className="h-8 w-8 shrink-0 mb-1">
                  <AvatarFallback className={msg.role === "user"
                    ? "bg-blue-500/15 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 text-xs font-semibold"
                    : "bg-primary/15 text-primary text-xs font-semibold"
                  }>
                    {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>

                <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-muted/80 text-foreground border border-border/40 rounded-bl-sm"
                }`}>
                  <p className="whitespace-pre-wrap break-words leading-relaxed">
                    {renderText(msg.text)}
                    {/* Streaming cursor */}
                    {msg.streaming && (
                      <span className="inline-block w-0.5 h-4 bg-foreground/60 ml-0.5 animate-pulse align-middle" />
                    )}
                  </p>
                  {!msg.streaming && (
                    <p className={`text-xs mt-1.5 ${msg.role === "user" ? "text-blue-200" : "text-muted-foreground"}`}>
                      {formatLocalTime(msg.timestamp)}
                    </p>
                  )}
                </div>
              </div>

              {/* Sources panel (assistant, non-streaming, has sources) */}
              {msg.role === "assistant" && !msg.streaming && !!msg.sources?.length && (
                <div className="ml-11 mt-1.5">
                  <button
                    onClick={() => toggleSources(idx)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <BookOpen className="h-3 w-3" />
                    {msg.sources.length} source{msg.sources.length !== 1 ? "s" : ""}
                    {openSources.has(idx)
                      ? <ChevronUp className="h-3 w-3" />
                      : <ChevronDown className="h-3 w-3" />
                    }
                  </button>

                  {openSources.has(idx) && (
                    <div className="mt-1.5 space-y-1.5">
                      {msg.sources.map((src, si) => (
                        <div key={si} className="bg-muted/50 border border-border/30 rounded-lg px-3 py-2 text-xs">
                          <p className="font-medium text-foreground/80 mb-0.5">
                            {src.doc_title ?? `Source ${si + 1}`}
                          </p>
                          {src.text && (
                            <p className="text-muted-foreground line-clamp-2">{src.text}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Suggestion chips (assistant, non-streaming, has suggestions) */}
              {msg.role === "assistant" && !msg.streaming && !!msg.suggestions?.length && (
                <div className="ml-11 mt-2 flex flex-wrap gap-1.5">
                  {msg.suggestions.map((s, si) => (
                    <button
                      key={si}
                      onClick={() => {
                        setInput(s);
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                      className="text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-full px-3 py-1 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

            </div>
          ))}

          {/* Typing indicator (fallback — only if last message is user with no streaming) */}
          {loading && messages.length > 0 && messages[messages.length - 1].role === "user" && (
            <div className="flex gap-3 items-end">
              <Avatar className="h-8 w-8 shrink-0 mb-1">
                <AvatarFallback className="bg-primary/15 text-primary text-xs">
                  <Bot className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-muted/80 border border-border/40 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1.5 items-center">
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-border/60 bg-card/80">
          <form onSubmit={send} className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(e as any);
                }
              }}
              placeholder="Ask me anything about eye health and diabetic retinopathy..."
              disabled={loading}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ lineHeight: "1.6" }}
            />
            <Button type="submit" disabled={loading || !input.trim()} className="rounded-xl px-5 h-10">
              {loading ? "Generating…" : "Send"}
            </Button>
          </form>
        </div>

      </Card>
    </div>
  );
}
