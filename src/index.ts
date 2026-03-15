import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { generalLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/authRoutes';
import analysisRoutes from './routes/analysisRoutes';
import paymentRoutes from './routes/paymentRoutes';
import adminRoutes from './routes/adminRoutes';

const app = express();

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

// Middleware
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

// Static files for uploaded images
app.use('/uploads', express.static(path.join(process.cwd(), config.upload.dir)));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', analysisRoutes);
app.use('/api', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(config.port, () => {
  console.log(`🚀 TradeVision AI API running on port ${config.port}`);
});

export default app;
