import { Router } from 'express';
import { cancelSubscription, createPayment, getBillingSummary, getPaymentHistory, handlePaymentSuccess } from '../controllers/paymentController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/create-payment', authenticate, createPayment);
router.post('/payment-success', authenticate, handlePaymentSuccess);
router.get('/payment-history', authenticate, getPaymentHistory);
router.get('/billing-summary', authenticate, getBillingSummary);
router.post('/cancel-subscription', authenticate, cancelSubscription);

export default router;
