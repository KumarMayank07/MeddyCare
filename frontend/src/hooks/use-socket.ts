/**
 * use-socket.ts
 *
 * Manages a single Socket.io connection per browser session.
 * Connects with JWT from localStorage, reconnects automatically.
 *
 * Usage:
 *   const { socket, connected } = useSocket();
 *
 * The hook returns the same socket instance on every render.
 * The socket connects lazily on first call and disconnects on unmount
 * of the last subscriber (via reference counting).
 */

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

// Strip /api/v1 (or legacy /api) to get the bare server origin for Socket.io
const SOCKET_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/api(\/v\d+)?$/, "") ?? "http://localhost:3001";

// Module-level singleton — shared across all hook instances
let globalSocket: Socket | null = null;
let socketToken: string = "";
let subscriberCount = 0;

function getSocket(): Socket {
  const token = localStorage.getItem("token") ?? "";

  // Recreate socket if token changed (e.g. after re-login) or socket is gone
  if (globalSocket && token !== socketToken) {
    globalSocket.disconnect();
    globalSocket = null;
  }

  if (!globalSocket || (!globalSocket.connected && !globalSocket.active)) {
    socketToken = token;
    globalSocket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
  }
  return globalSocket;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    subscriberCount += 1;
    const socket = getSocket();
    socketRef.current = socket;

    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("connect",    onConnect);
    socket.on("disconnect", onDisconnect);

    // Sync initial state
    setConnected(socket.connected);

    return () => {
      socket.off("connect",    onConnect);
      socket.off("disconnect", onDisconnect);

      subscriberCount -= 1;
      if (subscriberCount === 0 && globalSocket) {
        globalSocket.disconnect();
        globalSocket = null;
      }
    };
  }, []);

  return { socket: socketRef.current, connected };
}

// ─── Typed event payloads ─────────────────────────────────────────────────────

export interface SocketMessage {
  _id: string;
  senderId: string;
  senderRole: "patient" | "doctor";
  type: "text" | "image";
  text?: string;
  imageUrl?: string;
  readBy: { user: string; readAt: string }[];
  timestamp: string;
}

export interface SocketMessageReceivedPayload {
  consultationId: string;
  message: SocketMessage;
}

export interface SocketTypingPayload {
  senderRole: "patient" | "doctor";
  isTyping: boolean;
}

export interface SocketMessagesReadPayload {
  messageIds: string[];
  readByRole: "patient" | "doctor";
}

export interface SocketConsultationUpdatedPayload {
  consultationId: string;
  status: string;
}
