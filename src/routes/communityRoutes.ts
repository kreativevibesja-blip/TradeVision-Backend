import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { aiCompareLimiter } from '../middleware/rateLimiter';
import {
  getPostAiCompares,
  publishAiCompare,
  runAiCompare,
  saveAiCompareToJournal,
  sendAiCompareToRadar,
} from '../controllers/communityController';

const router = Router();

router.use(authenticate);

router.post('/posts/:postId/ai-compare', aiCompareLimiter, runAiCompare);
router.get('/posts/:postId/ai-compares', getPostAiCompares);
router.post('/ai-compare/:compareId/publish', publishAiCompare);
router.post('/ai-compare/:compareId/save-journal', saveAiCompareToJournal);
router.post('/ai-compare/:compareId/send-radar', sendAiCompareToRadar);

export default router;
