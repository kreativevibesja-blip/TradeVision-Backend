import { Router } from 'express';
import {
  analyzeChart,
  getAnalyses,
  getAnalysisById,
} from '../controllers/analysisController';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { analysisLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/analyze-chart', authenticate, analysisLimiter, upload.single('chart'), analyzeChart);
router.get('/analyses', authenticate, getAnalyses);
router.get('/analyses/:id', authenticate, getAnalysisById);

export default router;