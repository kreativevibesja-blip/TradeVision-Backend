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
import couponRoutes from './routes/couponRoutes';
import referralRoutes from './routes/referralRoutes';
import queueRoutes from './routes/queueRoutes';
import presenceRoutes from './routes/presenceRoutes';
import scannerRoutes from './routes/scannerRoutes';
import notificationRoutes from './routes/notificationRoutes';
import commandCenterRoutes from './routes/commandCenterRoutes';
import radarRoutes from './routes/radarRoutes';
import goldxRoutes from './routes/goldx';
import debugRoutes from './routes/debugRoutes';
import { startQueueWorker } from './workers/queueWorker';
import { startSystem } from './server/start';
import { startRadarTracker } from './services/radarTracker';

export const app = express();

app.set('trust proxy', 1);

const allowedOrigins = new Set(config.frontend.urls);
const previewDomains = config.frontend.previewDomains;

const isAllowedOrigin = (origin: string) => {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  if (!previewDomains.length) {
    return false;
  }

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:') {
      return false;
    }

    const normalizedHostname = hostname.toLowerCase();
    return previewDomains.some((domain) => normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`));
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
app.use('/api/coupons', couponRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', queueRoutes);
app.use('/api', presenceRoutes);
app.use('/api/scanner', scannerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', commandCenterRoutes);
app.use('/api/radar', radarRoutes);
app.use('/api/goldx', goldxRoutes);
app.use('/api/debug', debugRoutes);

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
    startQueueWorker();
    startSystem();
    startRadarTracker();
  });