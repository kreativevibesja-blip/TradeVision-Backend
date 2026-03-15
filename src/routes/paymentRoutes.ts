import { Router } from 'express';
import { createPayment, handlePaymentSuccess, getPaymentHistory } from '../controllers/paymentController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/create-payment', authenticate, createPayment);
router.post('/payment-success', authenticate, handlePaymentSuccess);
router.get('/payment-history', authenticate, getPaymentHistory);

export default router;
