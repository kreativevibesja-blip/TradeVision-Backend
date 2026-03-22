import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';
import {
  getReferralCodeByUserId,
  getReferralCodeByCode,
  createReferralCode,
  updateReferralCode,
  listReferralsByReferrerId,
  listCommissionsByReferrerId,
  sumApprovedCommissions,
  sumPaidCommissions,
  sumPendingCommissions,
  createPayout,
  listPayoutsForUser,
  getUserById,
  getReferralByReferredUserId,
  getSystemSetting,
  type ReferralCodeRecord,
} from '../lib/supabase';
import { getReferralDiscountForUser, processReferralSignup } from '../services/referralService';
import { sendPayoutRequestedEmail } from '../services/emailService';

const generateCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

// GET /referrals/my-code
export const getMyReferralCode = async (req: AuthRequest, res: Response) => {
  try {
    let codeRecord = await getReferralCodeByUserId(req.user!.id);

    if (!codeRecord) {
      // Auto-generate a referral code for the user
      let code = generateCode();
      let attempts = 0;
      while (await getReferralCodeByCode(code)) {
        code = generateCode();
        attempts++;
        if (attempts > 10) {
          code = `REF${Date.now().toString(36).toUpperCase()}`;
          break;
        }
      }
      codeRecord = await createReferralCode({ userId: req.user!.id, code });
    }

    const discountSetting = await getSystemSetting('referral_discount_percent');
    const discountPercent = discountSetting ? Number(discountSetting.value) : 20;

    return res.json({ referralCode: codeRecord, discountPercent });
  } catch (error) {
    console.error('Get referral code error:', error);
    return res.status(500).json({ error: 'Failed to get referral code' });
  }
};

// PATCH /referrals/my-code
export const updateMyReferralCode = async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Code is required' });
    }

    const sanitized = code.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    if (sanitized.length < 4 || sanitized.length > 16) {
      return res.status(400).json({ error: 'Code must be 4-16 alphanumeric characters' });
    }

    const existing = await getReferralCodeByCode(sanitized);
    if (existing && existing.userId !== req.user!.id) {
      return res.status(409).json({ error: 'This code is already taken' });
    }

    let codeRecord = await getReferralCodeByUserId(req.user!.id);
    if (!codeRecord) {
      codeRecord = await createReferralCode({ userId: req.user!.id, code: sanitized });
    } else {
      codeRecord = await updateReferralCode(codeRecord.id, { code: sanitized });
    }

    return res.json({ referralCode: codeRecord });
  } catch (error) {
    console.error('Update referral code error:', error);
    return res.status(500).json({ error: 'Failed to update referral code' });
  }
};

// GET /referrals/dashboard
export const getReferralDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const [codeRecord, referrals, commissions, pendingBalance, approvedBalance, paidBalance, payouts] = await Promise.all([
      getReferralCodeByUserId(userId),
      listReferralsByReferrerId(userId),
      listCommissionsByReferrerId(userId),
      sumPendingCommissions(userId),
      sumApprovedCommissions(userId),
      sumPaidCommissions(userId),
      listPayoutsForUser(userId),
    ]);

    const totalReferrals = referrals.length;
    const qualifiedReferrals = referrals.filter((r) => r.status === 'qualified' || r.status === 'paid').length;
    const conversionRate = totalReferrals > 0 ? Math.round((qualifiedReferrals / totalReferrals) * 100) : 0;

    // Enrich commissions with referred user info
    const enrichedCommissions = await Promise.all(
      commissions.map(async (c) => {
        const user = await getUserById(c.referredUserId);
        return {
          ...c,
          referredUser: user ? { email: user.email, name: user.name } : null,
        };
      })
    );

    const discountSetting = await getSystemSetting('referral_discount_percent');
    const discountPercent = discountSetting ? Number(discountSetting.value) : 20;

    return res.json({
      referralCode: codeRecord,
      stats: {
        totalEarnings: (approvedBalance + paidBalance),
        pendingBalance,
        approvedBalance,
        paidBalance,
        totalReferrals,
        qualifiedReferrals,
        conversionRate,
      },
      commissions: enrichedCommissions,
      payouts,
      discountPercent,
    });
  } catch (error) {
    console.error('Get referral dashboard error:', error);
    return res.status(500).json({ error: 'Failed to load referral dashboard' });
  }
};

// GET /referrals/my-discount
export const getMyReferralDiscount = async (req: AuthRequest, res: Response) => {
  try {
    const discountPercent = await getReferralDiscountForUser(req.user!.id);
    return res.json({ discountPercent });
  } catch (error) {
    console.error('Get referral discount error:', error);
    return res.status(500).json({ error: 'Failed to load referral discount' });
  }
};

// POST /referrals/request-payout
export const requestPayout = async (req: AuthRequest, res: Response) => {
  try {
    const { paypalEmail } = req.body;
    if (!paypalEmail || typeof paypalEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail)) {
      return res.status(400).json({ error: 'Valid PayPal email is required' });
    }

    const minPayoutSetting = await getSystemSetting('referral_min_payout');
    const minPayout = minPayoutSetting ? Number(minPayoutSetting.value) : 10;

    const approvedBalance = await sumApprovedCommissions(req.user!.id);
    if (approvedBalance < minPayout) {
      return res.status(400).json({ error: `Minimum payout amount is $${minPayout}. Your approved balance is $${approvedBalance.toFixed(2)}.` });
    }

    const payout = await createPayout({
      userId: req.user!.id,
      paypalEmail: paypalEmail.trim(),
      amount: approvedBalance,
    });

    // Send notification email
    const user = await getUserById(req.user!.id);
    if (user?.email) {
      sendPayoutRequestedEmail(user.email, user.name, approvedBalance).catch(() => {});
    }

    return res.json({ payout });
  } catch (error) {
    console.error('Request payout error:', error);
    return res.status(500).json({ error: 'Failed to request payout' });
  }
};

// POST /referrals/validate-code
export const validateReferralCode = async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ valid: false, message: 'Code is required' });
    }

    const enabledSetting = await getSystemSetting('referral_system_enabled');
    if (enabledSetting && enabledSetting.value === 'false') {
      return res.json({ valid: false, message: 'Referral system is currently disabled' });
    }

    const codeRecord = await getReferralCodeByCode(code);
    if (!codeRecord || !codeRecord.isActive) {
      return res.json({ valid: false, message: 'Invalid referral code' });
    }

    // Prevent self-referral
    if (codeRecord.userId === req.user!.id) {
      return res.json({ valid: false, message: 'You cannot use your own referral code' });
    }

    const discountSetting = await getSystemSetting('referral_discount_percent');
    const discountPercent = discountSetting ? Number(discountSetting.value) : 20;

    return res.json({
      valid: true,
      discountPercent,
      message: `You'll get ${discountPercent}% off your subscription!`,
    });
  } catch (error) {
    console.error('Validate referral code error:', error);
    return res.status(500).json({ error: 'Failed to validate referral code' });
  }
};

// POST /referrals/apply-code — called after signup to link referral
export const applyReferralCode = async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Code is required' });
    }

    // Check if already referred
    const existing = await getReferralByReferredUserId(req.user!.id);
    if (existing) {
      return res.json({ applied: false, message: 'You already have a referral linked to your account' });
    }

    await processReferralSignup(req.user!.id, req.user!.email, code);

    // Verify it was applied
    const referral = await getReferralByReferredUserId(req.user!.id);
    if (!referral) {
      return res.json({ applied: false, message: 'Could not apply referral code' });
    }

    const discountSetting = await getSystemSetting('referral_discount_percent');
    const discountPercent = discountSetting ? Number(discountSetting.value) : 20;

    return res.json({
      applied: true,
      discountPercent,
      message: `Referral applied! You'll get ${discountPercent}% off your first subscription.`,
    });
  } catch (error) {
    console.error('Apply referral code error:', error);
    return res.status(500).json({ error: 'Failed to apply referral code' });
  }
};
