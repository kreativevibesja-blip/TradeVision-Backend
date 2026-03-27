import { Router } from 'express';
import {
  analyzeChart,
  getAnalyses,
  getAnalysisById,
  getLiveChartMarketData,
} from '../controllers/analysisController';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { analysisLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/analyze-chart', authenticate, analysisLimiter, upload.fields([{ name: 'chart', maxCount: 1 }, { name: 'chart2', maxCount: 1 }]), analyzeChart);
router.get('/live-chart-market-data', authenticate, getLiveChartMarketData);
router.get('/analyses', authenticate, getAnalyses);
router.get('/analyses/:id', authenticate, getAnalysisById);

export default router;