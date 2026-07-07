import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getSignalWatchlist, sendSignalNotification, subscribe, unsubscribe, updateSignalWatchlist } from '../controllers/notificationController';

const router = Router();

router.post('/subscribe', authenticate, subscribe);
router.post('/unsubscribe', authenticate, unsubscribe);
router.get('/signals/watchlist', authenticate, getSignalWatchlist);
router.post('/signals/watchlist', authenticate, updateSignalWatchlist);
router.post('/signals', authenticate, sendSignalNotification);

export default router;
