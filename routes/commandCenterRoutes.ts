import { Router } from 'express';
import { getCommandCenter } from '../controllers/commandCenterController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/trade/:id/command-center', authenticate, getCommandCenter);

export default router;
