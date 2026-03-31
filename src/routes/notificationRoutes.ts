import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { subscribe, unsubscribe } from '../controllers/notificationController';

const router = Router();

router.post('/subscribe', authenticate, subscribe);
router.post('/unsubscribe', authenticate, unsubscribe);

export default router;
