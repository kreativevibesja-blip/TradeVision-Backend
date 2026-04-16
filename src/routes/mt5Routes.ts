import { Router } from 'express';
import { authenticate, requireVipAutoTrader } from '../middleware/auth';
import { connectMT5, executeManualMT5Trade } from '../controllers/mt5Controller';

const router = Router();

router.use(authenticate, requireVipAutoTrader);

router.post('/connect', connectMT5);
router.post('/trade', executeManualMT5Trade);

export default router;
