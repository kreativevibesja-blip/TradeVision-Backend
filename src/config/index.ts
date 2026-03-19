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

const frontendPreviewDomain = process.env.FRONTEND_PREVIEW_DOMAIN?.trim().toLowerCase() || '';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
  },

  admin: {
    emails: adminEmails,
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    freeModel: process.env.GEMINI_FREE_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    proModel: process.env.GEMINI_PRO_MODEL || 'gemini-3-flash',
    model: process.env.GEMINI_FREE_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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
    previewDomain: frontendPreviewDomain,
  },
  
  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
  },
  
  limits: {
    freeDaily: 3,
    proDaily: 999999,
  },
};
