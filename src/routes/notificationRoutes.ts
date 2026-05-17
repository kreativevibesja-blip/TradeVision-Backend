import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { sendSignalNotification, subscribe, unsubscribe } from '../controllers/notificationController';

const router = Router();

router.post('/subscribe', authenticate, subscribe);
router.post('/unsubscribe', authenticate, unsubscribe);
router.post('/signals', authenticate, sendSignalNotification);

export default router;
