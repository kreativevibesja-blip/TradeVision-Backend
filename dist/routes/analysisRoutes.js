"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const analysisController_1 = require("../controllers/analysisController");
const auth_1 = require("../middleware/auth");
const upload_1 = require("../middleware/upload");
const rateLimiter_1 = require("../middleware/rateLimiter");
const router = (0, express_1.Router)();
router.post('/upload-chart', auth_1.authenticate, upload_1.upload.single('chart'), analysisController_1.uploadChart);
router.post('/analyze-chart', auth_1.authenticate, rateLimiter_1.analysisLimiter, analysisController_1.analyzeChartController);
router.get('/analyses', auth_1.authenticate, analysisController_1.getAnalyses);
router.get('/analyses/:id', auth_1.authenticate, analysisController_1.getAnalysisById);
exports.default = router;
//# sourceMappingURL=analysisRoutes.js.map