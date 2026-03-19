import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getUserById } from '../lib/supabase';
import { getBillingSummaryForUser } from '../services/billingService';

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUserById(req.user!.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const billing = await getBillingSummaryForUser(user.id, user.subscription);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        subscription: billing.currentPlan,
        dailyUsage: user.dailyUsage,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({ error: 'Failed to get profile' });
  }
};
