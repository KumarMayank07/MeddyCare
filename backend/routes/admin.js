import express from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import Report from '../models/Report.js';
import Doctor from '../models/Doctor.js';
import Consultation from '../models/Consultation.js';
import Appointment from '../models/Appointment.js';
import AuditLog from '../models/AuditLog.js';
import { adminAuth } from '../middleware/auth.js';
import { emitToUser } from '../socket.js';
import { statsCache } from '../cache.js';

const router = express.Router();

// ─── Audit helper ─────────────────────────────────────────────────────────────
// Fire-and-forget — never fails the main request
async function logAction(req, action, targetType, targetId, targetLabel, metadata = {}) {
  try {
    await AuditLog.create({
      admin:       req.user._id,
      action,
      targetType,
      targetId,
      targetLabel,
      metadata,
      ip:          req.ip,
    });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

// ─── Overview stats ───────────────────────────────────────────────────────────

// GET /api/admin/stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    // Serve from cache if available (avoids ~12 DB queries on every 30s poll)
    const cached = statsCache.get('admin_stats');
    if (cached) return res.json(cached);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      totalUsers, totalReports, totalDoctors,
      pendingDoctors, recentReports, stageDistribution,
      activeUsers, suspendedUsers, newUsersThisMonth,
      highRiskPatients, totalConsultations, totalAppointments,
    ] = await Promise.all([
      User.countDocuments({ role: { $in: ['user', 'doctor'] } }),
      Report.countDocuments(),
      Doctor.countDocuments({ isVerified: true }),
      Doctor.countDocuments({ isVerified: false }),
      Report.find()
        .populate('user', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .limit(10),
      Report.aggregate([
        { $group: { _id: '$stage', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      User.countDocuments({ role: { $in: ['user', 'doctor'] }, isSuspended: { $ne: true } }),
      User.countDocuments({ role: { $in: ['user', 'doctor'] }, isSuspended: true }),
      User.countDocuments({ role: { $in: ['user', 'doctor'] }, createdAt: { $gte: startOfMonth } }),
      // patients with at least one high-risk report (stage >= 3)
      Report.distinct('user', { stage: { $gte: 3 } }).then(ids => ids.length),
      Consultation.countDocuments(),
      Appointment.countDocuments(),
    ]);

    const stageLabels = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];
    const distribution = stageLabels.map((label, idx) => {
      const found = stageDistribution.find(s => s._id === idx);
      return { stage: idx, label, count: found ? found.count : 0 };
    });

    const result = {
      totalUsers, totalReports, totalDoctors, pendingDoctors, recentReports,
      stageDistribution: distribution,
      activeUsers, suspendedUsers, newUsersThisMonth,
      highRiskPatients, totalConsultations, totalAppointments,
    };
    statsCache.set('admin_stats', result);
    res.json(result);
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Analytics ────────────────────────────────────────────────────────────────

// GET /api/admin/analytics
router.get('/analytics', adminAuth, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      consultationAgg,
      screeningsTimeSeries,
      confidenceAgg,
      stageDistribution,
      appointmentAgg,
      appointmentsTimeSeries,
      specializationAgg,
      topDoctorsAgg,
      newUsersTimeSeries,
    ] = await Promise.all([
      // Consultation counts by status
      Consultation.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // Screenings per day for the last 30 days
      Report.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Average model confidence
      Report.aggregate([
        { $match: { confidence: { $exists: true, $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$confidence' } } },
      ]),

      // Stage distribution
      Report.aggregate([
        { $group: { _id: '$stage', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Appointment counts by status
      Appointment.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      // Appointments per day for the last 30 days
      Appointment.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Doctor specialization distribution
      Doctor.aggregate([
        { $group: { _id: '$specialization', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // Top 5 doctors by consultation count
      Consultation.aggregate([
        { $group: { _id: '$doctor', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'doctors',
            localField: '_id',
            foreignField: '_id',
            as: 'doc',
          },
        },
        { $unwind: '$doc' },
        {
          $lookup: {
            from: 'users',
            localField: 'doc.user',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $project: {
            count: 1,
            specialization: '$doc.specialization',
            name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            rating: '$doc.rating',
          },
        },
      ]),

      // New user registrations per day for the last 30 days
      User.aggregate([
        { $match: { role: { $in: ['user', 'doctor'] }, createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Shape consultation stats into a flat object
    const statusMap = { pending: 0, in_review: 0, completed: 0, cancelled: 0 };
    consultationAgg.forEach(({ _id, count }) => { if (_id in statusMap) statusMap[_id] = count; });
    const totalConsultations = Object.values(statusMap).reduce((a, b) => a + b, 0);

    // Shape appointment stats
    const apptMap = { pending: 0, confirmed: 0, cancelled: 0, completed: 0 };
    appointmentAgg.forEach(({ _id, count }) => { if (_id in apptMap) apptMap[_id] = count; });
    const totalAppointments = Object.values(apptMap).reduce((a, b) => a + b, 0);

    const stageLabels = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];
    const stageColors = ['#10b981', '#3b82f6', '#eab308', '#f97316', '#ef4444'];
    const stageDist = stageLabels.map((label, idx) => {
      const found = stageDistribution.find(s => s._id === idx);
      return { stage: idx, label, count: found ? found.count : 0, fill: stageColors[idx] };
    });

    // Patient risk tiers based on highest stage per patient
    const riskTiers = [
      { label: 'Low Risk',    fill: '#10b981', count: (stageDist[0].count + stageDist[1].count) },
      { label: 'Medium Risk', fill: '#eab308', count: stageDist[2].count },
      { label: 'High Risk',   fill: '#ef4444', count: (stageDist[3].count + stageDist[4].count) },
    ];

    res.json({
      consultations:         { ...statusMap, total: totalConsultations },
      screeningsOverTime:    screeningsTimeSeries.map(d => ({ date: d._id, count: d.count })),
      avgConfidence:         confidenceAgg[0]?.avg ?? null,
      stageDistribution:     stageDist,
      appointments:          { ...apptMap, total: totalAppointments },
      appointmentsOverTime:  appointmentsTimeSeries.map(d => ({ date: d._id, count: d.count })),
      specializationDistribution: specializationAgg.map(s => ({ name: s._id || 'Other', count: s.count })),
      topDoctors:            topDoctorsAgg,
      newUsersOverTime:      newUsersTimeSeries.map(d => ({ date: d._id, count: d.count })),
      patientRiskTiers:      riskTiers,
    });
  } catch (err) {
    console.error('Admin analytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── User management ──────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;
    const query = {};
    if (role) query.role = role;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      query.$or = [{ firstName: re }, { lastName: re }, { email: re }];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(query).select('-password').skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 }),
      User.countDocuments(query),
    ]);

    res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/admin/users/:id/suspend
router.patch('/users/:id/suspend', adminAuth, async (req, res) => {
  try {
    const { isSuspended } = req.body;
    if (typeof isSuspended !== 'boolean') {
      return res.status(400).json({ error: 'isSuspended must be a boolean' });
    }

    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Cannot suspend an admin account' });

    user.isSuspended = isSuspended;
    await user.save();

    // Notify the user in real-time about their account status change
    if (isSuspended) {
      emitToUser(user._id.toString(), 'account_suspended', {});
    } else {
      emitToUser(user._id.toString(), 'account_unsuspended', {});
    }

    await logAction(
      req,
      isSuspended ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED',
      'User',
      user._id,
      `${user.firstName} ${user.lastName} (${user.email})`,
      { role: user.role },
    );

    statsCache.invalidate('admin_stats');
    res.json({ message: `User ${isSuspended ? 'suspended' : 'unsuspended'}`, user });
  } catch (err) {
    console.error('Suspend user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Doctor management ────────────────────────────────────────────────────────

// GET /api/admin/doctors
router.get('/doctors', adminAuth, async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    let filter = {};

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter = {
        $or: [
          { specialization: new RegExp(escaped, 'i') },
          { licenseNumber: new RegExp(escaped, 'i') },
        ],
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [doctors, total] = await Promise.all([
      Doctor.find(filter)
        .populate('user', 'firstName lastName email profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Doctor.countDocuments(filter),
    ]);

    res.json({ doctors, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('Admin doctors error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/admin/doctors/:id/verify
router.patch('/doctors/:id/verify', adminAuth, async (req, res) => {
  try {
    const { isVerified } = req.body;
    if (typeof isVerified !== 'boolean') {
      return res.status(400).json({ error: 'isVerified must be a boolean' });
    }

    const doctor = await Doctor.findByIdAndUpdate(
      req.params.id,
      { isVerified },
      { new: true },
    ).populate('user', 'firstName lastName email');

    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

    await logAction(
      req,
      isVerified ? 'DOCTOR_VERIFIED' : 'DOCTOR_UNVERIFIED',
      'Doctor',
      doctor._id,
      `Dr. ${doctor.user.firstName} ${doctor.user.lastName} (${doctor.user.email})`,
      { specialization: doctor.specialization, licenseNumber: doctor.licenseNumber },
    );

    // Notify the doctor in real-time so their dashboard reflects the change immediately
    emitToUser(doctor.user._id.toString(), 'profile_updated', { isVerified });
    statsCache.invalidate('admin_stats');

    res.json({ message: `Doctor ${isVerified ? 'verified' : 'unverified'}`, doctor });
  } catch (err) {
    console.error('Verify doctor error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Create admin ─────────────────────────────────────────────────────────────

// POST /api/admin/create-admin — create a new admin account
router.post('/create-admin', [
  adminAuth,
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, firstName, lastName } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });

    const admin = new User({
      email,
      password,
      firstName,
      lastName,
      role: 'admin',
      isEmailVerified: true,
    });
    await admin.save();

    await logAction(
      req,
      'ADMIN_CREATED',
      'User',
      admin._id,
      `${firstName} ${lastName} (${email})`,
    );

    res.status(201).json({ message: 'Admin account created', user: admin.getPublicProfile() });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Audit logs ───────────────────────────────────────────────────────────────

// GET /api/admin/audit-logs
router.get('/audit-logs', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 25, action } = req.query;
    const filter = action ? { action } : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('admin', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
