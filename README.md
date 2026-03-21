# MeddyCare — AI-Powered Retinal Health Platform

> A full-stack, production-grade health-tech platform that uses deep learning to detect **Diabetic Retinopathy (DR)** from retina images, connects patients with verified eye specialists, and enables real-time doctor-patient consultations — all in one system.

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [How MeddyCare Solves It](#how-meddycare-solves-it)
3. [System Architecture](#system-architecture)
4. [Tech Stack](#tech-stack)
5. [Features by Role](#features-by-role)
6. [Full Flow — End to End](#full-flow--end-to-end)
7. [API Reference](#api-reference)
8. [Database Schema Design](#database-schema-design)
9. [Real-Time System (Socket.io)](#real-time-system-socketio)
10. [In-App Notifications](#in-app-notifications)
11. [ML Services](#ml-services)
12. [Cron Jobs & Email Notifications](#cron-jobs--email-notifications)
13. [Authentication & Security](#authentication--security)
14. [Project Structure](#project-structure)
15. [Local Development Setup](#local-development-setup)
16. [Environment Variables](#environment-variables)
17. [Deployment Guide](#deployment-guide)
18. [What Makes This Industrial-Grade](#what-makes-this-industrial-grade)
19. [Fault Tolerance](#fault-tolerance)
20. [Scalability — What Happens at 10k Users?](#scalability--what-happens-at-10k-users)

---

## Problem Statement

**Diabetic Retinopathy (DR)** is the leading cause of preventable blindness worldwide. Over 90 million people have some form of it, yet:

- **Most patients don't know they have it** — DR has no symptoms until it's advanced
- **Access to specialists is limited** — ophthalmologists and retina specialists are scarce, especially outside cities
- **Diagnosis is expensive and slow** — getting a retina scan reviewed can take weeks
- **Patients lack tools** for tracking eye health, managing appointments, or following up with doctors
- **Doctors lack a centralized platform** to manage patients, consultations, and follow-ups efficiently

---

## How MeddyCare Solves It

MeddyCare is a **vertically integrated health platform** that handles the complete DR care workflow:

```
Patient uploads retina image
        ↓
CNN model classifies DR stage (0–4) in seconds
        ↓
Patient gets detailed AI-generated report
        ↓
Patient finds a verified nearby specialist on the map (GPS-powered)
        ↓
Patient books an appointment or requests a consultation
        ↓
Doctor reviews the CNN report + chats with patient in real-time
        ↓
Doctor writes diagnosis + prescription
        ↓
Patient receives reminders for medications and follow-ups
        ↓
Patient chats with AI assistant (RAG — grounded in medical knowledge)
        ↓
Admin monitors everything via analytics dashboard
```

No more waiting weeks for a specialist to look at a scan. No more paper reports. No more missed follow-ups.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT BROWSER                          │
│           React 18 + TypeScript + Vite + Tailwind CSS           │
│    (Patient Dashboard / Doctor Dashboard / Admin Dashboard)     │
│          Lazy-loaded pages • Global error boundary              │
└──────────────────┬──────────────────────────┬───────────────────┘
                   │ REST API                  │ WebSocket
                   │ (axios)                   │ (socket.io-client)
                   ▼                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NODE.JS / EXPRESS SERVER                      │
│                        Port 3001                                │
│                                                                 │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Auth    │  │ Doctors  │  │ Reports  │  │ Appointments   │  │
│  │ Routes  │  │ Routes   │  │ Routes   │  │ Consultations  │  │
│  └─────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Admin   │  │ Upload   │  │Reminders │  │  Users/Profile │  │
│  │ Routes  │  │ Routes   │  │ Routes   │  │    Routes      │  │
│  └─────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                                                 │
│  ┌──────────────────┐   ┌──────────────────────────────────┐   │
│  │  Socket.io       │   │  node-cron                       │   │
│  │  (real-time)     │   │  Daily digest + minute alerts    │   │
│  └──────────────────┘   └──────────────────────────────────┘   │
└──────────┬──────────────────────────────────────────────────────┘
           │
    ┌──────┴──────────────────────────────────────────┐
    │                                                  │
    ▼                                                  ▼
┌───────────────────┐                    ┌────────────────────────┐
│   MongoDB Atlas   │                    │   External Services    │
│                   │                    │                        │
│  Users            │                    │  Cloudinary (images)   │
│  Doctors          │                    │  Nodemailer (email)    │
│  Appointments     │                    │  Nominatim (geocoding) │
│  Consultations    │                    └────────────────────────┘
│  Messages         │
│  Reports          │         ┌────────────────────────────────────────┐
│  Reminders        │         │     Python Microservices               │
│  AuditLogs        │         │                                        │
│  RAG chunks       │         │  CNN Service  (Port 8002)              │
│  RAG chats        │         │  ├── FastAPI + TensorFlow/Keras        │
└───────────────────┘         │  ├── model.h5 (DR classifier)         │
                              │  └── POST /predict                     │
                              │                                        │
                              │  RAG Service  (Port 8600)              │
                              │  ├── FastAPI (no LangChain)            │
                              │  ├── Qdrant Cloud (semantic search)    │
                              │  ├── BM25 + RRF fusion (hybrid)        │
                              │  ├── Groq llama-3.3-70b (generation)   │
                              │  ├── Groq llama-3.1-8b (reranking)     │
                              │  ├── Gemini (embeddings only)          │
                              │  ├── Per-user rate limiting (20/hr)    │
                              │  └── SSE streaming chat                │
                              └────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | React 18 + TypeScript | Type-safe UI, component reuse |
| **Styling** | Tailwind CSS + shadcn/ui | Rapid UI, consistent design system |
| **Routing** | React Router v6 | Nested, role-based protected routes |
| **Server State** | TanStack Query (React Query) | Caching, background refetch, optimistic updates |
| **Charts** | Recharts | Admin analytics with BarChart, LineChart, PieChart |
| **Maps** | React Leaflet + Nominatim | Free geospatial doctor search, no Google Maps billing |
| **Forms** | React Hook Form + Zod | Type-safe validation |
| **Real-time** | Socket.io (client + server) | Bidirectional, low-latency consultation chat + live notifications |
| **Backend** | Node.js + Express | Fast REST API, same port as Socket.io |
| **Database** | MongoDB Atlas + Mongoose | Document model fits medical records; aggregation pipelines for analytics; built-in geospatial |
| **Auth** | JWT (jsonwebtoken) + bcrypt | Stateless, role-based |
| **File Storage** | Cloudinary | Retina image hosting with transformations |
| **ML Model** | Python FastAPI + TensorFlow | DR classification, isolated microservice |
| **Vector DB** | Qdrant Cloud | ANN semantic search for RAG — free tier, fast cosine similarity |
| **Embeddings** | Google Gemini (`gemini-embedding-001`) | 3072-dim embeddings for chunk indexing and query encoding |
| **LLM Generation** | Groq (`llama-3.3-70b-versatile`) | Fast inference, 14,400 RPD free tier — no card required |
| **LLM Reranking** | Groq (`llama-3.1-8b-instant`) | Cheap second-stage relevance scoring, separate 20k TPM budget |
| **Hybrid Search** | BM25 + RRF fusion | Combines semantic (Qdrant ANN) + keyword (BM25) results |
| **Email** | Nodemailer + Gmail SMTP | Reminders, appointment notifications |
| **Scheduling** | node-cron | Daily digest + exact-time alerts |
| **Security** | Helmet + express-rate-limit | Security headers, rate limiting |
| **Deployment** | Render (Docker + Node) + Vercel | Zero-config CI/CD for all services |

---

## Features by Role

### Patient (role: `user`)
- Register / Login with email verification
- **Upload retina image** → receive instant DR classification report (stage 0–4)
- View reports history with confidence scores and AI-generated clinical analysis
- **Find nearby doctors** on an interactive map — GPS-based geolocation, distance and specialization filters
- Book appointments with verified specialists — 30-min time slots generated from doctor's availability, past slots auto-filtered for today
- **Request consultations** — attach a retina report, message the doctor in real-time
- Receive **real-time in-app notifications** when doctor confirms/rejects appointment or updates consultation
- Set reminders for medications, checkups, follow-ups
- **AI Chat (RAG)** — streaming responses, conversation history, auto-titled sessions, follow-up suggestions, shareable chat links
- Get email notifications — daily schedule digest at 8 AM, exact-time reminder alerts
- **Edit profile with avatar upload** — ProfileModal with Cloudinary integration and form validation

### Doctor (role: `doctor`)
- Register with license number, specialization, and **GPS-captured practice location** (auto-filled coordinates, no manual city entry)
- **Doctor Dashboard** — view pending/confirmed appointments on page load (no tab click needed)
- **Weekly availability editor** — set available days + custom hours (From/To time pickers per day), displayed to patients during booking
- **Consultation management** — review patient's retina reports, write diagnosis & prescription
- **Real-time chat** with patients — text + image messages, read receipts, typing indicators
- Update consultation status — in_review → completed / cancelled
- Auto-notified via **in-app notifications** when patient books appointment or creates consultation

### Admin (role: `admin`)
- **Overview Dashboard** — 8 KPI cards (total users, screenings, active doctors, appointments, consultations, high-risk patients, new this month, pending approvals)
- User health breakdown — active vs suspended vs verified doctors with progress bars
- **Analytics tab** — 6 live charts (screenings over time, new registrations, appointments bar, specialization pie, DR stage distribution, patient risk tiers)
- **Top doctors leaderboard** — ranked by consultation count with gold/silver/bronze badges
- Doctor verification — approve or revoke doctor credentials
- User management — search, suspend, unsuspend users
- **Audit logs** — full trail of all admin actions with IP and timestamp
- **Document ingestion** — ingest PDF files or URLs into the RAG knowledge base from the chat interface
- Create additional admin accounts

---

## Full Flow — End to End

### Flow 1: Patient Gets a DR Diagnosis

```
1. Patient registers → JWT issued immediately + email verification link sent
   (verification is optional — user can use the platform before verifying)
3. Patient uploads retina image:
   └── POST /api/v1/upload/image → Cloudinary
   └── Cloudinary returns imageUrl
4. Patient submits for analysis:
   └── POST /api/v1/reports/analyze {imageUrl}
   └── Backend → POST /predict (CNN microservice)
   └── CNN loads model.h5, runs image through 5-class classifier
   └── Returns {stage, stage_label, probabilities[5], report_text}
   └── Backend saves Report to MongoDB
   └── Frontend displays stage, confidence bar, AI clinical report
5. Patient sees "Stage 3 — Severe DR, 84% confidence" with full report
```

### Flow 2: Patient Finds a Doctor (GPS-powered)

```
1. Patient visits /doctors
   └── Browser asks for geolocation → lat/lng
   └── GET /api/v1/doctors/nearby?lat=&lng=&maxDistance=50
   └── MongoDB $near geospatial query returns sorted doctors
   └── Leaflet map shows doctor pins with popup cards
2. Doctor cards show distance, rating, specialization
3. Patient selects doctor → fills booking form
   └── POST /api/v1/appointments {doctorId, date, reason}
   └── Appointment saved with status: 'pending'
   └── Reminder auto-created for patient at appointment time
   └── Socket.io emits 'new_appointment' to doctor's personal room
4. Doctor sees real-time notification on dashboard (loads on page open)
   └── NotificationContext picks up 'new_appointment' → bell badge increments
   └── Doctor clicks Confirm → PATCH /api/v1/appointments/:id/confirm
   └── Appointment status → 'confirmed'
   └── Doctor reminder auto-created
   └── Socket.io emits 'appointment_updated' to patient
5. Patient's dashboard and notification bell update live
```

### Flow 3: Real-Time Doctor-Patient Consultation

```
1. Patient creates consultation, attaches retina report:
   └── POST /api/v1/consultations {doctorId, reportId, patientMessage}
   └── Socket.io emits 'new_consultation' to doctor
   └── Doctor's NotificationContext shows "New consultation request"
2. Both join consultation room:
   └── socket.emit('join_consultation', {consultationId})
   └── Server: socket.join('consultation:<id>')
3. Patient sends a message:
   └── socket.emit('send_message', {consultationId, text})
   └── Server validates, saves Message to MongoDB
   └── Broadcasts 'message_received' to consultation room
   └── Doctor sees message appear instantly
4. Doctor is typing → 'typing_status' event → "Doctor is typing..." shown
5. Doctor writes diagnosis:
   └── PATCH /api/v1/consultations/:id/diagnose {findings, severity, prescription}
   └── Socket.io emits 'consultation_updated' to room
   └── Patient sees status change to 'completed'
```

### Flow 4: RAG Chat — Streaming AI Response

```
1. Patient opens /chat → existing sessions loaded from sidebar
2. Patient types a question (e.g. "What is stage 3 DR?")
3. Frontend calls POST /api/rag/chat/stream (SSE)
4. Rate limiter checks: ≤ 20 requests/hour per user (429 if exceeded)
5. RAG service pipeline:
   └── Gemini embeds the query → 3072-dim vector
   └── Qdrant ANN search  → top-20 semantic candidates
   └── BM25 keyword search → top-20 keyword candidates
   └── RRF fusion          → merged ranked list
   └── Groq 8b reranker    → scores each passage 0-10, re-orders
   └── Groq 70b generator  → streams answer token-by-token
6. SSE events arrive on frontend:
   └── {type: "meta"}  → chat_id + source document references
   └── {type: "delta"} → streamed tokens rendered live
   └── {type: "done"}  → message_id + 3 follow-up suggestions + auto-title
7. Conversation history summarised after 8 turns (Groq 8b) — older turns
   compressed to a 2-3 sentence summary, last 4 turns kept raw
8. Patient can share the chat via a link (expires in 7 days)
```

### Flow 5: Admin Monitors the Platform

```
1. Admin logs in via admin-login endpoint
2. GET /api/v1/admin/stats → 14 parallel MongoDB queries via Promise.all
   └── totalUsers, totalReports, totalDoctors, pendingDoctors
   └── activeUsers, suspendedUsers, newUsersThisMonth
   └── highRiskPatients (stage >= 3), totalConsultations, totalAppointments
   └── DR stage distribution (aggregation pipeline)
   └── Patient risk tiers (Low/Medium/High computed from stage distribution)
3. GET /api/v1/admin/analytics → 9 aggregation pipelines
   └── Screenings by stage (bar chart)
   └── Screenings over time last 30 days (line chart)
   └── Appointment status breakdown (pie chart)
   └── Appointments over time (bar chart)
   └── Doctor specialization distribution (horizontal bar)
   └── Top 5 doctors by consultation count ($lookup leaderboard)
   └── New user registrations per day (line chart)
4. Admin verifies a doctor → PATCH /api/v1/admin/doctors/:id/verify
   └── AuditLog entry: {action: 'DOCTOR_VERIFIED', adminId, targetId, ip}
```

---

## API Reference

### Backend Base URL
```
Development:  http://localhost:3001/api/v1
Production:   https://meddycare-backend.onrender.com/api/v1
```

### RAG Service Base URL
```
Development:  http://localhost:8600/api/rag
Production:   https://meddycare-rag.onrender.com/api/rag
```

### Authentication Header
```
Authorization: Bearer <jwt_token>
```

### Backend Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Register patient |
| `POST` | `/auth/register-doctor` | Public | Register doctor (pending verify) |
| `POST` | `/auth/login` | Public | Patient/doctor login |
| `POST` | `/auth/admin-login` | Public | Admin login |
| `GET` | `/auth/me` | User | Get current user |
| `POST` | `/auth/refresh` | Public | Refresh JWT token |
| `GET` | `/auth/verify-email` | Public | Email verification |
| `POST` | `/auth/resend-verification` | User | Resend verification email |
| `POST` | `/auth/logout` | User | Invalidate token |
| `PUT` | `/users/profile` | User | Update profile (name, phone, gender, DOB, avatar) |
| `PUT` | `/users/password` | User | Change password (requires current password) |
| `PUT` | `/users/medical-history` | User | Update medical history |
| `PUT` | `/users/eye-data` | User | Update eye examination data |
| `DELETE` | `/users/profile` | User | Delete account |
| `GET` | `/doctors/nearby` | User | Geospatial doctor search |
| `GET` | `/doctors` | User | List doctors with filters |
| `GET` | `/doctors/:id` | User | Doctor details |
| `GET` | `/doctors/me` | Doctor | Get own doctor profile |
| `PUT` | `/doctors/:id` | Doctor | Update doctor profile |
| `GET` | `/doctors/:id/slots` | User | Available appointment slots by date |
| `POST` | `/doctors/:id/reviews` | User | Add review (1–5 stars) |
| `GET` | `/doctors/analytics` | Doctor | Consultation/rating analytics |
| `POST` | `/reports/analyze` | User | Submit retina image for DR analysis |
| `GET` | `/reports` | User | Get user's report history |
| `POST` | `/appointments` | User | Book appointment |
| `GET` | `/appointments` | User | Get user's appointments |
| `GET` | `/appointments/doctor` | Doctor | Get doctor's appointments |
| `PATCH` | `/appointments/:id/confirm` | Doctor | Confirm appointment |
| `PATCH` | `/appointments/:id/reject` | Doctor | Reject appointment |
| `PATCH` | `/appointments/:id/cancel` | User | Patient cancels appointment |
| `POST` | `/consultations` | User | Request consultation with report |
| `GET` | `/consultations` | User | Get patient's consultations |
| `GET` | `/consultations/doctor` | Doctor | Get doctor's consultations |
| `GET` | `/consultations/:id` | User/Doctor | Consultation details |
| `PATCH` | `/consultations/:id/diagnose` | Doctor | Write diagnosis + prescription |
| `PATCH` | `/consultations/:id/status` | Doctor | Update status |
| `GET` | `/consultations/:id/messages` | User/Doctor | Paginated message history |
| `POST` | `/consultations/:id/messages` | User/Doctor | Send message (HTTP fallback) |
| `GET` | `/reminders` | User | Get reminders |
| `POST` | `/reminders` | User | Create reminder |
| `PATCH` | `/reminders/:id/complete` | User | Mark complete |
| `DELETE` | `/reminders/:id` | User | Delete reminder |
| `POST` | `/upload/image` | User | Upload retina image to Cloudinary |
| `POST` | `/upload/profile-image` | User | Upload profile avatar |
| `DELETE` | `/upload/:publicId` | User/Admin | Delete Cloudinary image (ownership enforced) |
| `GET` | `/admin/stats` | Admin | Overview KPIs (14 metrics) |
| `GET` | `/admin/analytics` | Admin | Charts and trends (9 pipelines) |
| `GET` | `/admin/users` | Admin | User list with search/pagination |
| `PATCH` | `/admin/users/:id/suspend` | Admin | Suspend/unsuspend user |
| `GET` | `/admin/doctors` | Admin | Doctor list |
| `PATCH` | `/admin/doctors/:id/verify` | Admin | Verify/unverify doctor |
| `POST` | `/admin/create-admin` | Admin | Create new admin account |
| `GET` | `/admin/audit-logs` | Admin | Admin action logs with pagination |
| `GET` | `/api/health` | Public | Server health check |

### RAG Service Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/chat/stream` | User | SSE streaming RAG chat (primary) |
| `POST` | `/chat` | User | Non-streaming RAG chat (fallback) |
| `GET` | `/chats` | User | List user's chat sessions |
| `GET` | `/chats/:id/messages` | User | Get messages for a chat |
| `PATCH` | `/chats/:id` | User | Rename or archive a chat |
| `DELETE` | `/chats/:id` | User | Delete a chat |
| `POST` | `/chats/:id/share` | User | Create shareable link (7-day expiry) |
| `GET` | `/s/:token` | Public | View shared chat (HTML or JSON) |
| `GET` | `/documents` | User | List ingested documents |
| `GET` | `/documents/:id` | User | Get document metadata |
| `DELETE` | `/documents/:id` | Admin | Delete document + its vectors |
| `POST` | `/ingest/url` | Admin | Ingest a URL into knowledge base |
| `POST` | `/ingest/pdf` | Admin | Ingest a PDF into knowledge base |
| `GET/HEAD` | `/` (root) | Public | Health check for uptime monitoring |

---

## Database Schema Design

### Why MongoDB (not SQL)?

- Medical records are semi-structured — eye data, medical history vary per patient
- Aggregation pipelines make analytics expressive without JOINs
- Built-in `$near` geospatial operator for doctor proximity search
- Document model naturally represents nested records (diagnosis + prescription in one document)

### Schema Relationships

```
User ──────────── Doctor (1:1, user ref in Doctor doc)
User ──────────── Report (1:many)
User ──────────── Appointment (1:many, as patient)
Doctor ─────────── Appointment (1:many, as doctor)
Appointment ──── Reminder (1:many via appointmentRef)
Report ─────────── Consultation (1:1, report ref)
Consultation ──── Message (1:many)
User ──────────── Reminder (1:many)
Admin ──────────── AuditLog (1:many)
User ──────────── RAG Chat (1:many, in RAG service DB)
RAG Chat ──────── RAG Message (1:many)
RAG Document ──── RAG Chunk (1:many, text in MongoDB, vectors in Qdrant)
```

### Key Indexes

```javascript
doctorSchema.index({ "location.coordinates": "2dsphere" });   // geo search
reportSchema.index({ user: 1, createdAt: -1 });               // report history
messageSchema.index({ consultationId: 1, timestamp: 1 });     // chat pagination
reminderSchema.index({ user: 1, scheduledAt: 1 });            // cron query
appointmentSchema.index({ user: 1, date: 1 });
appointmentSchema.index({ doctor: 1, date: 1 });
consultationSchema.index({ patient: 1, createdAt: -1 });
consultationSchema.index({ doctor: 1, status: 1, createdAt: -1 });
// RAG service:
chats_col.index({ user_id: 1, updated_at: -1 });
messages_col.index({ chat_id: 1, timestamp: 1 });
```

### DR Stage Classification

| Stage | Label | Description |
|---|---|---|
| 0 | No DR | Healthy retina |
| 1 | Mild | Microaneurysms only |
| 2 | Moderate | More than mild, less than severe |
| 3 | Severe | Extensive retinal changes |
| 4 | Proliferative DR | New blood vessel growth — most critical |

---

## Real-Time System (Socket.io)

Socket.io runs on the **same port as Express** (HTTP upgrade mechanism).

### Room Strategy

```
consultation:<id>   → all participants of a consultation (patient + doctor)
user:<userId>       → personal room for targeted push events
```

### Event Map

| Direction | Event | Payload | Purpose |
|---|---|---|---|
| Client → Server | `join_consultation` | `{consultationId}` | Join chat room |
| Client → Server | `send_message` | `{consultationId, text, type}` | Send message |
| Client → Server | `typing` | `{consultationId, isTyping}` | Typing indicator |
| Client → Server | `mark_read` | `{consultationId, messageIds[]}` | Mark messages read |
| Server → Client | `message_received` | `{consultationId, message}` | Broadcast new message |
| Server → Client | `typing_status` | `{senderRole, isTyping}` | Show/hide typing |
| Server → Client | `messages_read` | `{messageIds[], readByRole}` | Update read receipts |
| Server → Client | `consultation_updated` | `{consultationId, status}` | Status change push |
| Server → Client | `new_consultation` | `{consultation}` | Doctor gets new case |
| Server → Client | `new_appointment` | `{appointmentId, patientName}` | Doctor gets booking |
| Server → Client | `appointment_updated` | `{appointmentId, status, doctorName/patientName}` | Patient/Doctor gets confirm/cancel |
| Server → Client | `message_notification` | `{consultationId, senderName, message}` | Push to recipient's personal room |
| Server → Client | `account_suspended` | `{}` | Target user forced logout |
| Server → Client | `account_unsuspended` | `{}` | Target user notified |
| Server → Client | `profile_updated` | `{isVerified}` | Doctor verification status changed |
| Server → Client | `admin_stats_updated` | `{type}` | All admins notified of new registrations |

### Guards
- JWT verified on every socket handshake
- Suspended users are rejected at connection
- Rate limited: 10 messages per 10 seconds per socket
- Image messages validated against Cloudinary URL pattern
- Message text capped at 2000 characters

---

## In-App Notifications

MeddyCare includes a **real-time notification system** via `NotificationContext` — powered by Socket.io events and surfaced in the SiteHeader notification bell.

### How It Works

```
Socket.io event arrives (e.g. 'new_appointment', 'consultation_updated')
        ↓
NotificationContext listener fires
        ↓
Notification added to in-memory state (capped at 50 most recent)
        ↓
Bell icon badge increments (unread count)
        ↓
User opens notification dropdown → sees all notifications
        ↓
"Mark all read" / dismiss individual / clear all
```

### Notification Types (8 Socket.io Events)

| Type | Event | Who Receives | Example |
|---|---|---|---|
| `appointment` | `new_appointment` | Doctor | "Patient X has booked an appointment with you" |
| `appointment` | `appointment_updated` | Patient / Doctor | "Appointment Confirmed ✓" / "Appointment Declined" / "Cancelled" |
| `consultation` | `new_consultation` | Doctor | "Patient X has requested a consultation for their retina report" |
| `consultation` | `consultation_updated` | Patient / Doctor | "In Review" / "Consultation Completed ✓" / "Cancelled" |
| `consultation` | `message_notification` | Recipient | "Message from Dr. X" / "Message from Patient" (suppressed if viewing that consultation) |
| `info` | `account_suspended` | Target user | "Your account has been suspended by an administrator" |
| `info` | `account_unsuspended` | Target user | "Your account suspension has been lifted" |
| `info` | `profile_updated` | Doctor | "Your doctor profile has been verified ✓" / "Verification removed" |

---

## ML Services

### CNN Service — Diabetic Retinopathy Classifier

**Endpoint:** `POST http://localhost:8002/predict`

**Input:**
```json
{ "image_url": "https://res.cloudinary.com/.../retina.jpg" }
```

**Output:**
```json
{
  "stage": 2,
  "stage_label": "Moderate DR",
  "probabilities": [0.03, 0.08, 0.71, 0.12, 0.06],
  "report": "The retinal image shows characteristics consistent with Moderate Diabetic Retinopathy...",
  "model_input_shape": [224, 224, 3]
}
```

- Pre-trained CNN in `model.h5` (~18 MB)
- 5-class softmax output (one per DR stage)
- `confidence = max(probabilities)`
- Results persisted to MongoDB `Report` collection
- Rate-limited: 20 analyses per 10 minutes per user

### RAG Service — AI Health Chat

**Port:** 8600 | **Base path:** `/api/rag`

A fully custom RAG pipeline — no LangChain. Every component is hand-wired for performance and observability.

#### Retrieval Pipeline (2-stage)

```
User query
    ↓
Rate limiter → 20 requests/hour per user (sliding window, in-memory)
    ↓
Gemini embeds query → 3072-dim vector
    ↓
Stage 1 — Hybrid Search (broad recall, fast)
    ├── Qdrant ANN search → top-20 semantic candidates (cosine similarity)
    └── BM25 keyword search → top-20 keyword candidates (in-memory, MongoDB-backed)
              ↓
         RRF fusion → merged ranked list (best of semantic + keyword)
    ↓
Stage 2 — LLM Reranker (precise scoring, cheap)
    └── Groq llama-3.1-8b-instant → scores each passage 0-10 → re-ordered top-K
    ↓
Groq llama-3.3-70b-versatile → streams answer via SSE
```

#### Why this architecture?

| Decision | Reason |
|---|---|
| Qdrant over MongoDB Vector | Dedicated ANN index, faster at scale, free cloud tier |
| Groq over Gemini for generation | Gemini free tier exhausts daily `generate_content` quota quickly; Groq gives 14,400 RPD with no card |
| BM25 + RRF hybrid | Semantic search alone misses exact medical terms; BM25 catches them; RRF fuses both without tuning weights |
| Separate 8b reranker model | 8b has its own 20k TPM budget independent of 70b's 6k TPM — reranking doesn't eat into generation quota |
| Gemini kept for embeddings | `gemini-embedding-001` produces high-quality 3072-dim vectors; embedding quota is much more generous than generation |
| Per-user rate limiting | Sliding window (20/hr) prevents quota exhaustion from individual users without needing Redis |

#### Key Features

- **SSE streaming** — tokens stream to the browser as they're generated
- **Conversation memory** — last messages loaded; older turns summarised to 2-3 sentences after 8 turns to stay within context limits (keeps last 4 raw turns)
- **Auto-titling** — first message in a new chat triggers a title generation (Groq 8b)
- **Follow-up suggestions** — 3 suggested questions generated after each answer
- **Chat sharing** — shareable read-only link with 7-day expiry, rendered as styled HTML or JSON
- **Document ingestion** — admin can ingest PDFs (up to 20MB) or URLs; chunks split recursively (800 words, 100-word overlap), embedded, stored in Qdrant + MongoDB
- **Rate limiting** — 20 chat requests per hour per user (sliding window, in-memory)
- **Graceful degradation** — if Qdrant/Groq fail, chat continues without retrieved context; if reranker fails, RRF order is preserved
- **Message deduplication** — frontend deduplicates via MongoDB `_id` field

---

## Cron Jobs & Email Notifications

### Job 1 — Daily Digest (08:00 AM IST, every day)

Sends each user a styled HTML email with their day's schedule:

```
Subject: "MeddyCare — Your schedule for today"

Appointments — doctor name, time, status (green = confirmed, yellow = pending)
Reminders — title, time, description
```

### Job 2 — Exact-Time Alerts (every minute)

Polls reminders with `scheduledAt` in the last 60-second window:

```
Subject: "Reminder: [title]"
Body: Personalized HTML with reminder details
```

**Deduplication:** `notificationSent: true` flag ensures no duplicate emails for the same reminder.

### Email Config (Gmail)

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=yourapp@gmail.com
EMAIL_PASS=<Gmail App Password>   # Generate at myaccount.google.com → Security → App Passwords
```

> Without these env vars set, emails log to console — no crash, graceful dev fallback.

---

## Authentication & Security

### JWT Flow

```
1. Login → server issues JWT (default 60m expiry, configurable via ACCESS_TOKEN_EXPIRE_MINUTES)
2. Client stores token in localStorage
3. Every API request: Authorization: Bearer <token>
4. 401 received → auto-refresh token → retry original request (deduplicated refresh promise)
5. Refresh fails → dispatch 'auth-expired' event → force logout
6. Session validation polling every 60 seconds
```

The same `JWT_SECRET_KEY` is shared across all three services (backend, RAG service) — so a token issued at login works seamlessly for RAG chat requests without a second login.

### Role-Based Access Control

| Role | Dashboard | Can Access |
|---|---|---|
| `user` | `/dashboard` | Reports, Chat, Doctors, Reminders, Appointments, Consultations |
| `doctor` | `/doctor` | Everything above + Doctor management routes |
| `admin` | `/admin` | All routes + Admin panel + Audit logs + Document ingestion + Admin creation |

### Security Measures

| Concern | Implementation |
|---|---|
| Security headers | Helmet (XSS, HSTS, CSP, etc.) |
| Rate limiting | 200 req/15 min per IP (global), 100 auth/15 min, 20 analyses/10 min per user, 20 RAG chats/hr per user, 10 socket msgs/10s |
| Password hashing | bcrypt with salt rounds |
| Input validation | express-validator on all POST/PATCH routes, Zod on frontend |
| Image ownership | Cloudinary delete validates image belongs to requesting user |
| Suspension check | Auth middleware rejects suspended users on every request |
| Real-time suspension | Socket.io event forces immediate logout on suspension |
| Audit trail | All admin actions logged: action, adminId, targetId, IP, timestamp |
| CORS | Restricted to known frontend origins (regex + exact match) |
| RAG auth | JWT verified on every RAG request using the same secret as the main backend |
| Socket.io auth | JWT verified on handshake, per-socket message rate limiting |
| Environment validation | Backend exits immediately if required env vars are missing |

---

## Project Structure

```
MeddyCare/
├── backend/
│   ├── middleware/auth.js          # JWT verification, role guards (auth/adminAuth/doctorAuth)
│   ├── models/
│   │   ├── User.js                 # Patients + admins + doctors user accounts
│   │   ├── Doctor.js               # Doctor profiles with GeoJSON location
│   │   ├── Appointment.js          # Appointment bookings
│   │   ├── Consultation.js         # Consultation requests + diagnosis + prescription
│   │   ├── Message.js              # Real-time chat messages with read tracking
│   │   ├── Report.js               # Retina scan + DR analysis results
│   │   ├── Reminder.js             # Medication/checkup reminders
│   │   ├── AuditLog.js             # Admin action trail
│   │   └── FailedJob.js            # Dead letter queue for failed email jobs
│   ├── routes/
│   │   ├── auth.js                 # Register, login, email verify, refresh, logout
│   │   ├── users.js                # Profile management
│   │   ├── doctors.js              # Geo search, reviews, profiles, slots, analytics
│   │   ├── appointments.js         # Booking, confirm, reject, cancel
│   │   ├── consultations.js        # Consultation lifecycle + messaging
│   │   ├── reports.js              # DR analysis + history
│   │   ├── reminders.js            # CRUD + complete
│   │   ├── upload.js               # Cloudinary image upload (retina + profile avatar)
│   │   └── admin.js                # Stats, analytics, user/doctor management, audit logs
│   ├── server.js                   # Express + Socket.io entrypoint, env validation
│   ├── socket.js                   # All Socket.io event handlers + rate limiting
│   ├── cache.js                    # In-memory TTL cache (statsCache, doctorListCache)
│   ├── cron.js                     # Scheduled jobs + Nodemailer email templates + DLQ retry
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── layout/SiteHeader.tsx   # Role-aware nav + notification bell + theme toggle
│       │   ├── layout/SiteFooter.tsx
│       │   ├── chat_components/        # ChatWindow (SSE streaming), ChatSidebar
│       │   ├── ProfileModal.tsx        # Edit profile + avatar upload (Cloudinary)
│       │   ├── DoctorMap.tsx           # Leaflet map with doctor/clinic pins
│       │   ├── ProtectedRoute.tsx      # Role-based route guard
│       │   └── ui/                     # shadcn/ui components (30+)
│       ├── contexts/
│       │   ├── AuthContext.tsx          # Auth state, token refresh, session polling
│       │   └── NotificationContext.tsx  # Real-time in-app notifications via Socket.io
│       ├── hooks/
│       │   ├── use-socket.ts           # Singleton Socket.io hook with ref counting
│       │   ├── use-theme.ts            # Dark/light mode
│       │   └── use-mobile.tsx          # Responsive breakpoint
│       ├── lib/api.ts                  # Axios API service — all endpoints, auto-retry on 401
│       ├── pages/
│       │   ├── Index.tsx               # Landing page
│       │   ├── Auth.tsx                # Login / Register / Doctor signup
│       │   ├── Chat.tsx                # AI chat + RAG (streaming)
│       │   ├── Doctors.tsx             # Doctor search + Leaflet map
│       │   ├── Reminders.tsx           # Reminder management
│       │   ├── Reports.tsx             # Report viewer + analysis
│       │   ├── user/UserDashboard.tsx  # Patient dashboard with charts
│       │   ├── doctor/DoctorDashboard.tsx  # Doctor dashboard (5 tabs)
│       │   └── admin/AdminDashboard.tsx    # Admin dashboard (5 tabs)
│       └── App.tsx                     # Routes + providers + lazy loading + error boundary
│
├── cnn_service/
│   ├── predict_service.py          # FastAPI DR image classifier
│   ├── model.h5                    # Pre-trained CNN weights (~18 MB)
│   └── Dockerfile
│
├── rag_service/
│   ├── main.py                     # FastAPI app, lifespan, CORS
│   ├── config.py                   # All env vars with defaults
│   ├── auth.py                     # JWT verification (shared secret with backend)
│   ├── clients.py                  # Gemini + Groq client singletons, batch embeddings
│   ├── db.py                       # Motor (async MongoDB) collections + indexes
│   ├── models.py                   # Pydantic request/response schemas
│   ├── chat_routes.py              # All RAG endpoints (chat, chats, documents, share, ingest)
│   ├── vectorstore.py              # Qdrant ANN + BM25 keyword + RRF hybrid search
│   ├── reranker.py                 # Groq 8b LLM reranker (stage 2 retrieval)
│   ├── ingest.py                   # PDF + URL ingestion, recursive chunking (800w / 100w overlap)
│   ├── resilience.py               # Circuit breaker + retry decorator (tenacity)
│   ├── rate_limiter.py             # Per-user sliding-window rate limiting (20/hr)
│   ├── clients.py                  # Gemini + Groq client singletons with retry + circuit breaker
│   ├── requirements.txt
│   └── Dockerfile
│
└── render.yaml                     # Render deployment config (3 services)
```

---

## Local Development Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- MongoDB Atlas account (free M0 tier)
- Cloudinary account (free tier)
- Google AI Studio API key (for embeddings)
- Groq API key (free — no card required at console.groq.com)
- Qdrant Cloud cluster (free tier at cloud.qdrant.io)

### 1. Backend

```bash
cd backend
npm install
# Create .env with values from the Environment Variables section below
npm run dev     # nodemon, port 3001
```

### 2. Frontend

```bash
cd frontend
npm install
# Create .env.local
echo "VITE_API_BASE_URL=http://localhost:3001/api/v1" > .env.local
echo "VITE_RAG_API_BASE_URL=http://localhost:8600/api/rag" >> .env.local
echo "VITE_PREDICT_API_URL=http://localhost:8002" >> .env.local
npm run dev     # Vite, port 5174
```

### 3. CNN Service

```bash
cd cnn_service
pip install fastapi uvicorn tensorflow pillow requests
# Ensure model.h5 is present
uvicorn predict_service:app --port 8002 --reload
```

### 4. RAG Service

```bash
cd rag_service
pip install -r requirements.txt
# Create .env with values from the Environment Variables section below
uvicorn main:app --port 8600 --reload
```

---

## Environment Variables

### Backend `.env`

```env
NODE_ENV=development
PORT=3001

# MongoDB
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/meddycare

# Auth
JWT_SECRET_KEY=<random-32-char-hex>
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Microservices
RAG_SERVICE_URL=http://localhost:8600
PREDICT_SERVICE_URL=http://localhost:8002

# Frontend (for CORS)
FRONTEND_URL=http://localhost:5174

# Email (optional in dev — falls back to console.log)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=yourapp@gmail.com
EMAIL_PASS=your-gmail-app-password
```

### RAG Service `.env`

```env
PORT=8600

# MongoDB (same cluster as backend — stores chat history and chunk texts)
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/meddycare
MONGODB_DB=meddycare

# Qdrant Cloud — cloud.qdrant.io → free tier → cluster URL + API key
QDRANT_HOST=https://<cluster-id>.us-west-1-0.aws.cloud.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key
QDRANT_COLLECTION=meddycare_chunks   # auto-created on first run

# Google Gemini — used for embeddings only
GOOGLE_GENAI_API_KEY=your_gemini_key
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIM=3072

# Groq — used for generation + reranking (free, no card required)
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_RERANK_MODEL=llama-3.1-8b-instant

# Auth (must match backend JWT_SECRET_KEY exactly)
JWT_SECRET_KEY=<same-secret-as-backend>

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
ALLOWED_ORIGIN_REGEX=https://meddy-care-.*\.vercel\.app
```

### Frontend `.env.local`

```env
VITE_API_BASE_URL=http://localhost:3001/api/v1
VITE_RAG_API_BASE_URL=http://localhost:8600/api/rag
VITE_PREDICT_API_URL=http://localhost:8002
```

---

## Deployment Guide

### Stack: Render + Vercel + MongoDB Atlas + Qdrant Cloud (all free tiers available)

```
Vercel (Frontend SPA)
       ↓  HTTPS REST + WebSocket
Render (Backend Node.js)  ←→  MongoDB Atlas
       ↓
Render (CNN Docker)    — DR image classifier
Render (RAG Docker)    — Health chat + document RAG  ←→  Qdrant Cloud
```

---

### Step 1 — MongoDB Atlas

1. Go to mongodb.com/atlas → Create free M0 cluster
2. Create a DB user with read/write access
3. Network Access → Add IP: `0.0.0.0/0` (allows Render's dynamic IPs)
4. Copy the connection string → use as `MONGODB_URI`

---

### Step 2 — Qdrant Cloud

1. Go to cloud.qdrant.io → Create free cluster
2. Copy the cluster URL → `QDRANT_HOST`
3. Generate an API key → `QDRANT_API_KEY`
4. The collection (`meddycare_chunks`) is auto-created on first RAG service startup

---

### Step 3 — Deploy Backend on Render

1. Go to render.com → **New Web Service**
2. Connect GitHub repo, set:
   - **Root Directory:** `./backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
3. Add environment variables (all from the backend `.env` above, with `NODE_ENV=production` and `PORT=10000`)

---

### Step 4 — Deploy CNN Service on Render

1. **New Web Service** → Docker runtime
2. Root Directory: `./cnn_service`
3. Env var: `ICARE_MODEL_PATH=/app/model.h5`
4. Ensure `model.h5` is committed to the repo (use Git LFS if >100MB)

---

### Step 5 — Deploy RAG Service on Render

1. **New Web Service** → Docker runtime
2. Root Directory: `./rag_service`
3. Add all env vars from the RAG `.env` section above (especially `GROQ_API_KEY`, `QDRANT_HOST`, `QDRANT_API_KEY`)
4. `JWT_SECRET_KEY` must match the backend exactly

---

### Step 6 — Deploy Frontend on Vercel

```bash
npx vercel
# or connect GitHub repo at vercel.com for auto-deploy
```

Set environment variables on Vercel:
```
VITE_API_BASE_URL=https://meddycare-backend.onrender.com/api/v1
VITE_RAG_API_BASE_URL=https://meddycare-rag.onrender.com/api/rag
VITE_PREDICT_API_URL=https://meddycare-predict.onrender.com
```

---

### Alternative Hosting Options

| Platform | Best For | Notes |
|---|---|---|
| **Render + Vercel** | Portfolio / demo | Free tier, easy setup — recommended |
| **Railway** | All-in-one | Simpler UI, all services on one platform |
| **AWS (EC2 + S3 + ECS)** | Production scale | Full control, higher cost |
| **DigitalOcean App Platform** | Managed hosting | Good middle ground |
| **Fly.io** | Low-latency edge | Machines auto-scale |
| **Self-hosted VPS** | Full control | nginx + PM2 for Node, Docker for Python services |

---

### Deployment Cost Estimate

| Service | Platform | Free Tier | Paid |
|---|---|---|---|
| Frontend | Vercel | Free | — |
| Database | MongoDB Atlas M0 | Free | $57/mo (M10) |
| Vector DB | Qdrant Cloud | Free (1GB) | $25/mo |
| Backend | Render | Free (sleeps after 15 min) | $7/mo (always-on) |
| CNN Service | Render | Free (sleeps) | $7/mo |
| RAG Service | Render | Free (sleeps) | $7/mo |
| **Total** | | **Free** | **~$46/mo** |

> Free tier services on Render spin down after 15 min of inactivity. First request after sleep takes ~30s. For demos, this is fine.

---

## What Makes This Industrial-Grade

| Concern | Implementation |
|---|---|
| **Security** | Helmet headers, multi-tier rate limiting (IP + user + endpoint), bcrypt, JWT refresh with dedup, input validation, ownership checks on file delete, env validation on startup |
| **Real-time** | Socket.io with room-based architecture, per-socket rate limiting, JWT-verified handshake, in-app notification system via NotificationContext |
| **RAG pipeline** | 2-stage retrieval: hybrid search (Qdrant ANN + BM25 + RRF) → LLM reranker → streaming generation, per-user rate limiting |
| **Frontend resilience** | Lazy-loaded pages (React.lazy + Suspense), global error boundary, auto-refresh tokens with deduplicated promise, session polling |
| **Observability** | AuditLog for all admin actions with IP, timestamp, action type, and target |
| **Scalability** | Stateless JWT, Socket.io rooms (can scale to Redis adapter), MongoDB Atlas with indexes, Qdrant scales independently |
| **Error handling** | Global Express error handler, per-route try/catch, RAG graceful degradation (chat works even if Qdrant fails, reranker falls back to RRF order) |
| **Data integrity** | `Reminder.updateMany` on appointment cancel/reject — clears ALL linked reminders atomically |
| **Notification dedup** | `notificationSent` flag prevents duplicate cron emails on same reminder |
| **Graceful degradation** | Email falls back to console.log; RAG chat falls back to no-context generation if vector store fails; reranker falls back to RRF order |
| **Fault tolerance** | Retry with exponential backoff on all external API calls (Groq, Google, Qdrant); circuit breakers short-circuit when services are down; dead letter queue for failed cron jobs with automatic retry |
| **Performance** | Compound DB indexes on all hot query paths, `Promise.all` for parallel queries in admin stats, SSE streaming for perceived speed, code-split lazy loading |
| **LLM cost control** | 8b model for reranking (20k TPM) + titling + summarisation; 70b only for final generation (6k TPM) — separate budgets avoid quota exhaustion |
| **Conversation memory** | Rolling summarisation at 8-turn threshold keeps context window bounded without losing history (last 4 turns kept raw) |
| **Type safety** | TypeScript frontend, Zod validation, Pydantic v2 in RAG service, typed Socket.io event payloads |
| **Clean separation** | Routes → Middleware → Models; dedicated `socket.js`; `cron.js`; RAG has its own vectorstore/reranker/clients/rate_limiter modules |
| **ML isolation** | CNN runs as independent Docker microservice — can be scaled or swapped without touching main backend |

---

## Fault Tolerance

MeddyCare implements three production fault-tolerance patterns — all zero-cost, pure code — to handle transient failures gracefully instead of crashing or silently losing data.

### 1. Retry with Exponential Backoff

**Problem:** External API calls (Groq LLM, Google Embeddings, Qdrant) can fail transiently — timeouts, rate-limits (429), temporary outages (503).

**Solution:** All external calls automatically retry up to 3 times with exponential backoff + jitter (1s → 2s → 4s ± random jitter to avoid thundering herd).

| Layer | Implementation | What's Retried |
|---|---|---|
| **RAG service (Python)** | `tenacity` library with custom `with_retry()` decorator in [`resilience.py`](rag_service/resilience.py) | Groq generation, Groq reranking, Google embedding calls |
| **Frontend (TypeScript)** | Retry loop in `request()` / `ragRequest()` in [`api.ts`](frontend/src/lib/api.ts) | 502, 503, 504, 429, network failures (`Failed to fetch`, `AbortError`) — up to 2 retries with 1s/2s/4s backoff |

```
Request fails (503)
    → wait 1s → retry
        → fails again (timeout)
            → wait 2s → retry
                → succeeds ✓
```

### 2. Circuit Breaker

**Problem:** If Groq or Google Embeddings is fully down, retrying every request wastes time and quota. Users experience slow failures instead of fast, clear feedback.

**Solution:** A per-service circuit breaker ([`resilience.py`](rag_service/resilience.py)) tracks consecutive failures and short-circuits calls when a service is unhealthy.

```
State machine:

  CLOSED ──(5 consecutive failures)──→ OPEN ──(30s cooldown)──→ HALF-OPEN
     ↑                                                              │
     └──────────────(probe succeeds)────────────────────────────────┘
                                                                    │
     OPEN ←──────────(probe fails)──────────────────────────────────┘
```

| State | Behavior |
|---|---|
| **CLOSED** | Normal operation. Failures increment a counter. |
| **OPEN** | All calls rejected immediately with a user-friendly message ("AI service temporarily unavailable"). No API call made. |
| **HALF-OPEN** | After 30s cooldown, one probe request is allowed. If it succeeds → CLOSED. If it fails → back to OPEN. |

Two independent breakers: `groq_breaker` (LLM generation + reranking) and `embeddings_breaker` (Google GenAI embeddings). The streaming chat endpoint checks the circuit before spawning the generation thread — if Groq is OPEN, users get an instant error instead of a 30s timeout.

### 3. Dead Letter Queue (DLQ)

**Problem:** Cron jobs (email notifications, reminder alerts) fail silently — if SMTP is temporarily down, users never get notified and the failure is lost.

**Solution:** Failed email jobs are saved to a `failed_jobs` MongoDB collection (using your existing database — $0 cost) and retried automatically with exponential backoff.

```
Cron job fires
    → sendEmail() fails
        → save to failed_jobs collection {type, payload, error, attempts: 1, nextRetryAt: now + 1min}
            → DLQ retry cron (every 15 min) picks it up
                → retry succeeds → delete from collection ✓
                → retry fails → increment attempts, nextRetryAt = now + 4^attempt minutes
                    → after 4 total failures → mark as 'dead' (admin-visible, no more retries)
```

| Field | Purpose |
|---|---|
| `type` | `daily_digest_email` or `reminder_alert_email` |
| `payload` | `{to, subject, html}` — everything needed to re-send |
| `attempts` / `maxAttempts` | Current retry count / cap (default 4) |
| `nextRetryAt` | Exponential backoff: 1 min → 4 min → 16 min |
| `status` | `pending` (retryable) or `dead` (exhausted) |

The [`FailedJob`](backend/models/FailedJob.js) model includes compound indexes on `(status, nextRetryAt)` for efficient retry queries.

### Cost Summary

| Pattern | Library / Infra | Cost |
|---|---|---|
| Retry + Backoff | `tenacity` (Python), vanilla JS | **$0** |
| Circuit Breaker | Pure Python class (in-memory) | **$0** |
| Dead Letter Queue | MongoDB collection (existing DB) | **$0** |

---

## Scalability — What Happens at 10k Users?

> **Note:** This section is a **scaling roadmap**, not current infrastructure. The system currently runs on free-tier single instances — which is appropriate for a portfolio demo. The point is that the architecture was designed from day one to scale horizontally without a rewrite. Below is the concrete plan for when scale demands it.

MeddyCare's architecture is already stateless (JWT, no server-side sessions), services are isolated (backend, CNN, RAG), and the database supports sharding — so scaling is **additive** (add infrastructure) rather than a rewrite.

### Current Architecture → Scaled Architecture

```
CURRENT (demo / single-instance)

  Vercel CDN ──→ 1x Express + Socket.io ──→ MongoDB Atlas M0
                         │                         ↑
                  1x CNN Service              1x RAG Service ──→ Qdrant Cloud


SCALED (10k+ concurrent users)

                    ┌──────────────┐
                    │  Vercel CDN  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Load Balancer│  (Render auto-scale / nginx / AWS ALB)
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────▼┐ ┌▼────────┐ ┌▼────────┐
              │Express+  │ │Express+  │ │Express+  │   ← horizontal pods
              │Socket.io │ │Socket.io │ │Socket.io │
              └────┬─────┘ └────┬─────┘ └────┬─────┘
                   │            │            │
              ┌────▼────────────▼────────────▼────┐
              │          Redis (pub/sub)           │  ← @socket.io/redis-adapter
              │    + BullMQ job queues             │    Upstash free tier
              └────────────────┬──────────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
   MongoDB Atlas M10    CNN Workers (2x)    RAG Service (2x) → Qdrant Cloud
   (connection pool)    (process queue)     (independent scale)
```

### Bottleneck-by-Bottleneck Scaling Plan

| # | Bottleneck | What Breaks | Solution | Cost |
|---|---|---|---|---|
| 1 | **Socket.io is single-process** — one server holds all connections in memory | 2nd instance can't see messages from 1st | **Redis adapter** (`@socket.io/redis-adapter`) — all instances share events via Redis pub/sub. ~5 lines of code change. | Upstash Redis free tier (10k cmds/day) |
| 2 | **Cron jobs on every instance** — duplicate emails when scaled to 2+ pods | User gets 2x emails | **BullMQ job queue** (Redis-backed) — one worker picks each job, guaranteed no duplicates | Same Redis instance |
| 3 | **CNN prediction blocks the request** — 5-10s per image | Express thread is locked, other requests queue up | **Queue CNN jobs via BullMQ** — return a job ID instantly, push result via Socket.io when done | Same Redis instance |
| 4 | **Single Express server** — CPU-bound at high request concurrency | Slow API responses, socket timeouts | **Horizontal scaling** behind a load balancer — Render auto-scales, or nginx reverse proxy on VPS | Render: $7/instance |
| 5 | **MongoDB Atlas M0** — 500 connections, 512 MB storage | Connection pool exhausted | **M10** ($57/mo) for 1500 connections, or tune `maxPoolSize` to share connections across pods | $57/mo when needed |
| 6 | **In-memory rate limiter** (RAG service) — resets on restart, per-instance | Rate limits don't apply across instances | **Redis-backed sliding window** — shared rate limit state across all RAG pods | Same Redis instance |
| 7 | **BM25 index in-memory** — rebuilds from MongoDB on every restart | Slow cold start, memory bloat with large corpus | **MongoDB Atlas Search** (free on M0+) — built-in BM25, no application-side index | Free |

### Why This Works Without a Rewrite

The current architecture already has the right foundations:

- **Stateless JWT** — any backend instance can verify any token, no sticky sessions needed
- **Socket.io rooms** — the room abstraction (`consultation:<id>`, `user:<userId>`) works unchanged with the Redis adapter; it just extends rooms across processes
- **Isolated microservices** — CNN and RAG are independent Docker containers; scaling them means running more containers, not touching backend code
- **MongoDB indexes** — compound indexes on all hot paths (`doctor + date`, `user + createdAt`) mean query time stays constant as data grows
- **Qdrant scales independently** — managed cloud, automatic sharding, no operational burden

### Scaling Cost Estimate (when the time comes)

| Scale | Infra | Monthly Cost |
|---|---|---|
| **Demo** (current) | All free tiers | **$0** |
| **1k users** | Add Upstash Redis (free) + Render always-on ($7×3) | **~$21/mo** |
| **10k users** | Redis paid ($10) + MongoDB M10 ($57) + Render scaled ($7×5) | **~$100/mo** |
| **50k+ users** | AWS/GCP managed services, auto-scaling groups, CDN | **$300-500/mo** |

> **Why this section exists:** Interviewers ask "how would you scale this?" to test system design thinking — not to check if you deployed Redis for a portfolio project. This roadmap demonstrates that every bottleneck has a known, standard solution, and the current architecture was intentionally built to accept these additions with minimal code changes. The scaling path is _additive_ — add Redis, add a queue, add instances — not a rewrite.

---

## Accounts Required

| Service | Purpose | Cost |
|---|---|---|
| [MongoDB Atlas](https://mongodb.com/atlas) | Database | Free |
| [Cloudinary](https://cloudinary.com) | Image storage | Free |
| [Google AI Studio](https://aistudio.google.com) | Gemini embeddings | Free |
| [Groq](https://console.groq.com) | LLM generation + reranking | Free (no card) |
| [Qdrant Cloud](https://cloud.qdrant.io) | Vector database | Free (1GB) |
| [Render](https://render.com) | Backend hosting | Free |
| [Vercel](https://vercel.com) | Frontend hosting | Free |
| Gmail | Email notifications | Free (App Password required) |

---

> Built by Mayank Kumar — Full-Stack AI Health Platform demonstrating MERN stack, Socket.io real-time architecture (8-event notification system), CNN-based ML microservices, production RAG pipeline (hybrid search + LLM reranking + SSE streaming + circuit breakers), real-time in-app notifications, geospatial doctor discovery with OpenStreetMap, cron-based email system with dead letter queue, in-memory caching, and production system design patterns (retry + circuit breaker + DLQ).
