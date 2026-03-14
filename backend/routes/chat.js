import express from 'express';
import { body, validationResult } from 'express-validator';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Initialize Google GenAI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY);

// @route   POST /api/chat/ask
// @desc    Ask AI a question about retina care
// @access  Private
router.post('/ask', [
  auth,
  body('message').trim().notEmpty().withMessage('Message is required'),
  body('context').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { message, context } = req.body;

    // Create a retina care specific prompt
    const systemPrompt = `You are a helpful AI assistant specializing in retina care and eye health. 
    You provide general information and guidance but always recommend consulting with a qualified eye care professional for specific medical advice.
    
    User context: ${context || 'General inquiry'}
    User question: ${message}
    
    Please provide a helpful, informative response while emphasizing the importance of professional medical consultation.`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const text = response.text();

    res.json({
      message: 'AI response generated successfully',
      response: text,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Server error while processing chat request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/chat/symptoms
// @desc    Analyze symptoms and provide guidance
// @access  Private
router.post('/symptoms', [
  auth,
  body('symptoms').isArray().withMessage('Symptoms must be an array'),
  body('symptoms.*').isString().withMessage('Each symptom must be a string'),
  body('duration').optional().isString(),
  body('severity').optional().isIn(['mild', 'moderate', 'severe'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { symptoms, duration, severity } = req.body;

    const systemPrompt = `You are a retina care AI assistant. A user is experiencing the following symptoms:
    
    Symptoms: ${symptoms.join(', ')}
    Duration: ${duration || 'Not specified'}
    Severity: ${severity || 'Not specified'}
    
    Please provide:
    1. Possible causes (general information only)
    2. When to seek immediate medical attention
    3. General recommendations
    4. Reminder to consult with an eye care professional
    
    Keep the response informative but emphasize that this is not a diagnosis and professional consultation is essential.`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const text = response.text();

    res.json({
      message: 'Symptom analysis completed',
      analysis: text,
      timestamp: new Date().toISOString(),
      disclaimer: 'This analysis is for informational purposes only and should not replace professional medical advice.'
    });
  } catch (error) {
    console.error('Symptom analysis error:', error);
    res.status(500).json({ 
      error: 'Server error while analyzing symptoms',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/chat/education
// @desc    Get educational content about retina care
// @access  Private
router.post('/education', [
  auth,
  body('topic').trim().notEmpty().withMessage('Topic is required'),
  body('level').optional().isIn(['basic', 'intermediate', 'advanced']).withMessage('Level must be basic, intermediate, or advanced')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { topic, level = 'basic' } = req.body;

    const systemPrompt = `You are a retina care educator. Please provide educational content about: ${topic}
    
    Level: ${level}
    
    Please structure your response with:
    1. Brief overview
    2. Key points
    3. Prevention tips (if applicable)
    4. When to see a doctor
    5. Additional resources
    
    Make it informative, easy to understand, and appropriate for the specified level.`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const text = response.text();

    res.json({
      message: 'Educational content generated',
      content: text,
      topic,
      level,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Education content error:', error);
    res.status(500).json({ 
      error: 'Server error while generating educational content',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
