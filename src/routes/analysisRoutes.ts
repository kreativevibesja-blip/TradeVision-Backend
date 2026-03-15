import { Router } from 'express';
import {
  uploadChart,
  analyzeChartController,
  getAnalyses,
  getAnalysisById,
} from '../controllers/analysisController';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { analysisLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/upload-chart', authenticate, upload.single('chart'), uploadChart);
router.post('/analyze-chart', authenticate, analysisLimiter, analyzeChartController);
router.get('/analyses', authenticate, getAnalyses);
router.get('/analyses/:id', authenticate, getAnalysisById);

export default router;
