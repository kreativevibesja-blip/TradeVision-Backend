import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listAllReferralsPage,
  listAllCommissionsPage,
  listAllPayoutsPage,
  countReferralsByStatus,
  getTotalCommissionsOwed,
  getTotalCommissionsPaid,
  getCompletedRevenue,
  updateCommission,
  updatePayout,
  updateReferral,
  getReferralByReferredUserId,
  getUserById,
  getSystemSetting,
  upsertSystemSetting,
  sumApprovedCommissions,
  listCommissionsByReferrerId,
  type CommissionStatus,
  type PayoutStatus,
} from '../lib/supabase';
import { sendPayoutCompletedEmail } from '../services/emailService';

// GET /admin/referrals/dashboard
export const getAdminReferralDashboard = async (_req: AuthRequest, res: Response) => {
  try {
    const [totalReferrals, pendingReferrals, qualifiedReferrals, commissionsOwed, commissionsPaid] = await Promise.all([
      countReferralsByStatus(),
      countReferralsByStatus('pending'),
      countReferralsByStatus('qualified'),
      getTotalCommissionsOwed(),
      getTotalCommissionsPaid(),
    ]);

    const discountSetting = await getSystemSetting('referral_discount_percent');
    const commissionSetting = await getSystemSetting('referral_commission_percent');
    const minPayoutSetting = await getSystemSetting('referral_min_payout');
    const enabledSetting = await getSystemSetting('referral_system_enabled');
    const delayDaysSetting = await getSystemSetting('referral_commission_delay_days');

    return res.json({
      stats: {
        totalReferrals,
        pendingReferrals,
        qualifiedReferrals,
        commissionsOwed,
        commissionsPaid,
      },
      settings: {
        discountPercent: discountSetting ? Number(discountSetting.value) : 20,
        commissionPercent: commissionSetting ? Number(commissionSetting.value) : 25,
        minPayout: minPayoutSetting ? Number(minPayoutSetting.value) : 10,
        enabled: enabledSetting ? enabledSetting.value === 'true' : true,
        commissionDelayDays: delayDaysSetting ? Number(delayDaysSetting.value) : 7,
      },
    });
  } catch (error) {
    console.error('Admin referral dashboard error:', error);
    return res.status(500).json({ error: 'Failed to load referral dashboard' });
  }
};

// GET /admin/referrals/list
export const getAdminReferrals = async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const { referrals, total } = await listAllReferralsPage(page, limit);

    // Enrich with user info
    const enriched = await Promise.all(
      referrals.map(async (r) => {
        const [referrer, referred] = await Promise.all([
          getUserById(r.referrerId),
          getUserById(r.referredUserId),
        ]);
        return {
          ...r,
          referrer: referrer ? { email: referrer.email, name: referrer.name, subscription: referrer.subscription } : null,
          referredUser: referred ? { email: referred.email, name: referred.name, subscription: referred.subscription } : null,
        };
      })
    );

    return res.json({ referrals: enriched, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin get referrals error:', error);
    return res.status(500).json({ error: 'Failed to list referrals' });
  }
};

// GET /admin/referrals/commissions
export const getAdminCommissions = async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const status = req.query.status as CommissionStatus | undefined;
    const limit = 20;
    const { commissions, total } = await listAllCommissionsPage(page, limit, status);

    const enriched = await Promise.all(
      commissions.map(async (c) => {
        const [referrer, referred] = await Promise.all([
          getUserById(c.referrerId),
          getUserById(c.referredUserId),
        ]);
        return {
          ...c,
          referrer: referrer ? { email: referrer.email, name: referrer.name } : null,
          referredUser: referred ? { email: referred.email, name: referred.name } : null,
        };
      })
    );

    return res.json({ commissions: enriched, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin get commissions error:', error);
    return res.status(500).json({ error: 'Failed to list commissions' });
  }
};

// PATCH /admin/referrals/commissions/:id
export const updateAdminCommission = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: CommissionStatus };

    if (!['pending', 'approved', 'paid', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updates: any = { status };
    if (status === 'paid') {
      updates.paidAt = new Date().toISOString();
    }

    const commission = await updateCommission(id, updates);

    // If marking the referral as paid, also update the referral status
    if (status === 'paid') {
      await updateReferral(commission.referralId, { status: 'paid' }).catch(() => {});
    }

    return res.json({ commission });
  } catch (error) {
    console.error('Admin update commission error:', error);
    return res.status(500).json({ error: 'Failed to update commission' });
  }
};

// GET /admin/referrals/payouts
export const getAdminPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const status = req.query.status as PayoutStatus | undefined;
    const limit = 20;
    const { payouts, total } = await listAllPayoutsPage(page, limit, status);

    const enriched = await Promise.all(
      payouts.map(async (p) => {
        const user = await getUserById(p.userId);
        return {
          ...p,
          user: user ? { email: user.email, name: user.name } : null,
        };
      })
    );

    return res.json({ payouts: enriched, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin get payouts error:', error);
    return res.status(500).json({ error: 'Failed to list payouts' });
  }
};

// PATCH /admin/referrals/payouts/:id
export const updateAdminPayout = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: PayoutStatus };

    if (!['pending', 'processing', 'paid', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updates: any = { status };
    if (status === 'paid' || status === 'rejected') {
      updates.processedAt = new Date().toISOString();
    }

    const payout = await updatePayout(id, updates);

    // If payout is marked as paid, mark all approved commissions for this user as paid
    if (status === 'paid') {
      const commissions = await listCommissionsByReferrerId(payout.userId);
      for (const c of commissions) {
        if (c.status === 'approved') {
          await updateCommission(c.id, { status: 'paid', paidAt: new Date().toISOString() }).catch(() => {});
        }
      }

      // Send email notification
      const user = await getUserById(payout.userId);
      if (user?.email) {
        sendPayoutCompletedEmail(user.email, user.name, payout.amount).catch(() => {});
      }
    }

    return res.json({ payout });
  } catch (error) {
    console.error('Admin update payout error:', error);
    return res.status(500).json({ error: 'Failed to update payout' });
  }
};

// POST /admin/referrals/settings
export const updateReferralSettings = async (req: AuthRequest, res: Response) => {
  try {
    const { discountPercent, commissionPercent, minPayout, enabled, commissionDelayDays } = req.body;

    // Validate: total discount + commission must not exceed 40%
    const dp = discountPercent !== undefined ? Number(discountPercent) : undefined;
    const cp = commissionPercent !== undefined ? Number(commissionPercent) : undefined;

    if (dp !== undefined && cp !== undefined && dp + cp > 40) {
      return res.status(400).json({ error: 'Discount + commission cannot exceed 40% to protect profits' });
    }

    const updates: Array<{ key: string; value: string }> = [];
    if (dp !== undefined) updates.push({ key: 'referral_discount_percent', value: String(dp) });
    if (cp !== undefined) updates.push({ key: 'referral_commission_percent', value: String(cp) });
    if (minPayout !== undefined) updates.push({ key: 'referral_min_payout', value: String(minPayout) });
    if (enabled !== undefined) updates.push({ key: 'referral_system_enabled', value: String(enabled) });
    if (commissionDelayDays !== undefined) updates.push({ key: 'referral_commission_delay_days', value: String(commissionDelayDays) });

    for (const u of updates) {
      await upsertSystemSetting(u.key, u.value);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Admin update referral settings error:', error);
    return res.status(500).json({ error: 'Failed to update referral settings' });
  }
};
