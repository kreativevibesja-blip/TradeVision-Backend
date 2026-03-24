import { Router } from 'express';
import { getQueueStatus } from '../controllers/queueController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/queue-status', authenticate, getQueueStatus);

export default router;
