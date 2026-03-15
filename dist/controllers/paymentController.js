"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentHistory = exports.handlePaymentSuccess = exports.createPayment = void 0;
const database_1 = __importDefault(require("../config/database"));
const paypalService_1 = require("../services/paypalService");
const createPayment = async (req, res) => {
    try {
        const { plan } = req.body;
        if (!plan || !['PRO'].includes(plan)) {
            return res.status(400).json({ error: 'Invalid plan' });
        }
        const pricing = await database_1.default.pricingPlan.findUnique({ where: { tier: plan } });
        const amount = pricing ? pricing.price.toString() : '19.00';
        const planName = pricing ? pricing.name : 'Pro';
        const order = await (0, paypalService_1.createOrder)(amount, planName);
        await database_1.default.payment.create({
            data: {
                userId: req.user.id,
                paypalOrderId: order.id,
                amount: parseFloat(amount),
                status: 'PENDING',
                plan: 'PRO',
            },
        });
        const approveLink = order.links?.find((l) => l.rel === 'approve')?.href;
        return res.json({ orderId: order.id, approveUrl: approveLink });
    }
    catch (error) {
        console.error('Create payment error:', error);
        return res.status(500).json({ error: 'Payment creation failed' });
    }
};
exports.createPayment = createPayment;
const handlePaymentSuccess = async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ error: 'Order ID is required' });
        }
        const capture = await (0, paypalService_1.captureOrder)(orderId);
        if (capture.status === 'COMPLETED') {
            await database_1.default.payment.update({
                where: { paypalOrderId: orderId },
                data: { status: 'COMPLETED' },
            });
            await database_1.default.user.update({
                where: { id: req.user.id },
                data: { subscription: 'PRO' },
            });
            return res.json({ success: true, message: 'Subscription activated' });
        }
        return res.status(400).json({ error: 'Payment not completed' });
    }
    catch (error) {
        console.error('Payment success error:', error);
        return res.status(500).json({ error: 'Payment processing failed' });
    }
};
exports.handlePaymentSuccess = handlePaymentSuccess;
const getPaymentHistory = async (req, res) => {
    try {
        const payments = await database_1.default.payment.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
        });
        return res.json({ payments });
    }
    catch (error) {
        console.error('Payment history error:', error);
        return res.status(500).json({ error: 'Failed to retrieve payments' });
    }
};
exports.getPaymentHistory = getPaymentHistory;
//# sourceMappingURL=paymentController.js.map