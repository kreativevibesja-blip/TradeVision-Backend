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
  console.log('[auth] validating token, length:', token.length, 'prefix:', token.slice(0, 20) + '...');
  console.log('[auth] SUPABASE_URL configured:', !!config.supabase.url, '| SERVICE_ROLE_KEY set:', !!config.supabase.serviceRoleKey, '| ANON_KEY set:', !!config.supabase.anonKey);

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      console.error('[auth] supabase.auth.getUser error:', error.message, '| status:', (error as any).status);
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
      userMetadata:
        data.user.user_metadata && typeof data.user.user_metadata === 'object'
          ? data.user.user_metadata
          : undefined,
    };
  } catch (error) {
    console.error('[auth] supabase.auth.getUser threw:', error);
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
          supabaseId: identity.id,
          email: normalizedEmail,
          name,
          password: SUPABASE_PASSWORD_PLACEHOLDER,
          role,
        },
      });
    } else {
      const nextName = user.name ?? name;
      const needsUpdate =
        user.supabaseId !== identity.id ||
        user.email !== normalizedEmail ||
        user.role !== role ||
        user.name !== nextName;

      if (needsUpdate) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            supabaseId: identity.id,
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
