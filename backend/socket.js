/**
 * socket.js — Real-time chat handler for MeddyCare
 *
 * Architecture:
 *   - One Socket.io room per consultation: "consultation:<id>"
 *   - JWT verified on every connection (handshake)
 *   - Participant check before any room join
 *   - Message persistence via Message collection (NOT embedded in Consultation)
 *   - Rate limiting: 10 messages per 10 seconds per socket
 *
 * Events (Client → Server):
 *   join_consultation    { consultationId }
 *   leave_consultation   { consultationId }
 *   send_message         { consultationId, text, type, imageUrl? }
 *   typing               { consultationId, isTyping }
 *   mark_read            { consultationId, messageIds[] }
 *
 * Events (Server → Client):
 *   message_received     { message, consultationId }
 *   typing_status        { senderRole, isTyping }
 *   messages_read        { messageIds[], readByRole }
 *   consultation_updated { consultationId, status }
 *   error                { message }
 */

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import Consultation from './models/Consultation.js';
import Doctor from './models/Doctor.js';
import Message from './models/Message.js';

// ─── Rate limiter ─────────────────────────────────────────────────────────────
// Simple in-memory per-socket token bucket (10 messages / 10 seconds)
const rateLimits = new Map(); // socketId → { count, resetAt }

function checkRateLimit(socketId) {
  const now = Date.now();
  const entry = rateLimits.get(socketId) || { count: 0, resetAt: now + 10_000 };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 10_000;
  }

  entry.count += 1;
  rateLimits.set(socketId, entry);
  return entry.count <= 10;
}

// ─── Room name helper ─────────────────────────────────────────────────────────
const roomName = (consultationId) => `consultation:${consultationId}`;

// ─── ObjectId validation ──────────────────────────────────────────────────────
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─── Participant check ────────────────────────────────────────────────────────
// Returns 'patient' | 'doctor' | null
async function getParticipantRole(userId, consultationId) {
  const consultation = await Consultation.findById(consultationId)
    .populate('doctor', 'user');

  if (!consultation) return null;

  if (consultation.patient.toString() === userId.toString()) return 'patient';

  if (consultation.doctor?.user?.toString() === userId.toString()) return 'doctor';

  return null;
}

// ─── Main setup ───────────────────────────────────────────────────────────────
export function setupSocket(io) {

  // ── Authentication middleware on every connection ──────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) return next(new Error('User not found'));
      if (user.isSuspended) return next(new Error('Account suspended'));

      socket.user = user; // attach to socket for later handlers
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.user._id})`);

    // Join a personal room so we can push targeted events (new_consultation, appointment_updated, etc.)
    socket.join(`user:${socket.user._id}`);

    // ── join_consultation ──────────────────────────────────────────────────
    socket.on('join_consultation', async ({ consultationId }) => {
      try {
        if (!consultationId || !isValidObjectId(consultationId)) {
          socket.emit('error', { message: 'Valid consultationId is required' });
          return;
        }

        const role = await getParticipantRole(socket.user._id, consultationId);
        if (!role) {
          socket.emit('error', { message: 'Access denied to this consultation' });
          return;
        }

        socket.join(roomName(consultationId));
        socket.consultationRooms = socket.consultationRooms || new Set();
        socket.consultationRooms.add(consultationId);

        console.log(`User ${socket.user._id} (${role}) joined room ${roomName(consultationId)}`);
      } catch (err) {
        console.error('join_consultation error:', err);
        socket.emit('error', { message: 'Failed to join consultation' });
      }
    });

    // ── leave_consultation ─────────────────────────────────────────────────
    socket.on('leave_consultation', ({ consultationId }) => {
      socket.leave(roomName(consultationId));
      socket.consultationRooms?.delete(consultationId);
    });

    // ── send_message ───────────────────────────────────────────────────────
    socket.on('send_message', async ({ consultationId, text, type = 'text', imageUrl }) => {
      try {
        // Rate limit
        if (!checkRateLimit(socket.id)) {
          socket.emit('error', { message: 'Too many messages. Slow down.' });
          return;
        }

        if (!consultationId || !isValidObjectId(consultationId)) {
          socket.emit('error', { message: 'Valid consultationId is required' });
          return;
        }

        // Verify type
        if (!['text', 'image'].includes(type)) {
          socket.emit('error', { message: 'Invalid message type' });
          return;
        }

        if (type === 'text') {
          if (!text?.trim()) {
            socket.emit('error', { message: 'text is required for text messages' });
            return;
          }
          if (text.length > 2000) {
            socket.emit('error', { message: 'Message too long (max 2000 characters)' });
            return;
          }
        }

        // For image messages, validate URL is from our Cloudinary cloud
        if (type === 'image') {
          if (!imageUrl) {
            socket.emit('error', { message: 'imageUrl required for image messages' });
            return;
          }
          const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
          const validPrefix = `https://res.cloudinary.com/${cloudName}/`;
          if (!cloudName || !imageUrl.startsWith(validPrefix)) {
            socket.emit('error', { message: 'Invalid image URL: must be a Cloudinary asset from this platform' });
            return;
          }
        }

        // Verify participant and get role
        const senderRole = await getParticipantRole(socket.user._id, consultationId);
        if (!senderRole) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Verify consultation is open
        const consultation = await Consultation.findById(consultationId).select('status');
        if (!consultation) {
          socket.emit('error', { message: 'Consultation not found' });
          return;
        }
        if (consultation.status === 'cancelled') {
          socket.emit('error', { message: 'Cannot send messages on a cancelled consultation' });
          return;
        }

        // Persist message to the Message collection
        const saved = await Message.create({
          consultationId,
          senderId:   socket.user._id,
          senderRole,
          type,
          text:       type === 'text' ? text.trim() : (text?.trim() || undefined),
          imageUrl:   type === 'image' ? imageUrl : undefined,
          readBy:     [{ user: socket.user._id, readAt: new Date() }],
          timestamp:  new Date(),
        });

        // Broadcast to everyone in the room (including sender for confirmation)
        io.to(roomName(consultationId)).emit('message_received', {
          consultationId,
          message: {
            _id:        saved._id,
            senderId:   socket.user._id,
            senderRole,
            type,
            text:       saved.text,
            imageUrl:   saved.imageUrl,
            readBy:     saved.readBy,
            timestamp:  saved.timestamp,
          },
        });

      } catch (err) {
        console.error('send_message error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ── typing ─────────────────────────────────────────────────────────────
    socket.on('typing', async ({ consultationId, isTyping }) => {
      try {
        if (!consultationId || !isValidObjectId(consultationId)) return;
        const senderRole = await getParticipantRole(socket.user._id, consultationId);
        if (!senderRole) return;

        // Broadcast to everyone in room EXCEPT sender
        socket.to(roomName(consultationId)).emit('typing_status', {
          senderRole,
          isTyping: !!isTyping,
        });
      } catch { /* silent — typing is non-critical */ }
    });

    // ── mark_read ──────────────────────────────────────────────────────────
    socket.on('mark_read', async ({ consultationId, messageIds }) => {
      try {
        if (!consultationId || !isValidObjectId(consultationId)) return;
        if (!Array.isArray(messageIds) || messageIds.length === 0) return;

        // Validate every messageId is a valid ObjectId to prevent injection
        const validIds = messageIds.filter(id => isValidObjectId(id));
        if (validIds.length === 0) return;

        const senderRole = await getParticipantRole(socket.user._id, consultationId);
        if (!senderRole) return;

        // Add readBy entry for this user on all matching unread messages
        await Message.updateMany(
          {
            _id:            { $in: validIds },
            consultationId,
            'readBy.user':  { $ne: socket.user._id },
          },
          {
            $push: { readBy: { user: socket.user._id, readAt: new Date() } },
          }
        );

        // Notify the other party their messages were read
        socket.to(roomName(consultationId)).emit('messages_read', {
          messageIds: validIds,
          readByRole: senderRole,
        });
      } catch (err) {
        console.error('mark_read error:', err);
      }
    });

    // ── disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      rateLimits.delete(socket.id);
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}

// ─── Exported emitter helpers ─────────────────────────────────────────────────
// Called from REST routes to push real-time updates for non-message events

let _io = null;

export function setIo(io) {
  _io = io;
}

export function emitConsultationUpdated(consultationId, status) {
  if (_io) {
    _io.to(roomName(consultationId)).emit('consultation_updated', { consultationId, status });
  }
}

export function emitToUser(userId, event, data) {
  if (_io) {
    _io.to(`user:${userId}`).emit(event, data);
  }
}
