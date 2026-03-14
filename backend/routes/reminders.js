import express from 'express';
import { body, validationResult } from 'express-validator';
import Reminder from '../models/Reminder.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/reminders — get all reminders for current user
router.get('/', auth, async (req, res) => {
  try {
    const reminders = await Reminder.find({ user: req.user._id })
      .sort({ createdAt: -1 });
    res.json({ reminders });
  } catch (error) {
    console.error('Get reminders error:', error);
    res.status(500).json({ error: 'Server error while fetching reminders' });
  }
});

// POST /api/reminders — create a reminder
router.post('/', [
  auth,
  body('title').notEmpty().withMessage('Title is required'),
  body('scheduledAt').isISO8601().withMessage('Valid date/time is required'),
  body('reminderType').optional().isIn(['medication', 'checkup', 'followup', 'other'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const reminder = new Reminder({
      user: req.user._id,
      title: req.body.title,
      description: req.body.description,
      reminderType: req.body.reminderType || 'other',
      scheduledAt: new Date(req.body.scheduledAt)
    });

    await reminder.save();
    res.status(201).json({ message: 'Reminder created', reminder });
  } catch (error) {
    console.error('Create reminder error:', error);
    res.status(500).json({ error: 'Server error while creating reminder' });
  }
});

// PATCH /api/reminders/:id/complete — mark as completed
router.patch('/:id/complete', auth, async (req, res) => {
  try {
    const reminder = await Reminder.findOne({ _id: req.params.id, user: req.user._id });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });

    reminder.isCompleted = true;
    reminder.completedAt = new Date();
    await reminder.save();

    res.json({ message: 'Reminder marked complete', reminder });
  } catch (error) {
    console.error('Complete reminder error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/reminders/:id — delete a reminder
router.delete('/:id', auth, async (req, res) => {
  try {
    const reminder = await Reminder.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });

    res.json({ message: 'Reminder deleted' });
  } catch (error) {
    console.error('Delete reminder error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
