"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = exports.authenticate = void 0;
const config_1 = require("../config");
const supabase_1 = require("../lib/supabase");
const isAdminEmail = (email) => config_1.config.admin.emails.includes(email.trim().toLowerCase());
const SUPABASE_PASSWORD_PLACEHOLDER = '__supabase_managed_account__';
const getDisplayName = (userMetadata) => {
    const value = userMetadata?.name ?? userMetadata?.full_name;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};
const getSupabaseIdentity = async (token) => {
    console.log('[auth] validating token, length:', token.length, 'prefix:', token.slice(0, 20) + '...');
    console.log('[auth] SUPABASE_URL configured:', !!config_1.config.supabase.url, '| SERVICE_ROLE_KEY set:', !!config_1.config.supabase.serviceRoleKey, '| ANON_KEY set:', !!config_1.config.supabase.anonKey);
    try {
        const { data, error } = await supabase_1.supabase.auth.getUser(token);
        if (error) {
            console.error('[auth] supabase.auth.getUser error:', error.message, '| status:', error.status);
            return null;
        }
        if (!data.user?.id || !data.user?.email) {
            console.error('[auth] supabase.auth.getUser returned no id/email, data:', JSON.stringify(data));
            return null;
        }
        console.log('[auth] token valid for user:', data.user.email);
        return {
            id: data.user.id,
            email: data.user.email,
            userMetadata: data.user.user_metadata && typeof data.user.user_metadata === 'object'
                ? data.user.user_metadata
                : undefined,
        };
    }
    catch (error) {
        console.error('[auth] supabase.auth.getUser threw:', error);
        return null;
    }
};
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const token = authHeader.substring(7);
        const identity = await getSupabaseIdentity(token);
        if (!identity) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const normalizedEmail = identity.email.trim().toLowerCase();
        let user;
        try {
            user = await (0, supabase_1.getUserByEmail)(normalizedEmail);
            if (user?.banned) {
                return res.status(403).json({ error: 'Account has been suspended' });
            }
            const shouldBeAdmin = isAdminEmail(normalizedEmail) || user?.role === 'ADMIN';
            const role = shouldBeAdmin ? 'ADMIN' : 'USER';
            const name = getDisplayName(identity.userMetadata);
            if (!user) {
                user = await (0, supabase_1.createUser)({
                    supabaseId: identity.id,
                    email: normalizedEmail,
                    name,
                    password: SUPABASE_PASSWORD_PLACEHOLDER,
                    role,
                });
            }
            else {
                const nextName = user.name ?? name;
                const needsUpdate = user.supabaseId !== identity.id ||
                    user.email !== normalizedEmail ||
                    user.role !== role ||
                    user.name !== nextName;
                if (needsUpdate) {
                    user = await (0, supabase_1.updateUser)(user.id, {
                        supabaseId: identity.id,
                        email: normalizedEmail,
                        name: nextName,
                        role,
                    });
                }
            }
        }
        catch (databaseError) {
            console.error('[auth] database sync failed after token validation:', databaseError);
            return res.status(503).json({ error: 'Authentication succeeded, but the profile database is unavailable' });
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
        return res.status(500).json({ error: 'Authentication failed' });
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