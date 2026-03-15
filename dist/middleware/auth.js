"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = exports.authenticate = void 0;
const config_1 = require("../config");
const database_1 = __importDefault(require("../config/database"));
const supabase_1 = require("../config/supabase");
const isAdminEmail = (email) => config_1.config.admin.emails.includes(email.trim().toLowerCase());
const SUPABASE_PASSWORD_PLACEHOLDER = '__supabase_managed_account__';
const getDisplayName = (userMetadata) => {
    const value = userMetadata?.name ?? userMetadata?.full_name;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const token = authHeader.substring(7);
        const { data, error } = await supabase_1.supabase.auth.getUser(token);
        if (error || !data.user?.email) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const normalizedEmail = data.user.email.trim().toLowerCase();
        let user = await database_1.default.user.findUnique({ where: { email: normalizedEmail } });
        if (user?.banned) {
            return res.status(403).json({ error: 'Account has been suspended' });
        }
        const shouldBeAdmin = isAdminEmail(normalizedEmail) || user?.role === 'ADMIN';
        const role = shouldBeAdmin ? 'ADMIN' : 'USER';
        const name = getDisplayName(data.user.user_metadata);
        if (!user) {
            user = await database_1.default.user.create({
                data: {
                    email: normalizedEmail,
                    name,
                    password: SUPABASE_PASSWORD_PLACEHOLDER,
                    role,
                },
            });
        }
        else {
            const nextName = user.name ?? name;
            const needsUpdate = user.email !== normalizedEmail ||
                user.role !== role ||
                user.name !== nextName;
            if (needsUpdate) {
                user = await database_1.default.user.update({
                    where: { id: user.id },
                    data: {
                        email: normalizedEmail,
                        name: nextName,
                        role,
                    },
                });
            }
        }
        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            subscription: user.subscription,
        };
        next();
    }
    catch (error) {
        console.error('Authentication error:', error);
        return res.status(401).json({ error: 'Invalid token' });
    }
};
exports.authenticate = authenticate;
const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};
exports.requireAdmin = requireAdmin;
//# sourceMappingURL=auth.js.map