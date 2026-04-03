/**
 * constants.js — Shared backend constants
 *
 * Single source of truth for values referenced across multiple route handlers.
 * Keep in sync with frontend/src/constants/index.ts where applicable.
 */

// Diabetic Retinopathy stage labels (index = stage number, 0–4)
export const STAGE_LABELS = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];

// Corresponding chart fill colours for stage distribution graphs
export const STAGE_COLORS = ['#10b981', '#3b82f6', '#eab308', '#f97316', '#ef4444'];

// Day-of-week names indexed by Date.getDay() (0 = Sunday)
export const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
