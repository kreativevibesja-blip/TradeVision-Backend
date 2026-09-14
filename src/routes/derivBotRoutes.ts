import { Router } from 'express';
import { authenticate, requirePaidSubscription } from '../middleware/auth';
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

router.get('/auth/callback', derivBotCallback);
router.use(authenticate, requirePaidSubscription);

router.get('/auth/connect', connectDerivBot);
router.get('/accounts', getDerivBotAccounts);
router.post('/account/select', selectDerivBotAccountHandler);
router.get('/session', getDerivBotSessionHandler);
router.post('/scan', scanDerivBotHandler);
router.post('/proposal', getDerivBotProposalHandler);
router.post('/trade', tradeDerivBotHandler);
router.get('/trades', getDerivBotTradeHistoryHandler);
router.post('/disconnect', disconnectDerivBot);
router.post('/session/disconnect', disconnectDerivBotSessionHandler);

export default router;
