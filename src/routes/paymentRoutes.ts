import { Router } from 'express';
import { cancelSubscription, createBankTransferRequest, createPayment, getBillingSummary, getPaymentHistory, getPayPalClientToken, handlePaymentSuccess } from '../controllers/paymentController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/paypal-client-token', authenticate, getPayPalClientToken);
router.post('/create-payment', authenticate, createPayment);
router.post('/bank-transfer-request', authenticate, createBankTransferRequest);
router.post('/payment-success', authenticate, handlePaymentSuccess);
router.get('/payment-history', authenticate, getPaymentHistory);
router.get('/billing-summary', authenticate, getBillingSummary);
router.post('/cancel-subscription', authenticate, cancelSubscription);

export default router;
