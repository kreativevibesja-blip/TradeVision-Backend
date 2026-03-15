import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import prisma from '../config/database';
import { supabase } from '../config/supabase';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    subscription: string;
  };
}

const isAdminEmail = (email: string) => config.admin.emails.includes(email.trim().toLowerCase());
const SUPABASE_PASSWORD_PLACEHOLDER = '__supabase_managed_account__';

const getDisplayName = (userMetadata: Record<string, unknown> | undefined) => {
  const value = userMetadata?.name ?? userMetadata?.full_name;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user?.email) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const normalizedEmail = data.user.email.trim().toLowerCase();
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user?.banned) {
      return res.status(403).json({ error: 'Account has been suspended' });
    }

    const shouldBeAdmin = isAdminEmail(normalizedEmail) || user?.role === 'ADMIN';
    const role = shouldBeAdmin ? 'ADMIN' : 'USER';
    const name = getDisplayName(data.user.user_metadata);

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          name,
          password: SUPABASE_PASSWORD_PLACEHOLDER,
          role,
        },
      });
    } else {
      const nextName = user.name ?? name;
      const needsUpdate =
        user.email !== normalizedEmail ||
        user.role !== role ||
        user.name !== nextName;

      if (needsUpdate) {
        user = await prisma.user.update({
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
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
