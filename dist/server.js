"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = exports.app = void 0;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const rateLimiter_1 = require("./middleware/rateLimiter");
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const analysisRoutes_1 = __importDefault(require("./routes/analysisRoutes"));
const paymentRoutes_1 = __importDefault(require("./routes/paymentRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
exports.app = (0, express_1.default)();
exports.app.set('trust proxy', 1);
const allowedOrigins = new Set(config_1.config.frontend.urls);
const previewDomain = config_1.config.frontend.previewDomain;
const isAllowedOrigin = (origin) => {
    if (allowedOrigins.has(origin)) {
        return true;
    }
    if (!previewDomain) {
        return false;
    }
    try {
        const { hostname, protocol } = new URL(origin);
        return protocol === 'https:' && hostname.endsWith(`.${previewDomain}`);
    }
    catch {
        return false;
    }
};
exports.app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || isAllowedOrigin(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
}));
exports.app.use(express_1.default.json({ limit: '10mb' }));
exports.app.use(express_1.default.urlencoded({ extended: true }));
exports.app.use(rateLimiter_1.generalLimiter);
exports.app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), config_1.config.upload.dir)));
exports.app.use('/api/auth', authRoutes_1.default);
exports.app.use('/api', analysisRoutes_1.default);
exports.app.use('/api', paymentRoutes_1.default);
exports.app.use('/api/admin', adminRoutes_1.default);
exports.app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
exports.app.get('/api/debug/config', (_req, res) => {
    const mask = (value) => value && value.length > 4 ? `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)` : value ? '(set but short)' : '(MISSING)';
    res.json({
        SUPABASE_URL: mask(config_1.config.supabase.url),
        SUPABASE_ANON_KEY: mask(config_1.config.supabase.anonKey),
        SUPABASE_SERVICE_ROLE_KEY: mask(config_1.config.supabase.serviceRoleKey),
        FRONTEND_URLS: config_1.config.frontend.urls,
        NODE_ENV: config_1.config.nodeEnv,
    });
});
const startServer = () => exports.app.listen(config_1.config.port, () => {
    console.log(`TradeVision AI API running on port ${config_1.config.port}`);
});
exports.startServer = startServer;
//# sourceMappingURL=server.js.map