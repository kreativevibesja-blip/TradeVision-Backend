import { Router } from 'express';
import {
  analyzeChart,
  getDerivLiveChartMarketData,
  getAnalyses,
  getAnalysisById,
  getLiveChartMarketData,
  recordUploadError,
} from '../controllers/analysisController';
import { authenticate } from '../middleware/auth';
import { handleChartUpload } from '../middleware/upload';
import { analysisLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/upload-errors', recordUploadError);
router.post('/analyze-chart', authenticate, analysisLimiter, handleChartUpload, analyzeChart);
router.get('/live-chart-market-data', authenticate, getLiveChartMarketData);
router.get('/deriv-live-chart-market-data', authenticate, getDerivLiveChartMarketData);
router.get('/analyses', authenticate, getAnalyses);
router.get('/analyses/:id', authenticate, getAnalysisById);

export default router;