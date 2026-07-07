import { Router } from 'express';
import { cancelQueueJob, getQueueStatus } from '../controllers/queueController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/queue-status', authenticate, getQueueStatus);
router.post('/queue-cancel', authenticate, cancelQueueJob);

export default router;
