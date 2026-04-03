import dotenv from 'dotenv';
dotenv.config();

const adminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const frontendUrls = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

const normalizeHostOrDomain = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/^\./, '').replace(/\/.*$/, '');
  }
};

const configuredPreviewDomains = (process.env.FRONTEND_PREVIEW_DOMAIN || '')
  .split(',')
  .map(normalizeHostOrDomain)
  .filter(Boolean);

const inferredPreviewDomains = frontendUrls
  .map(normalizeHostOrDomain)
  .filter((value) => value === 'vercel.app' || value.endsWith('.vercel.app'))
  .map(() => 'vercel.app');

const frontendPreviewDomains = Array.from(new Set([...configuredPreviewDomains, ...inferredPreviewDomains]));

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'chart-markups',
  },

  admin: {
    emails: adminEmails,
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    freeModel: process.env.GEMINI_FREE_MODEL || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview',
    proModel: process.env.GEMINI_PRO_MODEL || 'gemini-3-flash-preview',
    model: process.env.GEMINI_FREE_MODEL || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    freeModel: process.env.OPENAI_FREE_MODEL || 'gpt-5.1',
    proModel: process.env.OPENAI_PRO_MODEL || 'gpt-5.1',
  },

  marketData: {
    provider: process.env.MARKET_DATA_PROVIDER || 'twelvedata',
    twelveDataApiKey: process.env.TWELVEDATA_API_KEY || '',
    twelveDataBaseUrl: process.env.TWELVEDATA_BASE_URL || 'https://api.twelvedata.com',
    candleLimit: parseInt(process.env.MARKET_DATA_CANDLE_LIMIT || '5000', 10),
  },

  deriv: {
    wsUrl: process.env.DERIV_WS_URL || 'wss://ws.derivws.com/websockets/v3',
    appId: process.env.DERIV_WS_APP_ID || '1089',
    historyM1Count: parseInt(process.env.DERIV_HISTORY_M1_COUNT || '3000', 10),
    candleEngineIntervalMs: parseInt(process.env.DERIV_CANDLE_ENGINE_INTERVAL_MS || '60000', 10),
    reconnectDelayMs: parseInt(process.env.DERIV_RECONNECT_DELAY_MS || '5000', 10),
    maxStoredTicksPerSymbol: parseInt(process.env.DERIV_MAX_STORED_TICKS_PER_SYMBOL || '5000', 10),
  },
  
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    mode: process.env.PAYPAL_MODE || 'sandbox',
    baseUrl: process.env.PAYPAL_MODE === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com',
  },
  
  frontend: {
    url: frontendUrls[0] || 'http://localhost:3000',
    urls: frontendUrls,
    previewDomains: frontendPreviewDomains,
  },
  
  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
  },

  email: {
    provider: process.env.EMAIL_PROVIDER || 'resend',
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || 'MyTradeVision Support <help@mytradevision.online>',
    replyTo: process.env.EMAIL_REPLY_TO || 'help@mytradevision.online',
  },
  
  limits: {
    freeDaily: 2,
    proMonthly: 300,
  },
};
