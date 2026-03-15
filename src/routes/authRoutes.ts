import { Router } from 'express';
import { getProfile } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/profile', authenticate, getProfile);

export default router;
