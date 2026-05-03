import { Router } from 'express';
import {
  analyzeChart,
  createInteractiveAnalysisEvent,
  getDerivLiveChartMarketData,
  getAnalyses,
  getAnalysisById,
  getAnalysisConfidence,
  getAnalysisInteractions,
  getLiveChartMarketData,
  getTradeReplay,
  recordUploadError,
} from '../controllers/analysisController';
import { authenticate } from '../middleware/auth';
import { requireFeatureAccess } from '../middleware/checkFeatureAccess';
import { handleChartUpload } from '../middleware/upload';
import { analysisLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/upload-errors', recordUploadError);
router.post('/analyze-chart', authenticate, analysisLimiter, handleChartUpload, analyzeChart);
router.get('/live-chart-market-data', authenticate, getLiveChartMarketData);
router.get('/deriv-live-chart-market-data', authenticate, getDerivLiveChartMarketData);
router.get('/analyses', authenticate, getAnalyses);
router.get('/analyses/:id', authenticate, getAnalysisById);
router.get('/analysis/confidence/:analysisId', authenticate, requireFeatureAccess('confidenceThermometer'), getAnalysisConfidence);
router.get('/analysis/replay/:analysisId', authenticate, requireFeatureAccess('tradeReplay'), getTradeReplay);
router.get('/analysis/interactions/:analysisId', authenticate, getAnalysisInteractions);
router.post('/analysis/interactions/:analysisId', authenticate, createInteractiveAnalysisEvent);

export default router;