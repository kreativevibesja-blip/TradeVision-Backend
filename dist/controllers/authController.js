"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfile = void 0;
const supabase_1 = require("../lib/supabase");
const getProfile = async (req, res) => {
    try {
        const user = await (0, supabase_1.getUserById)(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                subscription: user.subscription,
                dailyUsage: user.dailyUsage,
                createdAt: user.createdAt,
            },
        });
    }
    catch (error) {
        console.error('Profile error:', error);
        return res.status(500).json({ error: 'Failed to get profile' });
    }
};
exports.getProfile = getProfile;
//# sourceMappingURL=authController.js.map