import { config } from '../config';

interface PayPalTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface PayPalClientTokenResponse {
  access_token: string;
}

interface PayPalOrder {
  id: string;
  status: string;
  links: { href: string; rel: string; method: string }[];
}

async function getAccessToken(): Promise<string> {
  const auth = Buffer.from(
    `${config.paypal.clientId}:${config.paypal.clientSecret}`
  ).toString('base64');

  const response = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const data = (await response.json()) as PayPalTokenResponse;
  return data.access_token;
}

export async function generateClientToken(): Promise<string> {
  const auth = Buffer.from(
    `${config.paypal.clientId}:${config.paypal.clientSecret}`
  ).toString('base64');

  const domains = config.frontend.urls
    .map((url) => `domains[]=${encodeURIComponent(url)}`)
    .join('&');

  const body = [
    'grant_type=client_credentials',
    'response_type=client_token',
    'intent=sdk_init',
    domains,
  ]
    .filter(Boolean)
    .join('&');

  const response = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = (await response.json()) as PayPalClientTokenResponse;
  return data.access_token;
}

export async function createOrder(amount: string, planName: string): Promise<PayPalOrder> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${config.paypal.baseUrl}/v2/checkout/orders`, {
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
        return_url: `${config.frontend.url}/checkout?success=true`,
        cancel_url: `${config.frontend.url}/checkout?canceled=true`,
        user_action: 'PAY_NOW',
      },
    }),
  });

  return (await response.json()) as PayPalOrder;
}

export async function captureOrder(orderId: string): Promise<any> {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${config.paypal.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.json();
}
