import cors from 'cors';
import express from 'express';
import path from 'path';
import { config } from './config';
import { generalLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/authRoutes';
import analysisRoutes from './routes/analysisRoutes';
import paymentRoutes from './routes/paymentRoutes';
import adminRoutes from './routes/adminRoutes';
import ticketRoutes from './routes/ticketRoutes';

export const app = express();

app.set('trust proxy', 1);

const allowedOrigins = new Set(config.frontend.urls);
const previewDomain = config.frontend.previewDomain;

const isAllowedOrigin = (origin: string) => {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  if (!previewDomain) {
    return false;
  }

  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === 'https:' && hostname.endsWith(`.${previewDomain}`);
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);
app.use('/uploads', express.static(path.join(process.cwd(), config.upload.dir)));

app.use('/api/auth', authRoutes);
app.use('/api', analysisRoutes);
app.use('/api', paymentRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/debug/config', (_req, res) => {
  const mask = (value?: string) =>
    value && value.length > 4 ? `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)` : value ? '(set but short)' : '(MISSING)';

  res.json({
    SUPABASE_URL: mask(config.supabase.url),
    SUPABASE_ANON_KEY: mask(config.supabase.anonKey),
    SUPABASE_SERVICE_ROLE_KEY: mask(config.supabase.serviceRoleKey),
    FRONTEND_URLS: config.frontend.urls,
    NODE_ENV: config.nodeEnv,
  });
});

export const startServer = () =>
  app.listen(config.port, () => {
    console.log(`TradeVision AI API running on port ${config.port}`);
  });