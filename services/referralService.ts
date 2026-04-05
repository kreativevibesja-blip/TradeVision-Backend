import {
  getReferralByReferredUserId,
  getReferralCodeByCode,
  updateReferral,
  createReferral,
  createCommission,
  getCommissionByReferralId,
  updateReferralCode,
  getUserById,
  getUserByEmail,
  updateUser,
  getSystemSetting,
} from '../lib/supabase';
import { sendReferralCommissionEmail } from './emailService';

/**
 * Called when a NEW user signs up using a referral code.
 * Links the referral code to the new user and creates a pending referral record.
 */
export async function processReferralSignup(
  newUserId: string,
  newUserEmail: string,
  referralCode: string
): Promise<void> {
  try {
    const enabledSetting = await getSystemSetting('referral_system_enabled');
    if (enabledSetting && enabledSetting.value === 'false') return;

    const codeRecord = await getReferralCodeByCode(referralCode);
    if (!codeRecord || !codeRecord.isActive) return;

    // Prevent self-referral
    if (codeRecord.userId === newUserId) return;

    const referrer = await getUserById(codeRecord.userId);
    if (!referrer) return;

    // Block same-email referrals (case-insensitive)
    if (referrer.email.toLowerCase() === newUserEmail.toLowerCase()) return;

    // Check if already referred
    const existing = await getReferralByReferredUserId(newUserId);
    if (existing) return;

    // Create referral
    await createReferral({
      referrerId: codeRecord.userId,
      referredUserId: newUserId,
      referralCode: codeRecord.code,
    });

    // Update referred user record
    await updateUser(newUserId, {
      referredBy: codeRecord.userId,
      referralCodeUsed: codeRecord.code,
    } as any);

    // Increment total referrals
    await updateReferralCode(codeRecord.id, {
      totalReferrals: codeRecord.totalReferrals + 1,
    });
  } catch (error) {
    console.error('[referral] processReferralSignup failed:', error);
  }
}

/**
 * Called when a referred user completes a PAID subscription.
 * Marks the referral as qualified and creates a commission.
 */
export async function processReferralPayment(
  paidUserId: string,
  paymentAmount: number
): Promise<{ discountApplied: boolean; discountPercent: number }> {
  const result = { discountApplied: false, discountPercent: 0 };
  try {
    const enabledSetting = await getSystemSetting('referral_system_enabled');
    if (enabledSetting && enabledSetting.value === 'false') return result;

    const referral = await getReferralByReferredUserId(paidUserId);
    if (!referral || referral.status !== 'pending') return result;

    const commissionSetting = await getSystemSetting('referral_commission_percent');
    const commissionPercent = commissionSetting ? Number(commissionSetting.value) : 25;

    const discountSetting = await getSystemSetting('referral_discount_percent');
    const discountPercent = discountSetting ? Number(discountSetting.value) : 20;

    // Safety: total can't exceed 40%
    const effectiveCommission = Math.min(commissionPercent, 40 - discountPercent);
    if (effectiveCommission <= 0) return result;

    // Commission is a percentage of the amount actually paid
    const commissionAmount = Math.round(paymentAmount * (effectiveCommission / 100) * 100) / 100;

    // Qualify the referral
    await updateReferral(referral.id, {
      status: 'qualified',
      qualifiedAt: new Date().toISOString(),
    });

    // Create commission (starts as pending, admin must approve or auto-approve after delay)
    await createCommission({
      referrerId: referral.referrerId,
      referredUserId: paidUserId,
      referralId: referral.id,
      amount: commissionAmount,
    });

    // Update referral code earnings
    const codeRecord = await getReferralCodeByCode(referral.referralCode);
    if (codeRecord) {
      await updateReferralCode(codeRecord.id, {
        totalEarnings: Number(codeRecord.totalEarnings) + commissionAmount,
      });
    }

    // Send email notification to referrer
    const referrer = await getUserById(referral.referrerId);
    if (referrer?.email) {
      sendReferralCommissionEmail(
        referrer.email,
        referrer.name,
        commissionAmount
      ).catch((err) => console.error('[referral] failed to send commission email:', err));
    }

    result.discountApplied = true;
    result.discountPercent = discountPercent;
    return result;
  } catch (error) {
    console.error('[referral] processReferralPayment failed:', error);
    return result;
  }
}

/**
 * Get referral discount percent for a user (if they were referred and haven't paid yet).
 */
export async function getReferralDiscountForUser(userId: string): Promise<number> {
  try {
    const enabledSetting = await getSystemSetting('referral_system_enabled');
    if (enabledSetting && enabledSetting.value === 'false') return 0;

    const referral = await getReferralByReferredUserId(userId);
    if (!referral || referral.status !== 'pending') return 0;

    const discountSetting = await getSystemSetting('referral_discount_percent');
    return discountSetting ? Number(discountSetting.value) : 20;
  } catch {
    return 0;
  }
}
