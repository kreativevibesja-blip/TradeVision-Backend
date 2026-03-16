import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import prisma from '../config/database';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    subscription: string;
  };
}

type SupabaseIdentity = {
  id: string;
  email: string;
  userMetadata?: Record<string, unknown>;
};

const isAdminEmail = (email: string) => config.admin.emails.includes(email.trim().toLowerCase());
const SUPABASE_PASSWORD_PLACEHOLDER = '__supabase_managed_account__';

const getDisplayName = (userMetadata: Record<string, unknown> | undefined) => {
  const value = userMetadata?.name ?? userMetadata?.full_name;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getSupabaseIdentity = async (token: string): Promise<SupabaseIdentity | null> => {
  const supabaseApiKey = config.supabase.serviceRoleKey || config.supabase.anonKey;

  if (!config.supabase.url || !supabaseApiKey) {
    console.error('Supabase auth validation skipped because backend credentials are missing.');
    return null;
  }

  try {
    const response = await fetch(`${config.supabase.url.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseApiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Supabase token validation failed:', response.status, response.statusText);
      return null;
    }

    const user = (await response.json()) as {
      id?: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
    };

    if (!user.id || !user.email) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      userMetadata:
        user.user_metadata && typeof user.user_metadata === 'object'
          ? user.user_metadata
          : undefined,
    };
  } catch (error) {
    console.error('Supabase getUser request failed:', error);
    return null;
  }
};

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user?.banned) {
      return res.status(403).json({ error: 'Account has been suspended' });
    }

    const shouldBeAdmin = isAdminEmail(normalizedEmail) || user?.role === 'ADMIN';
    const role = shouldBeAdmin ? 'ADMIN' : 'USER';
    const name = getDisplayName(identity.userMetadata);

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
