import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getActiveTheme, updateThemePreference } from '../controllers/themeController';

const router = Router();

router.get('/active', getActiveTheme);
router.post('/preference', authenticate, updateThemePreference);

export default router;