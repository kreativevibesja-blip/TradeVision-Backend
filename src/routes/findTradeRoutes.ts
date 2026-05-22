import { Router } from 'express';
import { authenticate, requireTopTier } from '../middleware/auth';
import {
  enteredFindTrade,
  getFindTradeHistoryHandler,
  getFindTradeStatusHandler,
  getJournalHandler,
  getJournalInsightsHandler,
  postJournalNoteHandler,
  resetFindTradeHandler,
  scanFindTrade,
} from '../controllers/findTradeController';

const router = Router();

router.use(authenticate, requireTopTier);

router.post('/find-trade/scan', scanFindTrade);
router.post('/find-trade/reset', resetFindTradeHandler);
router.post('/find-trade/entered', enteredFindTrade);
router.get('/find-trade/status/:id', getFindTradeStatusHandler);
router.get('/find-trade/history', getFindTradeHistoryHandler);
router.get('/journal', getJournalHandler);
router.get('/journal/insights', getJournalInsightsHandler);
router.post('/journal/note', postJournalNoteHandler);

export default router;