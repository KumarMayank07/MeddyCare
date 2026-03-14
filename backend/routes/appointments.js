import express from 'express';
import { body, validationResult } from 'express-validator';
import Appointment from '../models/Appointment.js';
import Doctor from '../models/Doctor.js';
import Reminder from '../models/Reminder.js';
import { auth, doctorAuth } from '../middleware/auth.js';
import { emitToUser } from '../socket.js';

const router = express.Router();

// @route   POST /api/appointments
// @desc    Book an appointment — also auto-creates a Reminder for the patient
// @access  Private (patient)
router.post('/', [
  auth,
  body('doctorId').notEmpty().withMessage('Doctor ID is required'),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('reason').trim().notEmpty().withMessage('Reason is required'),
  body('notes').optional().isString(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { doctorId, date, reason, notes } = req.body;

    const doctor = await Doctor.findById(doctorId).populate('user', 'firstName lastName');
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

    const appointmentDate = new Date(date);
    if (appointmentDate < new Date()) {
      return res.status(400).json({ error: 'Appointment date must be in the future' });
    }

    const appointment = new Appointment({
      user: req.user._id,
      doctor: doctorId,
      date: appointmentDate,
      reason,
      notes,
    });
    await appointment.save();

    // Auto-create a reminder for the patient so it shows up in Reminders + Today's Agenda
    await Reminder.create({
      user: req.user._id,
      title: `Appointment with Dr. ${doctor.user.firstName} ${doctor.user.lastName}`,
      description: reason + (notes ? ` — ${notes}` : ''),
      reminderType: 'checkup',
      scheduledAt: appointmentDate,
      appointmentRef: appointment._id,
    });

    await appointment.populate({
      path: 'doctor',
      select: 'specialization location contact',
      populate: { path: 'user', select: 'firstName lastName email profileImage' },
    });

    // Notify the doctor in real-time so their dashboard refreshes
    emitToUser(doctor.user._id.toString(), 'new_appointment', { appointmentId: appointment._id });

    res.status(201).json({ message: 'Appointment booked successfully', appointment });
  } catch (error) {
    console.error('Book appointment error:', error);
    res.status(500).json({ error: 'Server error while booking appointment' });
  }
});

// @route   GET /api/appointments/doctor
// @desc    Get all appointments booked with this doctor
// @access  Doctor only
router.get('/doctor', doctorAuth, async (req, res) => {
  try {
    const doctorProfile = await Doctor.findOne({ user: req.user._id });
    if (!doctorProfile) return res.status(404).json({ error: 'Doctor profile not found' });

    const appointments = await Appointment.find({ doctor: doctorProfile._id })
      .populate('user', 'firstName lastName email profileImage phone')
      .sort({ createdAt: -1 });

    res.json({ appointments });
  } catch (error) {
    console.error('Get doctor appointments error:', error);
    res.status(500).json({ error: 'Server error while fetching appointments' });
  }
});

// @route   PATCH /api/appointments/:id/confirm
// @desc    Doctor confirms an appointment
// @access  Doctor only
router.patch('/:id/confirm', doctorAuth, async (req, res) => {
  try {
    const doctorProfile = await Doctor.findOne({ user: req.user._id });
    if (!doctorProfile) return res.status(404).json({ error: 'Doctor profile not found' });

    const appointment = await Appointment.findOne({ _id: req.params.id, doctor: doctorProfile._id });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    if (appointment.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending appointments can be confirmed' });
    }

    appointment.status = 'confirmed';
    await appointment.save();
    // Notify the patient their appointment was confirmed
    emitToUser(appointment.user.toString(), 'appointment_updated', { appointmentId: appointment._id, status: 'confirmed' });

    await appointment.populate('user', 'firstName lastName email profileImage phone');

    // Create a reminder for the doctor so it shows in their reminders / today's agenda
    await Reminder.create({
      user: req.user._id,
      title: `Appointment with ${appointment.user.firstName} ${appointment.user.lastName}`,
      description: appointment.reason + (appointment.notes ? ` — ${appointment.notes}` : ''),
      reminderType: 'checkup',
      scheduledAt: appointment.date,
      appointmentRef: appointment._id,
    });

    res.json({ message: 'Appointment confirmed', appointment });
  } catch (error) {
    console.error('Confirm appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   PATCH /api/appointments/:id/reject
// @desc    Doctor rejects an appointment
// @access  Doctor only
router.patch('/:id/reject', doctorAuth, async (req, res) => {
  try {
    const doctorProfile = await Doctor.findOne({ user: req.user._id });
    if (!doctorProfile) return res.status(404).json({ error: 'Doctor profile not found' });

    const appointment = await Appointment.findOne({ _id: req.params.id, doctor: doctorProfile._id });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    if (!['pending', 'confirmed'].includes(appointment.status)) {
      return res.status(400).json({ error: 'Appointment cannot be rejected in its current state' });
    }

    appointment.status = 'cancelled';
    await appointment.save();
    // Notify the patient their appointment was rejected
    emitToUser(appointment.user.toString(), 'appointment_updated', { appointmentId: appointment._id, status: 'cancelled' });

    // Mark ALL linked reminders (patient + doctor if any) as completed
    await Reminder.updateMany(
      { appointmentRef: appointment._id },
      { isCompleted: true, completedAt: new Date() }
    );

    await appointment.populate('user', 'firstName lastName email profileImage phone');
    res.json({ message: 'Appointment rejected', appointment });
  } catch (error) {
    console.error('Reject appointment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/appointments
// @desc    Get all appointments for logged-in user (patient)
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const appointments = await Appointment.find({ user: req.user._id })
      .populate({
        path: 'doctor',
        select: 'specialization location contact rating',
        populate: { path: 'user', select: 'firstName lastName email profileImage' },
      })
      .sort({ createdAt: -1 });

    res.json({ appointments });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ error: 'Server error while fetching appointments' });
  }
});

// @route   PATCH /api/appointments/:id/cancel
// @desc    Patient cancels an appointment
// @access  Private
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, user: req.user._id });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    if (appointment.status === 'cancelled') {
      return res.status(400).json({ error: 'Appointment already cancelled' });
    }
    if (appointment.status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel a completed appointment' });
    }

    appointment.status = 'cancelled';
    await appointment.save();

    // Mark ALL linked reminders (patient + doctor if confirmed) as completed
    await Reminder.updateMany(
      { appointmentRef: appointment._id },
      { isCompleted: true, completedAt: new Date() }
    );

    // Notify the doctor in real-time so their dashboard updates
    const doctorProfile = await Doctor.findById(appointment.doctor).select('user');
    if (doctorProfile) {
      emitToUser(doctorProfile.user.toString(), 'appointment_updated', {
        appointmentId: appointment._id, status: 'cancelled',
      });
    }

    res.json({ message: 'Appointment cancelled', appointment });
  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({ error: 'Server error while cancelling appointment' });
  }
});

export default router;
