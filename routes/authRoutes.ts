import { Router } from 'express';
import { getProfile, saveOnboardingProfile } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/profile', authenticate, getProfile);
router.post('/onboarding', authenticate, saveOnboardingProfile);

export default router;
