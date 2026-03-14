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
10. [ML Services](#ml-services)
11. [Cron Jobs & Email Notifications](#cron-jobs--email-notifications)
12. [Authentication & Security](#authentication--security)
13. [Project Structure](#project-structure)
14. [Local Development Setup](#local-development-setup)
15. [Environment Variables](#environment-variables)
16. [Deployment Guide](#deployment-guide)
17. [What Makes This Industrial-Grade](#what-makes-this-industrial-grade)

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
Patient finds a verified nearby specialist on the map
        ↓
Patient books an appointment or requests a consultation
        ↓
Doctor reviews the CNN report + chats with patient in real-time
        ↓
Doctor writes diagnosis + prescription
        ↓
Patient receives reminders for medications and follow-ups
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
│  │ Admin   │  │ Upload   │  │Reminders │  │  Chat Routes   │  │
│  │ Routes  │  │ Routes   │  │ Routes   │  │ (Gemini AI)    │  │
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
│  Doctors          │                    │  Google Gemini AI      │
│  Appointments     │                    │  Nodemailer (email)    │
│  Consultations    │                    │  Nominatim (geocoding) │
│  Messages         │                    └────────────────────────┘
│  Reports          │
│  Reminders        │         ┌────────────────────────────────────┐
│  AuditLogs        │         │     Python Microservices           │
└───────────────────┘         │                                    │
                              │  CNN Service  (Port 8002)          │
                              │  ├── FastAPI + TensorFlow/Keras    │
                              │  ├── model.h5 (DR classifier)      │
                              │  └── POST /predict                 │
                              │                                    │
                              │  RAG Service  (Port 8600)          │
                              │  ├── FastAPI + LangChain           │
                              │  ├── MongoDB Vector Store          │
                              │  └── POST /api/rag/chat            │
                              └────────────────────────────────────┘
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
| **Real-time** | Socket.io (client + server) | Bidirectional, low-latency consultation chat |
| **Backend** | Node.js + Express | Fast REST API, same port as Socket.io |
| **Database** | MongoDB Atlas + Mongoose | Document model fits medical records; aggregation pipelines for analytics; built-in geospatial |
| **Auth** | JWT (jsonwebtoken) + bcrypt | Stateless, role-based, refresh token support |
| **File Storage** | Cloudinary | Retina image hosting with transformations |
| **AI Chat** | Google Gemini 1.5 Pro | Medical Q&A, symptom analysis, education |
| **ML Model** | Python FastAPI + TensorFlow | DR classification, isolated microservice |
| **RAG** | FastAPI + LangChain + MongoDB Vector | Knowledge-grounded health education |
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
- **Find nearby doctors** on an interactive map with distance, rating, specialization filters
- Book appointments with verified specialists
- **Request consultations** — attach a retina report, message the doctor in real-time
- Receive real-time updates when doctor confirms/rejects appointment
- Set reminders for medications, checkups, follow-ups
- **Chat with AI** — Gemini-powered health Q&A, symptom checker, educational content
- Get email notifications — daily schedule digest at 8 AM, exact-time reminder alerts

### Doctor (role: `doctor`)
- Register with license number and specialization (pending admin verification)
- **Doctor Dashboard** — view pending/confirmed appointments in real-time
- **Consultation management** — review patient's retina reports, write diagnosis & prescription
- **Real-time chat** with patients — text + image messages, read receipts, typing indicators
- Update consultation status — in_review → completed / cancelled
- Auto-notified when patient books appointment or creates consultation

### Admin (role: `admin`)
- **Overview Dashboard** — 8 KPI cards (total users, screenings, active doctors, appointments, consultations, high-risk patients, new this month, pending approvals)
- User health breakdown — active vs suspended vs verified doctors with progress bars
- **Analytics tab** — 6 live charts (screenings over time, new registrations, appointments bar, specialization pie, DR stage distribution, patient risk tiers)
- **Top doctors leaderboard** — ranked by consultation count with gold/silver/bronze badges
- Doctor verification — approve or revoke doctor credentials
- User management — search, suspend, unsuspend users
- **Audit logs** — full trail of all admin actions with IP and timestamp

---

## Full Flow — End to End

### Flow 1: Patient Gets a DR Diagnosis

```
1. Patient registers → receives email verification link
2. Patient logs in → JWT issued, stored in localStorage
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

### Flow 2: Patient Books an Appointment

```
1. Patient visits /doctors
   └── Browser asks for geolocation → lat/lng
   └── GET /api/v1/doctors/nearby?lat=&lng=&maxDistance=50
   └── MongoDB $near geospatial query returns sorted doctors
   └── Leaflet map shows doctor pins with popup cards
2. Patient selects doctor → fills booking form
   └── POST /api/v1/appointments {doctorId, date, reason}
   └── Appointment saved with status: 'pending'
   └── Reminder auto-created for patient at appointment time
   └── Socket.io emits 'new_appointment' to doctor's personal room
3. Doctor sees real-time notification on dashboard (no refresh needed)
   └── Doctor clicks Confirm → PATCH /api/v1/appointments/:id/confirm
   └── Appointment status → 'confirmed'
   └── Doctor reminder auto-created
   └── Socket.io emits 'appointment_updated' to patient
4. Patient's dashboard updates live
```

### Flow 3: Real-Time Doctor-Patient Consultation

```
1. Patient creates consultation, attaches retina report:
   └── POST /api/v1/consultations {doctorId, reportId, patientMessage}
   └── Socket.io emits 'new_consultation' to doctor
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

### Flow 4: Admin Monitors the Platform

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

### Base URL
```
Development:  http://localhost:3001/api/v1
Production:   https://<your-render-backend-url>/api/v1
```

### Authentication Header
```
Authorization: Bearer <jwt_token>
```

### Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Register patient |
| `POST` | `/auth/register-doctor` | Public | Register doctor (pending verify) |
| `POST` | `/auth/login` | Public | Patient/doctor login |
| `POST` | `/auth/admin-login` | Public | Admin login |
| `GET` | `/auth/me` | User | Get current user |
| `POST` | `/auth/refresh` | Public | Refresh JWT token |
| `GET` | `/auth/verify-email` | Public | Email verification |
| `GET` | `/doctors/nearby` | User | Geospatial doctor search |
| `GET` | `/doctors` | User | List doctors with filters |
| `GET` | `/doctors/:id` | User | Doctor details |
| `PUT` | `/doctors/:id` | Doctor | Update doctor profile |
| `POST` | `/doctors/:id/reviews` | User | Add review (1–5 stars) |
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
| `PATCH` | `/consultations/:id/diagnose` | Doctor | Write diagnosis + prescription |
| `PATCH` | `/consultations/:id/status` | Doctor | Update status |
| `GET` | `/consultations/:id/messages` | User/Doctor | Paginated message history |
| `GET` | `/reminders` | User | Get reminders |
| `POST` | `/reminders` | User | Create reminder |
| `PATCH` | `/reminders/:id/complete` | User | Mark complete |
| `DELETE` | `/reminders/:id` | User | Delete reminder |
| `POST` | `/upload/image` | User | Upload retina image to Cloudinary |
| `POST` | `/upload/profile-image` | User | Upload profile picture |
| `POST` | `/chat/ask` | User | AI health Q&A (Gemini) |
| `POST` | `/chat/symptoms` | User | Symptom analysis (Gemini) |
| `POST` | `/chat/education` | User | Educational content (Gemini) |
| `GET` | `/admin/stats` | Admin | Overview KPIs (14 metrics) |
| `GET` | `/admin/analytics` | Admin | Charts and trends (9 pipelines) |
| `GET` | `/admin/users` | Admin | User list with search/pagination |
| `PATCH` | `/admin/users/:id/suspend` | Admin | Suspend/unsuspend user |
| `GET` | `/admin/doctors` | Admin | Doctor list |
| `PATCH` | `/admin/doctors/:id/verify` | Admin | Verify/unverify doctor |
| `GET` | `/admin/audit-logs` | Admin | Admin action logs |
| `GET` | `/api/health` | Public | Server health check |

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
```

### Key Indexes

```javascript
doctorSchema.index({ "location.coordinates": "2dsphere" });   // geo search
reportSchema.index({ user: 1, createdAt: -1 });               // report history
messageSchema.index({ consultationId: 1, timestamp: 1 });     // chat pagination
reminderSchema.index({ user: 1, scheduledAt: 1 });            // cron query
appointmentSchema.index({ user: 1, date: 1 });
appointmentSchema.index({ doctor: 1, date: 1 });
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
| Server → Client | `new_appointment` | `{appointment}` | Doctor gets booking |
| Server → Client | `appointment_updated` | `{appointmentId, status}` | Patient gets confirm/cancel |

### Guards
- JWT verified on every socket handshake
- Suspended users are rejected at connection
- Rate limited: 10 messages per 10 seconds per socket

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
- Rate-limited: 2 analyses per 2 minutes per user

### RAG Service — Health Education Chat

**Port:** 8600

- FastAPI + LangChain
- MongoDB Atlas Vector Search for document retrieval
- Google Gemini for grounded response generation
- JWT-verified (same secret as main backend)
- Used for educational Q&A that requires factual grounding beyond Gemini's training

---

## Cron Jobs & Email Notifications

### Job 1 — Daily Digest (08:00 AM IST, every day)

Sends each user a styled HTML email with their day's schedule:

```
Subject: "MeddyCare — Your schedule for today"

📅 Appointments — doctor name, time, status (green = confirmed, yellow = pending)
🔔 Reminders — title, time, description
```

### Job 2 — Exact-Time Alerts (every minute)

Polls reminders with `scheduledAt` in the last 60-second window:

```
Subject: "🔔 Reminder: [title]"
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
1. Login → server issues JWT (default 24h expiry)
2. Client stores token in localStorage
3. Every API request: Authorization: Bearer <token>
4. 401 received → auto-refresh token → retry original request
5. Refresh fails → dispatch 'auth-expired' event → force logout
```

### Role-Based Access Control

| Role | Dashboard | Can Access |
|---|---|---|
| `user` | `/dashboard` | Reports, Chat, Doctors, Reminders, Appointments, Consultations |
| `doctor` | `/doctor` | Everything above + Doctor management routes |
| `admin` | `/admin` | All routes + Admin panel + Audit logs |

### Security Measures

| Concern | Implementation |
|---|---|
| Security headers | Helmet (XSS, HSTS, CSP, etc.) |
| Rate limiting | 100 req/15 min per IP (global), 2 analyses/2 min per user |
| Password hashing | bcrypt with salt rounds |
| Input validation | express-validator on all POST/PATCH routes |
| Image ownership | Cloudinary delete validates image belongs to requesting user |
| Suspension check | Auth middleware rejects suspended users on every request |
| Audit trail | All admin actions logged: action, adminId, targetId, IP, timestamp |
| CORS | Restricted to known frontend origins |

---

## Project Structure

```
MeddyCare/
├── backend/
│   ├── middleware/auth.js          # JWT verification, role guards (auth/adminAuth/doctorAuth)
│   ├── models/
│   │   ├── User.js                 # Patients + admins + doctors user accounts
│   │   ├── Doctor.js               # Doctor profiles with geo location
│   │   ├── Appointment.js          # Appointment bookings
│   │   ├── Consultation.js         # Consultation requests + diagnosis
│   │   ├── Message.js              # Real-time chat messages
│   │   ├── Report.js               # Retina scan + DR analysis results
│   │   ├── Reminder.js             # Medication/checkup reminders
│   │   └── AuditLog.js             # Admin action trail
│   ├── routes/
│   │   ├── auth.js                 # Register, login, email verify, refresh
│   │   ├── users.js                # Profile management
│   │   ├── doctors.js              # Geo search, reviews, profiles
│   │   ├── appointments.js         # Booking, confirm, reject, cancel
│   │   ├── consultations.js        # Consultation lifecycle + messaging
│   │   ├── reports.js              # DR analysis + history
│   │   ├── reminders.js            # CRUD + complete
│   │   ├── upload.js               # Cloudinary image upload
│   │   ├── chat.js                 # Gemini AI Q&A
│   │   └── admin.js                # Stats, analytics, user/doctor management
│   ├── server.js                   # Express + Socket.io entrypoint
│   ├── socket.js                   # All Socket.io event handlers
│   ├── cron.js                     # Scheduled jobs + Nodemailer
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── layout/SiteHeader.tsx
│       │   ├── layout/SiteFooter.tsx
│       │   ├── chat_components/    # ChatWindow, ChatSidebar
│       │   ├── DoctorMap.tsx       # Leaflet map with doctor pins
│       │   ├── ProtectedRoute.tsx  # Role-based route guard
│       │   └── ui/                 # shadcn/ui components (30+)
│       ├── contexts/AuthContext.tsx # Auth state: user, token, login, logout
│       ├── hooks/
│       │   ├── use-socket.ts       # Singleton Socket.io hook with ref counting
│       │   ├── use-theme.ts        # Dark/light mode
│       │   └── use-mobile.tsx      # Responsive breakpoint
│       ├── lib/api.ts              # Axios API service — all endpoints
│       ├── pages/
│       │   ├── Index.tsx           # Landing page
│       │   ├── Auth.tsx            # Login / Register / Doctor signup
│       │   ├── Chat.tsx            # AI chat + RAG
│       │   ├── Doctors.tsx         # Doctor search + Leaflet map
│       │   ├── Reminders.tsx       # Reminder management
│       │   ├── Reports.tsx         # Report viewer + analysis
│       │   ├── user/UserDashboard.tsx
│       │   ├── doctor/DoctorDashboard.tsx
│       │   └── admin/AdminDashboard.tsx
│       └── App.tsx                 # Routes + all providers
│
├── cnn_service/
│   ├── predict_service.py          # FastAPI DR image classifier
│   ├── model.h5                    # Pre-trained CNN weights (~18 MB)
│   └── Dockerfile
│
├── rag_service/
│   ├── main.py                     # FastAPI RAG app
│   ├── chat_routes.py
│   ├── vectorstore_mongo.py        # MongoDB Atlas Vector Search
│   ├── ingest.py                   # Document ingestion pipeline
│   └── Dockerfile
│
└── render.yaml                     # Render deployment config (3 services)
```

---

## Local Development Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- MongoDB Atlas account (free M0 tier works)
- Cloudinary account (free tier works)
- Google Gemini API key (free tier works)

### 1. Backend

```bash
cd MeddyCare/backend
npm install
# Create .env with values from the Environment Variables section below
npm run dev     # nodemon, port 3001
```

### 2. Frontend

```bash
cd MeddyCare/frontend
npm install
# Create .env.local
echo "VITE_API_BASE_URL=http://localhost:3001/api/v1" > .env.local
npm run dev     # Vite, port 5173
```

### 3. CNN Service

```bash
cd MeddyCare/cnn_service
pip install fastapi uvicorn tensorflow pillow requests
# Ensure model.h5 is present
uvicorn predict_service:app --port 8002 --reload
```

### 4. RAG Service

```bash
cd MeddyCare/rag_service
pip install -r requirements.txt
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

# Google Gemini
GOOGLE_GENAI_API_KEY=your_gemini_key

# Microservices
RAG_SERVICE_URL=http://localhost:8600
PREDICT_SERVICE_URL=http://localhost:8002

# Frontend (for CORS)
FRONTEND_URL=http://localhost:5173

# Email (optional in dev — falls back to console.log)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=yourapp@gmail.com
EMAIL_PASS=your-gmail-app-password
```

### Frontend `.env.local`

```env
VITE_API_BASE_URL=http://localhost:3001/api/v1
VITE_RAG_API_BASE_URL=http://localhost:8600/api/rag
VITE_PREDICT_API_URL=http://localhost:8002
```

---

## Deployment Guide

### Recommended Stack: Render + Vercel + MongoDB Atlas (all free tiers available)

```
Vercel (Frontend SPA)
       ↓  HTTPS REST + WebSocket
Render (Backend Node.js)  ←→  MongoDB Atlas
       ↓
Render (CNN Docker)   — DR image classifier
Render (RAG Docker)   — Health education RAG
```

---

### Step 1 — MongoDB Atlas

1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas) → Create free M0 cluster
2. Create a DB user with read/write access
3. Network Access → Add IP: `0.0.0.0/0` (allows Render's dynamic IPs)
4. Copy the connection string → use as `MONGODB_URI`

---

### Step 2 — Deploy Backend on Render

1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect GitHub repo, set:
   - **Root Directory:** `MeddyCare/backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
3. Add environment variables (all from the backend `.env` above, with `NODE_ENV=production` and `PORT=10000`)

---

### Step 3 — Deploy CNN Service on Render

1. **New Web Service** → Docker runtime
2. Root Directory: `MeddyCare/cnn_service`
3. Env var: `ICARE_MODEL_PATH=/app/model.h5`
4. Ensure `model.h5` is committed to the repo (use Git LFS if >100MB)

---

### Step 4 — Deploy RAG Service on Render

1. **New Web Service** → Docker runtime
2. Root Directory: `MeddyCare/rag_service`
3. Env vars: `MONGODB_URI`, `GOOGLE_GENAI_API_KEY`, `JWT_SECRET_KEY`, `ALLOWED_ORIGINS`

---

### Step 5 — Deploy Frontend on Vercel

```bash
cd MeddyCare/frontend
npx vercel
# or connect GitHub repo at vercel.com for auto-deploy
```

Set environment variable on Vercel:
```
VITE_API_BASE_URL=https://<your-render-backend>.onrender.com/api/v1
VITE_RAG_API_BASE_URL=https://<your-render-rag>.onrender.com/api/rag
VITE_PREDICT_API_URL=https://<your-render-cnn>.onrender.com
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
| Frontend | Vercel | ✅ Free | — |
| Database | MongoDB Atlas M0 | ✅ Free | $57/mo (M10) |
| Backend | Render | ✅ Free (sleeps after 15 min) | $7/mo (always-on) |
| CNN Service | Render | ✅ Free (sleeps) | $7/mo |
| RAG Service | Render | ✅ Free (sleeps) | $7/mo |
| **Total** | | **Free** | **~$21/mo** |

> Free tier services on Render spin down after 15 min of inactivity. First request after sleep takes ~30s. For demos, this is fine.

---

## What Makes This Industrial-Grade

| Concern | Implementation |
|---|---|
| **Security** | Helmet headers, rate limiting, bcrypt, JWT refresh, input validation, ownership checks on file delete |
| **Real-time** | Socket.io with room-based architecture, per-socket rate limiting, JWT-verified handshake |
| **Observability** | AuditLog for all admin actions with IP, timestamp, action type, and target |
| **Scalability** | Stateless JWT, Socket.io rooms (can scale to Redis adapter), MongoDB Atlas with indexes |
| **Error handling** | Global Express error handler, per-route try/catch, Python service error bubbling (502 proxy errors) |
| **Data integrity** | `Reminder.updateMany` on appointment cancel/reject — clears ALL linked reminders atomically |
| **Notification dedup** | `notificationSent` flag prevents duplicate cron emails on same reminder |
| **Graceful degradation** | Email system falls back to console.log when SMTP not configured — no crash |
| **Performance** | Compound DB indexes on all hot query paths, `Promise.all` for parallel queries in admin stats |
| **Type safety** | TypeScript frontend, Zod validation, typed Socket.io event payloads |
| **Clean separation** | Routes → Middleware → Models, dedicated `socket.js` for all real-time logic, `cron.js` for scheduling |
| **ML isolation** | CNN runs as independent Docker microservice — can be scaled or swapped without touching main backend |

---

## Accounts Required

| Service | Purpose | Cost |
|---|---|---|
| [MongoDB Atlas](https://mongodb.com/atlas) | Database | Free |
| [Cloudinary](https://cloudinary.com) | Image storage | Free |
| [Google AI Studio](https://aistudio.google.com) | Gemini API key | Free |
| [Render](https://render.com) | Backend hosting | Free |
| [Vercel](https://vercel.com) | Frontend hosting | Free |
| Gmail | Email notifications | Free (App Password required) |

---

> Built by Mayank Kumar — Full-Stack AI Health Platform demonstrating MERN stack, Socket.io real-time architecture, CNN-based ML microservices, geospatial queries, and production system design patterns.
