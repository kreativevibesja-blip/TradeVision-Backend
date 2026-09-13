import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  connectDerivBot,
  derivBotCallback,
  disconnectDerivBot,
  getDerivBotAccounts,
  getDerivBotSessionHandler,
  selectDerivBotAccountHandler,
  scanDerivBotHandler,
  getDerivBotProposalHandler,
  getDerivBotTradeHistoryHandler,
  tradeDerivBotHandler,
  disconnectDerivBotSessionHandler,
} from '../controllers/derivBotController';

const router = Router();

router.get('/auth/connect', authenticate, connectDerivBot);
router.get('/auth/callback', derivBotCallback);
router.get('/accounts', authenticate, getDerivBotAccounts);
router.post('/account/select', authenticate, selectDerivBotAccountHandler);
router.get('/session', authenticate, getDerivBotSessionHandler);
router.post('/scan', authenticate, scanDerivBotHandler);
router.post('/proposal', authenticate, getDerivBotProposalHandler);
router.post('/trade', authenticate, tradeDerivBotHandler);
router.get('/trades', authenticate, getDerivBotTradeHistoryHandler);
router.post('/disconnect', authenticate, disconnectDerivBot);
router.post('/session/disconnect', authenticate, disconnectDerivBotSessionHandler);

export default router;
