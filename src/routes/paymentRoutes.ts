import { Router } from 'express';
import { cancelGoldxPulseSubscription, cancelSubscription, createBankTransferRequest, createPayment, getBillingSummary, getPaymentHistory, getPayPalClientToken, handlePaymentSuccess, renewGoldxPulseSubscription } from '../controllers/paymentController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/paypal-client-token', authenticate, getPayPalClientToken);
router.post('/create-payment', authenticate, createPayment);
router.post('/bank-transfer-request', authenticate, createBankTransferRequest);
router.post('/payment-success', authenticate, handlePaymentSuccess);
router.get('/payment-history', authenticate, getPaymentHistory);
router.get('/billing-summary', authenticate, getBillingSummary);
router.post('/cancel-subscription', authenticate, cancelSubscription);
router.post('/goldx-pulse/cancel-subscription', authenticate, cancelGoldxPulseSubscription);
router.post('/goldx-pulse/renew-subscription', authenticate, renewGoldxPulseSubscription);

export default router;
