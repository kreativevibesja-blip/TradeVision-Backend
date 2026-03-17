import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getUserById } from '../lib/supabase';

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUserById(req.user!.id);

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
  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({ error: 'Failed to get profile' });
  }
};
