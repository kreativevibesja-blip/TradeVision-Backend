import { Response, NextFunction } from 'express';
import { type AuthRequest } from './auth';
import { type AnalysisFeatureName, type SubscriptionTier } from '../lib/supabase';

type FeatureRequirement = 'FREE' | 'PRO' | 'TOP_TIER';

const FEATURE_REQUIREMENTS: Record<AnalysisFeatureName, FeatureRequirement> = {
  reactionChallenge: 'FREE',
  confidenceThermometer: 'PRO',
  tradeReplay: 'TOP_TIER',
};

const PLAN_RANK: Record<SubscriptionTier, number> = {
  FREE: 0,
  PRO: 1,
  TOP_TIER: 2,
  VIP_AUTO_TRADER: 2,
};

const REQUIRED_RANK: Record<FeatureRequirement, number> = {
  FREE: 0,
  PRO: 1,
  TOP_TIER: 2,
};

export interface FeatureAccessResult {
  feature: AnalysisFeatureName;
  allowed: boolean;
  requiredPlan: FeatureRequirement;
  currentPlan: SubscriptionTier;
  upgradeRequired: 'PRO' | 'TOP_TIER' | null;
}

export const checkFeatureAccess = (userPlan: SubscriptionTier | string, featureName: AnalysisFeatureName): FeatureAccessResult => {
  const normalizedPlan = (userPlan === 'PRO' || userPlan === 'TOP_TIER' || userPlan === 'VIP_AUTO_TRADER')
    ? userPlan
    : 'FREE';

  const requiredPlan = FEATURE_REQUIREMENTS[featureName];
  const allowed = PLAN_RANK[normalizedPlan] >= REQUIRED_RANK[requiredPlan];

  return {
    feature: featureName,
    allowed,
    requiredPlan,
    currentPlan: normalizedPlan,
    upgradeRequired: allowed || requiredPlan === 'FREE' ? null : requiredPlan,
  };
};

export const requireFeatureAccess = (featureName: AnalysisFeatureName) => (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const access = checkFeatureAccess(req.user.subscription, featureName);
  if (!access.allowed) {
    return res.status(403).json({
      error: `This feature requires the ${access.requiredPlan === 'TOP_TIER' ? 'Pro+' : access.requiredPlan} plan`,
      featureAccess: access,
    });
  }

  req.featureAccess = access;
  return next();
};