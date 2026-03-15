"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
exports.captureOrder = captureOrder;
const config_1 = require("../config");
async function getAccessToken() {
    const auth = Buffer.from(`${config_1.config.paypal.clientId}:${config_1.config.paypal.clientSecret}`).toString('base64');
    const response = await fetch(`${config_1.config.paypal.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });
    const data = (await response.json());
    return data.access_token;
}
async function createOrder(amount, planName) {
    const accessToken = await getAccessToken();
    const response = await fetch(`${config_1.config.paypal.baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [
                {
                    amount: {
                        currency_code: 'USD',
                        value: amount,
                    },
                    description: `TradeVision AI - ${planName} Plan`,
                },
            ],
            application_context: {
                brand_name: 'TradeVision AI',
                return_url: `${config_1.config.frontend.url}/checkout?success=true`,
                cancel_url: `${config_1.config.frontend.url}/checkout?canceled=true`,
                user_action: 'PAY_NOW',
            },
        }),
    });
    return (await response.json());
}
async function captureOrder(orderId) {
    const accessToken = await getAccessToken();
    const response = await fetch(`${config_1.config.paypal.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });
    return response.json();
}
//# sourceMappingURL=paypalService.js.map