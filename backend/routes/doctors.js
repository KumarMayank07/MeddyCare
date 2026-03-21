import express from 'express';
import { body, validationResult } from 'express-validator';
import Doctor from '../models/Doctor.js';
import User from '../models/User.js';
import Consultation from '../models/Consultation.js';
import { auth, doctorAuth } from '../middleware/auth.js';
import { doctorListCache } from '../cache.js';

const router = express.Router();

// @route   GET /api/doctors/nearby
// @desc    Find nearby doctors
// @access  Public
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, maxDistance = 50, specialization } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    let query = {
      "location.coordinates": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseFloat(maxDistance) * 1000 // Convert to meters
        }
      },
      isActive: true,
      isVerified: true
    };

    // Add specialization filter if provided
    if (specialization) {
      query.specialization = specialization;
    }

    const doctors = await Doctor.find(query)
      .populate('user', 'firstName lastName email profileImage')
      .limit(20);

    // Add distance to each doctor
    const doctorsWithDistance = doctors.map(doctor => {
      const distance = doctor.calculateDistance(parseFloat(lat), parseFloat(lng));
      return {
        ...doctor.toObject(),
        distance: Math.round(distance * 10) / 10 // Round to 1 decimal place
      };
    });

    // Sort by higher score
    doctorsWithDistance.sort((a, b) => {
      // Calculate composite score for each doctor
      const getScore = (doctor) => {
        let score = 0;

        // Rating weight (0-50 points)
        const rating = doctor.rating?.average || 0;
        score += rating * 10; // 5-star = 50 points

        // Review count weight (0-20 points)
        const reviewCount = doctor.rating?.count || 0;
        score += Math.min(reviewCount / 10, 20); // Cap at 20 points

        // Experience weight (0-20 points)
        score += Math.min(doctor.experience, 20);

        // Distance penalty (subtract points for farther doctors)
        const distance = doctor.distance || 999;
        score -= distance * 2; // 2 points penalty per km

        // Specialization bonus (10 points for exact match, from query param)
        if (specialization && doctor.specialization === specialization) {
          score += 10;
        }

        return score;
      };

      return getScore(b) - getScore(a); // Higher score first
    });

    res.json({
      doctors: doctorsWithDistance,
      count: doctorsWithDistance.length
    });
  } catch (error) {
    console.error('Find nearby doctors error:', error);
    res.status(500).json({ error: 'Server error while finding nearby doctors' });
  }
});

// @route   GET /api/doctors/analytics
// @desc    Doctor's own performance analytics
// @access  Private (Doctor)
router.get('/analytics', doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) return res.status(404).json({ error: 'Doctor profile not found' });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalConsultations,
      statusCounts,
      consultationsOverTime,
      ratingBreakdown,
    ] = await Promise.all([
      Consultation.countDocuments({ doctor: doctor._id }),
      Consultation.aggregate([
        { $match: { doctor: doctor._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // Daily count over last 30 days
      Consultation.aggregate([
        { $match: { doctor: doctor._id, createdAt: { $gte: thirtyDaysAgo } } },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
      // Patient risk distribution from linked reports
      Consultation.aggregate([
        { $match: { doctor: doctor._id } },
        { $lookup: { from: 'reports', localField: 'report', foreignField: '_id', as: 'reportDoc' } },
        { $unwind: { path: '$reportDoc', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$reportDoc.stage', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Build status map
    const statusMap = { total: totalConsultations, pending: 0, in_review: 0, completed: 0, cancelled: 0 };
    for (const s of statusCounts) { if (s._id in statusMap) statusMap[s._id] = s.count; }

    // Rating distribution
    const ratingDist = [1, 2, 3, 4, 5].map(star => ({
      star,
      count: doctor.reviews.filter(r => r.rating === star).length,
    }));

    // Stage labels for patient risk
    const stageLabels = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];
    const patientRiskTiers = ratingBreakdown.map(r => ({
      stage: r._id,
      label: stageLabels[r._id] ?? `Stage ${r._id}`,
      count: r.count,
    }));

    res.json({
      consultations: statusMap,
      consultationsOverTime: consultationsOverTime.map(d => ({ date: d._id, count: d.count })),
      rating: {
        average: doctor.rating.average,
        count:   doctor.rating.count,
        distribution: ratingDist,
      },
      patientRiskTiers,
    });
  } catch (err) {
    console.error('Doctor analytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/doctors/me
// @desc    Get current doctor's own profile
// @access  Private (Doctor)
router.get('/me', auth, async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id })
      .populate('user', 'firstName lastName email profileImage')
      .populate('reviews.user', 'firstName lastName profileImage');

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    res.json({ doctor });
  } catch (error) {
    console.error('Get own doctor profile error:', error);
    res.status(500).json({ error: 'Server error while getting doctor profile' });
  }
});

// @route   GET /api/doctors/:id/slots
// @desc    Get available time slots for a doctor on a given date
// @access  Public
router.get('/:id/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query parameter required (YYYY-MM-DD)' });

    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

    const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = DAY_NAMES[new Date(date).getDay()];
    const avail = doctor.availability?.[dayName];

    if (!avail || !avail.available) {
      return res.json({ slots: [], available: false });
    }

    const slots = [];
    const [startH, startM] = (avail.start || '09:00').split(':').map(Number);
    const [endH, endM] = (avail.end || '17:00').split(':').map(Number);
    let current = startH * 60 + startM;
    const end = endH * 60 + endM;

    // For today's date, filter out slots that are already in the past
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const isToday = date === today;
    const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : -1;

    while (current < end) {
      if (current > nowMinutes) {
        const h = Math.floor(current / 60);
        const m = current % 60;
        slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
      current += 30;
    }

    res.json({ slots, available: true, start: avail.start, end: avail.end });
  } catch (error) {
    console.error('Get doctor slots error:', error);
    res.status(500).json({ error: 'Server error while getting doctor slots' });
  }
});

// @route   GET /api/doctors/:id
// @desc    Get doctor by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id)
      .populate('user', 'firstName lastName email profileImage')
      .populate('reviews.user', 'firstName lastName profileImage');

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    res.json({ doctor });
  } catch (error) {
    console.error('Get doctor error:', error);
    res.status(500).json({ error: 'Server error while getting doctor' });
  }
});

// @route   POST /api/doctors
// @desc    Create doctor profile
// @access  Private (Doctor only)
router.post('/', [
  auth,
  body('specialization').isIn(['Retina Specialist', 'Ophthalmologist', 'Optometrist', 'General Eye Care']),
  body('licenseNumber').notEmpty(),
  body('experience').isInt({ min: 0 }),
  body('location.coordinates').isArray({ min: 2, max: 2 }),
  body('location.coordinates.*').isFloat()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Check if user is already a doctor
    const existingDoctor = await Doctor.findOne({ user: req.user._id });
    if (existingDoctor) {
      return res.status(400).json({ error: 'Doctor profile already exists for this user' });
    }

    // Whitelist allowed fields — prevent mass-assignment of isVerified, rating, reviews, etc.
    const { specialization, licenseNumber, experience, contact, location, availability } = req.body;
    const doctorData = {
      user: req.user._id,
      specialization,
      licenseNumber,
      experience,
      ...(contact && { contact }),
      ...(location && { location }),
      ...(availability && { availability }),
    };

    const doctor = new Doctor(doctorData);
    await doctor.save();
    doctorListCache.clear(); // New doctor — invalidate cached listings

    // Update user role to doctor
    await User.findByIdAndUpdate(req.user._id, { role: 'doctor' });

    res.status(201).json({
      message: 'Doctor profile created successfully',
      doctor
    });
  } catch (error) {
    console.error('Create doctor error:', error);
    res.status(500).json({ error: 'Server error while creating doctor profile' });
  }
});

// @route   PUT /api/doctors/:id
// @desc    Update doctor profile
// @access  Private (Doctor only)
router.put('/:id', doctorAuth, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id);
    
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // Check if user owns this doctor profile or is admin
    if (doctor.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Whitelist allowed fields — isVerified, isActive, rating, reviews, licenseNumber
    // cannot be set through this route (admin-only or computed)
    const {
      specialization, experience, contact, availability,
      languages, education, certifications, services, location,
    } = req.body;

    const allowed = {};
    if (specialization !== undefined) allowed.specialization = specialization;
    if (experience     !== undefined) allowed.experience     = experience;
    if (contact        !== undefined) allowed.contact        = contact;
    if (availability   !== undefined) allowed.availability   = availability;
    if (languages      !== undefined) allowed.languages      = languages;
    if (education      !== undefined) allowed.education      = education;
    if (certifications !== undefined) allowed.certifications = certifications;
    if (services       !== undefined) allowed.services       = services;
    if (location       !== undefined) allowed.location       = location;

    const updatedDoctor = await Doctor.findByIdAndUpdate(
      req.params.id,
      { $set: allowed },
      { new: true, runValidators: true }
    ).populate('user', 'firstName lastName email profileImage');
    doctorListCache.clear(); // Profile changed — invalidate cached listings

    res.json({
      message: 'Doctor profile updated successfully',
      doctor: updatedDoctor
    });
  } catch (error) {
    console.error('Update doctor error:', error);
    res.status(500).json({ error: 'Server error while updating doctor profile' });
  }
});

// @route   POST /api/doctors/:id/reviews
// @desc    Add review to doctor
// @access  Private
router.post('/:id/reviews', [
  auth,
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // Check if user already reviewed this doctor
    const existingReview = doctor.reviews.find(
      review => review.user.toString() === req.user._id.toString()
    );
    if (existingReview) {
      return res.status(400).json({ error: 'You have already reviewed this doctor' });
    }

    const { rating, comment } = req.body;
    
    doctor.reviews.push({
      user: req.user._id,
      rating,
      comment
    });

    // Update average rating
    const totalRating = doctor.reviews.reduce((sum, review) => sum + review.rating, 0);
    doctor.rating.average = totalRating / doctor.reviews.length;
    doctor.rating.count = doctor.reviews.length;

    await doctor.save();
    doctorListCache.clear(); // Rating changed — invalidate cached listings

    res.status(201).json({
      message: 'Review added successfully',
      doctor: await doctor.populate('reviews.user', 'firstName lastName profileImage')
    });
  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({ error: 'Server error while adding review' });
  }
});

// @route   GET /api/doctors
// @desc    Get all doctors with filters
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { specialization, city, rating, limit = 20, page = 1 } = req.query;

    // Build a stable cache key from query params
    const cacheKey = `docs:${specialization || ''}:${city || ''}:${rating || ''}:${limit}:${page}`;
    const cached = doctorListCache.get(cacheKey);
    if (cached) return res.json(cached);

    let query = { isActive: true, isVerified: true };

    if (specialization) {
      query.specialization = specialization;
    }

    if (city) {
      const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query['location.address.city'] = { $regex: escapedCity, $options: 'i' };
    }

    if (rating) {
      query['rating.average'] = { $gte: parseFloat(rating) };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [doctors, total] = await Promise.all([
      Doctor.find(query)
        .populate('user', 'firstName lastName email profileImage')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ 'rating.average': -1, 'rating.count': -1 }),
      Doctor.countDocuments(query),
    ]);

    const result = {
      doctors,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / parseInt(limit)),
        hasNext: skip + doctors.length < total,
        hasPrev: parseInt(page) > 1
      }
    };
    doctorListCache.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ error: 'Server error while getting doctors' });
  }
});

export default router;
