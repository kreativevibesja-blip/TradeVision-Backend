"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const paymentController_1 = require("../controllers/paymentController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.post('/create-payment', auth_1.authenticate, paymentController_1.createPayment);
router.post('/payment-success', auth_1.authenticate, paymentController_1.handlePaymentSuccess);
router.get('/payment-history', auth_1.authenticate, paymentController_1.getPaymentHistory);
exports.default = router;
//# sourceMappingURL=paymentRoutes.js.map