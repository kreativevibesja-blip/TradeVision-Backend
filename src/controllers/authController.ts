import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getUserById, getUserOnboardingProfile, upsertUserOnboardingProfile, type UserOnboardingResponses } from '../lib/supabase';
import { getBillingSummaryForUser } from '../services/billing';

const TRADER_LEVELS = new Set(['beginner', 'intermediate', 'experienced']);
const MARKETS = new Set(['forex', 'gold_and_commodities', 'crypto', 'stocks', 'indices', 'synthetic_indices', 'volatility_indices']);
const CHALLENGES = new Set(['finding_quality_entries', 'risk_management', 'emotional_trading', 'overtrading', 'understanding_structure', 'holding_trades', 'exiting_too_early', 'lack_of_consistency']);
const GOALS = new Set(['learn_profitability', 'become_consistent', 'pass_funded_challenges', 'build_second_income', 'trade_professionally', 'automate_execution']);
const ASSISTANCE_MODES = new Set(['smarter_chart_analysis', 'market_structure_guidance', 'trade_opportunity_tracking', 'strategy_refinement', 'risk_management_coaching', 'trade_journaling_insights', 'session_analysis', 'ai_mentor_feedback']);

const MARKET_LABELS: Record<string, string> = {
  forex: 'Forex',
  gold_and_commodities: 'Gold and Commodities',
  crypto: 'Crypto',
  stocks: 'Stocks',
  indices: 'Indices',
  synthetic_indices: 'Synthetic Indices',
  volatility_indices: 'Volatility Indices',
};

const CHALLENGE_LABELS: Record<string, string> = {
  finding_quality_entries: 'quality entries',
  risk_management: 'risk management',
  emotional_trading: 'emotional control',
  overtrading: 'overtrading control',
  understanding_structure: 'market structure',
  holding_trades: 'holding conviction',
  exiting_too_early: 'trade management patience',
  lack_of_consistency: 'consistency',
};

const GOAL_LABELS: Record<string, string> = {
  learn_profitability: 'learn to trade profitably',
  become_consistent: 'become more consistent',
  pass_funded_challenges: 'pass funded challenges',
  build_second_income: 'build a second income',
  trade_professionally: 'trade professionally',
  automate_execution: 'automate execution',
};

const ASSISTANCE_LABELS: Record<string, string> = {
  smarter_chart_analysis: 'smarter chart analysis',
  market_structure_guidance: 'market structure guidance',
  trade_opportunity_tracking: 'trade opportunity tracking',
  strategy_refinement: 'strategy refinement',
  risk_management_coaching: 'risk management coaching',
  trade_journaling_insights: 'trade journaling insights',
  session_analysis: 'session analysis',
  ai_mentor_feedback: 'AI mentor feedback',
};

const normalizeStringArray = (input: unknown, allowed: Set<string>) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.filter((value): value is string => typeof value === 'string' && allowed.has(value)))];
};

const buildMentorSummary = (responses: UserOnboardingResponses) => {
  const marketLabels = responses.markets.slice(0, 2).map((market) => MARKET_LABELS[market] ?? market);
  const assistanceLabel = responses.assistanceModes[0] ? ASSISTANCE_LABELS[responses.assistanceModes[0]] : 'institutional chart analysis';
  const goalLabel = responses.primaryGoal ? GOAL_LABELS[responses.primaryGoal] : 'trade with more structure';
  const challengeLabel = responses.biggestChallenge ? CHALLENGE_LABELS[responses.biggestChallenge] : 'decision quality';

  if (marketLabels.length >= 2) {
    return `Orion AI optimized your workspace for ${marketLabels[0]} and ${marketLabels[1]} analysis. Your mentor system will prioritize ${assistanceLabel} to improve ${challengeLabel} while helping you ${goalLabel}.`;
  }

  if (marketLabels.length === 1) {
    return `Orion AI optimized your workspace for ${marketLabels[0]} analysis. Your mentor system will prioritize ${assistanceLabel} to improve ${challengeLabel} while helping you ${goalLabel}.`;
  }

  return `Orion AI configured your workspace for institutional trading intelligence. Your mentor system will prioritize ${assistanceLabel} to improve ${challengeLabel} while helping you ${goalLabel}.`;
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUserById(req.user!.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const billing = await getBillingSummaryForUser(user.id, user.subscription);
    const onboarding = await getUserOnboardingProfile(user.id);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        subscription: billing.currentPlan,
        themePreference: user.theme_preference ?? 'legacy',
        dailyUsage: user.dailyUsage,
        createdAt: user.createdAt,
        onboarding: onboarding
          ? {
              completed: onboarding.completed,
              summary: onboarding.mentor_summary,
              responses: onboarding.responses,
            }
          : {
              completed: false,
              summary: null,
              responses: null,
            },
      },
    });
  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({ error: 'Failed to get profile' });
  }
};

export const saveOnboardingProfile = async (req: AuthRequest, res: Response) => {
  try {
    const traderLevel = typeof req.body?.traderLevel === 'string' && TRADER_LEVELS.has(req.body.traderLevel)
      ? req.body.traderLevel
      : null;
    const biggestChallenge = typeof req.body?.biggestChallenge === 'string' && CHALLENGES.has(req.body.biggestChallenge)
      ? req.body.biggestChallenge
      : null;
    const primaryGoal = typeof req.body?.primaryGoal === 'string' && GOALS.has(req.body.primaryGoal)
      ? req.body.primaryGoal
      : null;
    const markets = normalizeStringArray(req.body?.markets, MARKETS);
    const assistanceModes = normalizeStringArray(req.body?.assistanceModes, ASSISTANCE_MODES);

    if (!traderLevel || !biggestChallenge || !primaryGoal || markets.length === 0 || assistanceModes.length === 0) {
      return res.status(400).json({ error: 'All onboarding responses are required' });
    }

    const responses: UserOnboardingResponses = {
      traderLevel,
      markets,
      biggestChallenge,
      primaryGoal,
      assistanceModes,
    };

    const mentorSummary = buildMentorSummary(responses);
    const onboarding = await upsertUserOnboardingProfile(req.user!.id, {
      completed: true,
      responses,
      mentor_summary: mentorSummary,
    });

    return res.json({
      onboarding: {
        completed: onboarding.completed,
        summary: onboarding.mentor_summary,
        responses: onboarding.responses,
      },
    });
  } catch (error) {
    console.error('Onboarding save error:', error);
    return res.status(500).json({ error: 'Failed to save onboarding profile' });
  }
};
