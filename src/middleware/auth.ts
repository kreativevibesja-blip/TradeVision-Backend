import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
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

type SupabaseIdentity = {
  id: string;
  email: string;
  userMetadata?: Record<string, unknown>;
};

type SupabaseJwtPayload = {
  sub?: string;
  email?: string;
  aud?: string | string[];
  iss?: string;
  role?: string;
  user_metadata?: Record<string, unknown>;
};

const supabaseIssuer = `${config.supabase.url.replace(/\/$/, '')}/auth/v1`;
const supabaseJwks = createRemoteJWKSet(new URL(`${supabaseIssuer}/.well-known/jwks.json`));
const supabaseJwtSecret = config.supabase.jwtSecret ? new TextEncoder().encode(config.supabase.jwtSecret) : null;

const getDisplayName = (userMetadata: Record<string, unknown> | undefined) => {
  const value = userMetadata?.name ?? userMetadata?.full_name;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getSupabaseIdentity = async (token: string): Promise<SupabaseIdentity | null> => {
  if (supabaseJwtSecret) {
    try {
      const { payload } = await jwtVerify(token, supabaseJwtSecret, {
        issuer: supabaseIssuer,
      });

      const claims = payload as SupabaseJwtPayload;
      const id = typeof claims.sub === 'string' ? claims.sub : null;
      const email = typeof claims.email === 'string' ? claims.email : null;
      const userMetadata =
        claims.user_metadata && typeof claims.user_metadata === 'object'
          ? claims.user_metadata
          : undefined;

      if (id && email) {
        return { id, email, userMetadata };
      }
    } catch (error) {
      console.error('Supabase JWT secret verification failed:', error);
    }
  }

  try {
    const { payload } = await jwtVerify(token, supabaseJwks, {
      issuer: supabaseIssuer,
    });

    const claims = payload as SupabaseJwtPayload;
    const id = typeof claims.sub === 'string' ? claims.sub : null;
    const email = typeof claims.email === 'string' ? claims.email : null;
    const userMetadata =
      claims.user_metadata && typeof claims.user_metadata === 'object'
        ? claims.user_metadata
        : undefined;

    if (!id || !email) {
      return null;
    }

    return { id, email, userMetadata };
  } catch (error) {
    console.error('Supabase JWT verification failed:', error);
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user?.email) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email,
      userMetadata:
        data.user.user_metadata && typeof data.user.user_metadata === 'object'
          ? (data.user.user_metadata as Record<string, unknown>)
          : undefined,
    };
  } catch (error) {
    console.error('Supabase getUser fallback failed:', error);
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
