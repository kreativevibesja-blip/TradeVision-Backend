import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getSystemSetting, getUserById, updateUser, type PlatformTheme } from '../lib/supabase';

const VALID_THEMES: PlatformTheme[] = ['legacy', 'goldx-premium'];

const resolveTheme = (value: unknown): PlatformTheme =>
  typeof value === 'string' && VALID_THEMES.includes(value as PlatformTheme)
    ? (value as PlatformTheme)
    : 'goldx-premium';

export const getActiveTheme = async (_req: AuthRequest, res: Response) => {
  try {
    const activeTheme = resolveTheme((await getSystemSetting('platform_theme_active'))?.value);
    return res.json({ activeTheme });
  } catch (error) {
    console.error('Theme active fetch error:', error);
    return res.status(500).json({ error: 'Failed to load active theme' });
  }
};

export const updateThemePreference = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const themePreference = resolveTheme(req.body?.themePreference);
    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await updateUser(userId, { theme_preference: themePreference });
    return res.json({ themePreference });
  } catch (error) {
    console.error('Theme preference update error:', error);
    return res.status(500).json({ error: 'Failed to update theme preference' });
  }
};