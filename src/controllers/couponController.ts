import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createCouponRecord,
  listCoupons,
  getCouponByCode,
  getCouponById,
  updateCouponRecord,
  deleteCouponRecord,
  getCouponUsage,
  incrementCouponUsage,
  type CouponRecord,
} from '../lib/supabase';

// ---- Admin endpoints ----

export const getCoupons = async (_req: AuthRequest, res: Response) => {
  try {
    const coupons = await listCoupons();
    return res.json({ coupons });
  } catch (error) {
    console.error('Get coupons error:', error);
    return res.status(500).json({ error: 'Failed to load coupons' });
  }
};

export const createCoupon = async (req: AuthRequest, res: Response) => {
  try {
    const { code, type, value, maxUses, perUserLimit, expiresAt } = req.body;

    if (!code || typeof code !== 'string' || code.trim().length < 2) {
      return res.status(400).json({ error: 'Coupon code must be at least 2 characters' });
    }

    if (!type || !['percentage', 'fixed'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "percentage" or "fixed"' });
    }

    const numValue = Number(value);
    if (!Number.isFinite(numValue) || numValue <= 0) {
      return res.status(400).json({ error: 'Value must be a positive number' });
    }

    if (type === 'percentage' && numValue > 100) {
      return res.status(400).json({ error: 'Percentage discount cannot exceed 100%' });
    }

    const existing = await getCouponByCode(code);
    if (existing) {
      return res.status(409).json({ error: 'A coupon with this code already exists' });
    }

    const coupon = await createCouponRecord({
      code,
      type,
      value: numValue,
      maxUses: Math.max(0, parseInt(maxUses, 10) || 0),
      perUserLimit: Math.max(1, parseInt(perUserLimit, 10) || 1),
      expiresAt: expiresAt || null,
    });

    return res.json({ coupon });
  } catch (error) {
    console.error('Create coupon error:', error);
    return res.status(500).json({ error: 'Failed to create coupon' });
  }
};

export const toggleCoupon = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const coupon = await getCouponById(id);
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    const updated = await updateCouponRecord(id, { active: !coupon.active });
    return res.json({ coupon: updated });
  } catch (error) {
    console.error('Toggle coupon error:', error);
    return res.status(500).json({ error: 'Failed to update coupon' });
  }
};

export const deleteCoupon = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await deleteCouponRecord(id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete coupon error:', error);
    return res.status(500).json({ error: 'Failed to delete coupon' });
  }
};

// ---- User-facing endpoints ----

const validateCouponInternal = async (code: string, userId: string): Promise<{
  valid: boolean;
  discount?: { type: CouponRecord['type']; value: number };
  couponId?: string;
  message: string;
}> => {
  const coupon = await getCouponByCode(code);

  if (!coupon) {
    return { valid: false, message: 'Coupon not found' };
  }

  if (!coupon.active) {
    return { valid: false, message: 'This coupon is no longer active' };
  }

  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return { valid: false, message: 'This coupon has expired' };
  }

  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, message: 'This coupon has reached its usage limit' };
  }

  const usage = await getCouponUsage(coupon.id, userId);
  if (usage && usage.usageCount >= coupon.perUserLimit) {
    return { valid: false, message: 'You have already used this coupon the maximum number of times' };
  }

  return {
    valid: true,
    discount: { type: coupon.type, value: coupon.value },
    couponId: coupon.id,
    message: 'Coupon applied successfully',
  };
};

export const validateCoupon = async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ valid: false, message: 'Coupon code is required' });
    }

    const result = await validateCouponInternal(code, req.user!.id);
    return res.json(result);
  } catch (error) {
    console.error('Validate coupon error:', error);
    return res.status(500).json({ valid: false, message: 'Failed to validate coupon' });
  }
};

export const applyDiscount = (price: number, coupon: { type: string; value: number }): number => {
  if (coupon.type === 'percentage') {
    return Math.max(0, price - (price * coupon.value / 100));
  }

  if (coupon.type === 'fixed') {
    return Math.max(0, price - coupon.value);
  }

  return price;
};

export { validateCouponInternal, incrementCouponUsage };
