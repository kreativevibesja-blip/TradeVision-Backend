"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfile = exports.login = exports.register = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const database_1 = __importDefault(require("../config/database"));
const isAdminEmail = (email) => config_1.config.admin.emails.includes(email.trim().toLowerCase());
const getJwtExpiryInSeconds = (value) => {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue;
    }
    const match = value.trim().match(/^(\d+)([smhd])$/i);
    if (!match) {
        return 7 * 24 * 60 * 60;
    }
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
        case 's':
            return amount;
        case 'm':
            return amount * 60;
        case 'h':
            return amount * 60 * 60;
        case 'd':
            return amount * 24 * 60 * 60;
        default:
            return 7 * 24 * 60 * 60;
    }
};
const jwtExpiresIn = getJwtExpiryInSeconds(config_1.config.jwt.expiresIn);
const register = async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const existing = await database_1.default.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 12);
        const normalizedEmail = email.trim().toLowerCase();
        const role = isAdminEmail(normalizedEmail) ? 'ADMIN' : 'USER';
        const user = await database_1.default.user.create({
            data: { email: normalizedEmail, password: hashedPassword, name, role },
            select: { id: true, email: true, name: true, role: true, subscription: true },
        });
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role, subscription: user.subscription }, config_1.config.jwt.secret, { expiresIn: jwtExpiresIn });
        return res.status(201).json({ user, token });
    }
    catch (error) {
        console.error('Register error:', error);
        return res.status(500).json({ error: 'Registration failed' });
    }
};
exports.register = register;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const normalizedEmail = email.trim().toLowerCase();
        let user = await database_1.default.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.banned) {
            return res.status(403).json({ error: 'Account has been suspended' });
        }
        if (!user.password) {
            return res.status(400).json({ error: 'This account uses Supabase sign-in. Please log in from the app.' });
        }
        const valid = await bcryptjs_1.default.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (isAdminEmail(normalizedEmail) && user.role !== 'ADMIN') {
            user = await database_1.default.user.update({
                where: { id: user.id },
                data: { role: 'ADMIN' },
            });
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role, subscription: user.subscription }, config_1.config.jwt.secret, { expiresIn: jwtExpiresIn });
        return res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                subscription: user.subscription,
            },
            token,
        });
    }
    catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Login failed' });
    }
};
exports.login = login;
const getProfile = async (req, res) => {
    try {
        const user = await database_1.default.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                subscription: true,
                dailyUsage: true,
                createdAt: true,
            },
        });
        return res.json({ user });
    }
    catch (error) {
        console.error('Profile error:', error);
        return res.status(500).json({ error: 'Failed to get profile' });
    }
};
exports.getProfile = getProfile;
//# sourceMappingURL=authController.js.map