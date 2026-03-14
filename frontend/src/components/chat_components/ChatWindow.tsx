import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { User, Bot } from "lucide-react";
import apiService from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
  id?: string;
}

interface Props {
  chatId: string | null;
  onNewChat?: (chatId: string) => void;
}

export default function ChatWindow({ chatId, onNewChat }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Root ref covers the whole chat window (messages + input)
  const rootRef = useRef<HTMLDivElement | null>(null);
  // messagesRef used for scrolling
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // New refs & state for autofocus behavior
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [allowAutoFocus, setAllowAutoFocus] = useState(true);

  // Welcome message...
  const welcomeMessage: Message = {
    role: "assistant",
    text: "Welcome to MeddyCare's support — Our assistant can help interpret results, explain next steps, and guide you to relevant resources.",
    timestamp: new Date().toISOString(),
  };

  const formatLocalTime = (utcTimestamp: string) => {
    const date = new Date(utcTimestamp);
    return date.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  // scroll-to-bottom when messages change (use messagesRef)
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;

    let raf1: number | null = null;
    let raf2: number | null = null;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      });
    });

    return () => {
      if (raf1 !== null) cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
  }, [messages]);

  useEffect(() => {
    async function loadHistory() {
      if (!chatId) {
        // Show welcome message when no chat is selected
        setMessages([welcomeMessage]);
        return;
      }

      try {
        setLoading(true);
        const data = await apiService.ragGetMessages(chatId);
        setMessages(
          (data.messages || []).map((m: any) => ({
            role: m.role,
            text: m.text,
            timestamp: m.timestamp,
          }))
        );
      } catch (err) {
        console.error("Error loading history", err);
        setMessages([
          {
            role: "assistant",
            text: "⚠️ Error loading chat history. Please refresh the page.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [chatId]);

  const normalizeToIso = (ts?: any): string => {
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
      const d = new Date(ts);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    return new Date().toISOString();
  };

  const mergeHistory = (
    serverMsgs: any[],
    currentMsgs: Message[]
  ): Message[] => {
    const serverMap = new Map<string, any>();
    for (const m of serverMsgs) {
      const key = m.id ?? `${m.role}|${m.text}`;
      serverMap.set(key, {
        role: m.role,
        text: m.text,
        timestamp: normalizeToIso(m.timestamp),
        id: m.id,
      });
    }

    const merged: Message[] = Array.from(serverMap.values()).map((m: any) => ({
      role: m.role,
      text: m.text,
      timestamp: m.timestamp,
      id: m.id,
    }));

    for (const c of currentMsgs) {
      const key = (c as any).id ?? `${c.role}|${c.text}`;
      if (!serverMap.has(key)) {
        merged.push({
          role: c.role,
          text: c.text,
          timestamp: c.timestamp ?? new Date().toISOString(),
          id: (c as any).id,
        });
      }
    }

    merged.sort((a, b) => {
      const ta = Date.parse(a.timestamp ?? "") || 0;
      const tb = Date.parse(b.timestamp ?? "") || 0;
      return ta - tb;
    });

    return merged;
  };

  // Click detection on the whole chat window (rootRef)
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;

      if (root.contains(e.target as Node)) {
        // clicked inside chat window (messages OR input) -> allow autofocus and focus the input
        setAllowAutoFocus(true);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
      } else {
        // clicked outside -> disable auto-focus until user clicks back inside
        setAllowAutoFocus(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Whenever messages change or loading finishes, focus input if allowed.
  useEffect(() => {
    if (!allowAutoFocus) return;

    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    return () => clearTimeout(t);
  }, [messages.length, loading, allowAutoFocus]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const inputText = input;
    setInput("");

    const userMessage: Message = {
      role: "user",
      text: inputText,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const data = await apiService.ragSendMessage(inputText, chatId);

      const currentChatId = chatId || data.chat_id;
      if (!chatId && data.chat_id && onNewChat) {
        onNewChat(data.chat_id);
      }

      const assistantOptimistic: Message = {
        role: "assistant",
        text: data.answer,
        timestamp: new Date().toISOString(),
        id: data.message_id ?? undefined,
      };
      setMessages((prev) => [...prev, assistantOptimistic]);

      const fetchAndMergeHistory = async () => {
        try {
          const historyData = await apiService.ragGetMessages(currentChatId);
          const allMessages = historyData.messages || [];

          if (allMessages.length > 0) {
            const formatted = allMessages.map((m: any) => ({
              role: m.role,
              text: m.text,
              timestamp: normalizeToIso(m.timestamp),
              id: m.id,
            }));

            setMessages((current) => mergeHistory(formatted, current));
            return true;
          }
          return false;
        } catch (err) {
          console.error("Immediate refresh failed", err);
          return false;
        }
      };

      (async () => {
        const ok = await fetchAndMergeHistory();
        if (!ok) {
          setTimeout(async () => {
            try {
              const ok2 = await fetchAndMergeHistory();
              if (!ok2) {
                console.warn(
                  "History still empty after retry — will rely on later refresh."
                );
              }
            } catch (err) {
              console.error("Retry history fetch error", err);
            }
          }, 700);
        }
      })();
    } catch (err: any) {
      console.error("Send error:", err);
      const errorMessage: Message = {
        role: "assistant",
        text:
          err?.status === 401
            ? "⚠️ Session expired. Please log in again."
            : "⚠️ Could not reach the chat service. Make sure the RAG service is running on port 8600.",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  }

  const renderMessageText = (text: string) => {
    const parts = text.split(/(\*\*\*\s*\*.*?\*|\*\*\*.*?\*\*\*|\*\*.*?\*\*)/g);

    return parts.map((part, index) => {
      if (part.match(/^\*\*\*\s*\*.*\*$/)) {
        const boldText = part.replace(/^\*\*\*\s*\*|\*$/g, "");
        return (
          <strong key={index} className="font-bold">
            {boldText}
          </strong>
        );
      }

      if (part.startsWith("***") && part.endsWith("***")) {
        const boldText = part.replace(/^\*\*\*|\*\*\*$/g, "");
        return (
          <strong key={index} className="font-bold">
            {boldText}
          </strong>
        );
      }

      if (
        part.startsWith("**") &&
        part.endsWith("**") &&
        !part.startsWith("***")
      ) {
        const boldText = part.replace(/^\*\*|\*\*$/g, "");
        return (
          <strong key={index} className="font-bold">
            {boldText}
          </strong>
        );
      }

      return <span key={index}>{part}</span>;
    });
  };

  return (
    // rootRef covers the entire chat window including input
    <div ref={rootRef} className="h-full">
      <Card className="h-full flex flex-col shadow-sm min-h-0">
        {/* Messages Container - takes most of the space */}
        <div
          ref={messagesRef}
          className="flex-1 overflow-auto space-y-2 p-2 min-h-0"
        >
          {loading && messages.length === 0 && (
            <div className="text-center text-muted-foreground">
              Loading chat history...
            </div>
          )}
          {messages.map((message, idx) => (
            <div
              key={idx}
              className={`flex gap-2 items-start ${
                message.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback
                  className={
                    message.role === "user"
                      ? "bg-blue-100 text-blue-600"
                      : "bg-green-100 text-green-600"
                  }
                >
                  {message.role === "user" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <Bot className="h-4 w-4" />
                  )}
                </AvatarFallback>
              </Avatar>

              <div
                className={`max-w-[80%] rounded-md px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-blue-500 text-white ml-auto"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">
                  {renderMessageText(message.text)}
                </p>

                {/* Timestamp */}
                {message.timestamp && (
                  <p
                    className={`text-xs mt-1 ${
                      message.role === "user"
                        ? "text-blue-100"
                        : "text-gray-500"
                    }`}
                  >
                    {formatLocalTime(message.timestamp)}
                  </p>
                )}
              </div>
            </div>
          ))}
          {/* Loading indicator for assistant response */}
          {loading &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "user" && (
              <div className="flex gap-2 items-start">
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback className="bg-green-100 text-green-600">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="bg-gray-100 rounded-md px-3 py-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full delay-100 animate-pulse"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full delay-200 animate-pulse"></div>
                  </div>
                </div>
              </div>
            )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form - tighter at bottom */}
        <div className="p-2 border-t bg-white">
          <form onSubmit={send} className="flex gap-2">
            <Input
              // use our ref and programmatic focus logic instead of relying solely on autoFocus
              ref={inputRef as any}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything about eye health and diabetic retinopathy..."
              disabled={loading}
              className="flex-1"
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              {loading ? "Sending..." : "Send"}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}