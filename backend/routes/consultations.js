import express from 'express';
import mongoose from 'mongoose';
import { body, validationResult } from 'express-validator';
import Consultation from '../models/Consultation.js';
import Message from '../models/Message.js';
import Doctor from '../models/Doctor.js';
import Report from '../models/Report.js';
import { auth, doctorAuth } from '../middleware/auth.js';
import { emitConsultationUpdated, emitToUser } from '../socket.js';

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

const populateConsultation = (query) =>
  query
    .populate('patient', 'firstName lastName email profileImage gender dateOfBirth')
    .populate({
      path: 'doctor',
      select: 'specialization licenseNumber experience contact location rating',
      populate: { path: 'user', select: 'firstName lastName email profileImage' },
    })
    .populate('report', 'imageUrl stage stageLabel probabilities confidence reportText createdAt');

// ─── Patient routes ──────────────────────────────────────────────────────────

// POST /api/consultations
// Patient creates a consultation request referencing one of their reports
router.post('/', [
  auth,
  body('doctorId').notEmpty().withMessage('doctorId is required'),
  body('reportId').notEmpty().withMessage('reportId is required'),
  body('patientMessage').optional().isString().isLength({ max: 1000 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { doctorId, reportId, patientMessage } = req.body;

    // Verify doctor exists and is verified
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
    if (!doctor.isVerified) return res.status(400).json({ error: 'Doctor is not yet verified' });

    // Verify report belongs to requesting patient
    const report = await Report.findOne({ _id: reportId, user: req.user._id });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // Prevent duplicate pending consultation for same report+doctor
    const existing = await Consultation.findOne({
      patient: req.user._id,
      doctor: doctorId,
      report: reportId,
      status: { $in: ['pending', 'in_review'] },
    });
    if (existing) return res.status(400).json({ error: 'A consultation for this report is already open' });

    const consultation = new Consultation({
      patient: req.user._id,
      doctor: doctorId,
      report: reportId,
      patientMessage: patientMessage?.trim() || '',
    });

    await consultation.save();
    const populated = await populateConsultation(Consultation.findById(consultation._id));

    // Notify the doctor in real-time so their dashboard refreshes
    emitToUser(doctor.user.toString(), 'new_consultation', { consultationId: consultation._id });

    res.status(201).json({ message: 'Consultation request sent', consultation: populated });
  } catch (err) {
    console.error('Create consultation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/consultations
// Patient: list their own consultations
router.get('/', auth, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { patient: req.user._id };
    if (status) filter.status = status;

    const consultations = await populateConsultation(
      Consultation.find(filter).sort({ createdAt: -1 })
    );
    res.json({ consultations });
  } catch (err) {
    console.error('Get consultations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/consultations/doctor
// Doctor: list consultations assigned to them
router.get('/doctor', doctorAuth, async (req, res) => {
  try {
    const doctorProfile = await Doctor.findOne({ user: req.user._id });
    if (!doctorProfile) return res.status(404).json({ error: 'Doctor profile not found' });

    const { status } = req.query;
    const filter = { doctor: doctorProfile._id };
    if (status) filter.status = status;

    const consultations = await populateConsultation(
      Consultation.find(filter).sort({ createdAt: -1 })
    );
    res.json({ consultations });
  } catch (err) {
    console.error('Get doctor consultations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/consultations/:id
// Patient or doctor involved in the consultation
router.get('/:id', auth, async (req, res) => {
  try {
    const consultation = await populateConsultation(Consultation.findById(req.params.id));
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });

    // Only the patient or the assigned doctor can view
    const isPatient = consultation.patient._id.toString() === req.user._id.toString();
    const isDoctor  = consultation.doctor?.user?._id?.toString() === req.user._id.toString();
    if (!isPatient && !isDoctor && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ consultation });
  } catch (err) {
    console.error('Get consultation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Doctor routes ───────────────────────────────────────────────────────────

// PATCH /api/consultations/:id/status
// Doctor updates status (pending → in_review → completed, or → cancelled)
router.patch('/:id/status', doctorAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['in_review', 'completed', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }

    const doctorProfile = await Doctor.findOne({ user: req.user._id });
    if (!doctorProfile) return res.status(404).json({ error: 'Doctor profile not found' });

    const consultation = await Consultation.findOne({
      _id: req.params.id,
      doctor: doctorProfile._id,
    });
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });

    if (consultation.status === 'completed' || consultation.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot change status of a closed consultation' });
    }

    consultation.status = status;
    await consultation.save();

    // Push real-time status update to any connected participants
    emitConsultationUpdated(consultation._id.toString(), status);

    const populated = await populateConsultation(Consultation.findById(consultation._id));
    res.json({ message: 'Status updated', consultation: populated });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/consultations/:id/diagnose
// Doctor writes diagnosis + prescription; auto-marks completed
router.patch('/:id/diagnose', [
  doctorAuth,
  body('diagnosis.findings').trim().notEmpty().withMessage('Diagnosis findings are required'),
  body('diagnosis.severity').isIn(['normal', 'mild', 'moderate', 'severe', 'critical']),
  body('diagnosis.recommendations').optional().isString(),
  body('prescription.medications').optional().isArray(),
  body('prescription.instructions').optional().isString(),
  body('prescription.followUpDate').optional().isISO8601(),
  body('doctorNotes').optional().isString().isLength({ max: 2000 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const doctorProfile = await Doctor.findOne({ user: req.user._id });
    if (!doctorProfile) return res.status(404).json({ error: 'Doctor profile not found' });

    const consultation = await Consultation.findOne({
      _id: req.params.id,
      doctor: doctorProfile._id,
    });
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });

    if (consultation.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot diagnose a cancelled consultation' });
    }

    const { diagnosis, prescription, doctorNotes } = req.body;

    consultation.diagnosis   = diagnosis   || consultation.diagnosis;
    consultation.prescription = prescription || consultation.prescription;
    consultation.doctorNotes = doctorNotes !== undefined ? doctorNotes : consultation.doctorNotes;
    consultation.status      = 'completed';

    await consultation.save();
    emitConsultationUpdated(consultation._id.toString(), 'completed');

    const populated = await populateConsultation(Consultation.findById(consultation._id));
    res.json({ message: 'Diagnosis saved', consultation: populated });
  } catch (err) {
    console.error('Diagnose error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/v1/consultations/:id/messages
// Paginated message history for a consultation
// Query params: limit (default 50), before (timestamp cursor for older messages)
router.get('/:id/messages', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid consultation ID' });
    }

    const consultation = await Consultation.findById(req.params.id).select('patient doctor');
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });

    // Access control
    const isPatient = consultation.patient.toString() === req.user._id.toString();
    let isDoctor = false;
    if (!isPatient) {
      const doctorProfile = await Doctor.findOne({ user: req.user._id }).select('_id');
      isDoctor = doctorProfile && consultation.doctor.toString() === doctorProfile._id.toString();
    }
    if (!isPatient && !isDoctor && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const filter = { consultationId: req.params.id };
    if (req.query.before) filter.timestamp = { $lt: new Date(req.query.before) };

    const messages = await Message.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('senderId', 'firstName lastName profileImage');

    res.json({ messages: messages.reverse(), count: messages.length });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/v1/consultations/:id/messages
// REST fallback — prefer Socket.io for real-time; use this for offline/retry scenarios
router.post('/:id/messages', [
  auth,
  body('text').if(body('type').not().equals('image')).trim().notEmpty().withMessage('text is required').isLength({ max: 2000 }),
  body('type').optional().isIn(['text', 'image']),
  body('imageUrl').if(body('type').equals('image')).notEmpty().withMessage('imageUrl is required for image messages'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid consultation ID' });
    }

    const consultation = await Consultation.findById(req.params.id).select('patient doctor status');
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });

    if (consultation.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot message on a cancelled consultation' });
    }

    // Resolve sender role
    const isPatient = consultation.patient.toString() === req.user._id.toString();
    let senderRole = null;
    if (isPatient) {
      senderRole = 'patient';
    } else {
      const doctorProfile = await Doctor.findOne({ user: req.user._id }).select('_id');
      if (doctorProfile && consultation.doctor.toString() === doctorProfile._id.toString()) {
        senderRole = 'doctor';
      }
    }
    if (!senderRole) return res.status(403).json({ error: 'Access denied' });

    const { text, type = 'text', imageUrl } = req.body;

    // Validate Cloudinary URL for image messages
    if (type === 'image') {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const validPrefix = `https://res.cloudinary.com/${cloudName}/`;
      if (!cloudName || !imageUrl.startsWith(validPrefix)) {
        return res.status(400).json({ error: 'Invalid image URL: must be a Cloudinary asset from this platform' });
      }
    }

    const message = await Message.create({
      consultationId: req.params.id,
      senderId:       req.user._id,
      senderRole,
      type,
      text:           text?.trim(),
      imageUrl:       type === 'image' ? imageUrl : undefined,
      readBy:         [{ user: req.user._id, readAt: new Date() }],
      timestamp:      new Date(),
    });

    res.status(201).json({ message: 'Message sent', data: message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
