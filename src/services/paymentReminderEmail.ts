// ── Payment Reminder Email (checkout nudge with optional coupon) ──

import { Resend } from 'resend';
import { config } from '../config';

const PLAN_LABELS: Record<string, string> = {
  PRO: 'TradeVision AI Pro',
  TOP_TIER: 'PRO+',
  FREE: 'Free',
};

const PLAN_PRICES: Record<string, number> = {
  PRO: 19.95,
  TOP_TIER: 39.95,
  FREE: 0,
};

interface ReminderEmailOpts {
  to: string;
  userName: string;
  plan: string;
  amount: number;
  couponCode?: string;
  discountLabel?: string;
  isBankTransfer?: boolean;
}

function buildCheckoutUrl(plan: string, couponCode?: string): string {
  const base = config.frontend.url;
  const params = new URLSearchParams({ plan });
  if (couponCode) params.set('coupon', couponCode);
  return `${base}/checkout?${params.toString()}`;
}

function buildReminderHtml(opts: ReminderEmailOpts): string {
  const planLabel = PLAN_LABELS[opts.plan] || opts.plan;
  const planPrice = PLAN_PRICES[opts.plan] ?? opts.amount;
  const checkoutUrl = buildCheckoutUrl(opts.plan, opts.couponCode);

  const couponSection = opts.couponCode
    ? `
      <tr>
        <td style="padding: 0 32px 24px;">
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid #e2b340; border-radius: 12px; padding: 20px 24px; text-align: center;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #e2b340; margin-bottom: 8px;">🎁 Exclusive Offer</div>
            <div style="font-size: 28px; font-weight: 800; color: #ffffff; margin-bottom: 4px;">${opts.discountLabel || opts.couponCode}</div>
            <div style="font-size: 13px; color: #94a3b8; margin-bottom: 12px;">Use code at checkout — applied automatically when you click below</div>
            <div style="display: inline-block; background: rgba(226, 179, 64, 0.15); border: 1px dashed #e2b340; border-radius: 8px; padding: 8px 20px;">
              <span style="font-family: monospace; font-size: 18px; font-weight: 700; color: #e2b340; letter-spacing: 2px;">${opts.couponCode}</span>
            </div>
          </div>
        </td>
      </tr>`
    : '';

  const bankTransferNote = opts.isBankTransfer
    ? `
      <tr>
        <td style="padding: 0 32px 16px;">
          <div style="background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.2); border-radius: 8px; padding: 14px 18px; font-size: 13px; color: #fbbf24; line-height: 1.5;">
            💡 Your bank transfer is still pending verification. If you'd prefer an instant upgrade, you can complete your payment online instead.
          </div>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Complete Your Upgrade</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background: linear-gradient(180deg, #111118 0%, #0d0d14 100%); border-radius: 16px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden;">

          <!-- Header gradient bar -->
          <tr>
            <td style="height: 4px; background: linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7);"></td>
          </tr>

          <!-- Logo / Brand -->
          <tr>
            <td style="padding: 32px 32px 8px; text-align: center;">
              <div style="font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
                ⚡ TradeVision<span style="color: #8b5cf6;">AI</span>
              </div>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 16px 32px 8px; text-align: center; font-size: 14px; color: #94a3b8;">
              Hey ${opts.userName} 👋
            </td>
          </tr>

          <!-- Main headline -->
          <tr>
            <td style="padding: 8px 32px 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; line-height: 1.3;">
                You're one step away from<br/>
                <span style="background: linear-gradient(135deg, #8b5cf6, #6366f1); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">unlocking ${planLabel}</span>
              </h1>
            </td>
          </tr>

          <!-- Subtext -->
          <tr>
            <td style="padding: 0 32px 24px; text-align: center; font-size: 14px; color: #64748b; line-height: 1.6;">
              We noticed you started upgrading but didn't finish the checkout.
              Your ${planLabel} plan is still waiting for you — pick up right where you left off.
            </td>
          </tr>

          ${bankTransferNote}

          <!-- Plan card -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 16px; font-weight: 600; color: #ffffff;">${planLabel}</td>
                    <td style="text-align: right; font-size: 20px; font-weight: 700; color: #ffffff;">
                      $${planPrice.toFixed(2)}<span style="font-size: 13px; font-weight: 400; color: #64748b;">/mo</span>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          ${couponSection}

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              <a href="${checkoutUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 40px; border-radius: 10px; letter-spacing: 0.3px;">
                ${opts.couponCode ? 'Claim Discount & Upgrade' : 'Complete Your Upgrade'} →
              </a>
            </td>
          </tr>

          <!-- Urgency / social proof -->
          <tr>
            <td style="padding: 0 32px 28px; text-align: center; font-size: 12px; color: #475569; line-height: 1.5;">
              Hundreds of traders are already using TradeVision AI to find<br/>
              high-probability setups faster. Don't miss out.
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;"><div style="border-top: 1px solid rgba(255,255,255,0.06);"></div></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px 28px; text-align: center; font-size: 11px; color: #334155; line-height: 1.6;">
              You're receiving this because you started an upgrade on TradeVision AI.<br/>
              If you didn't request this, you can safely ignore this email.<br/><br/>
              <a href="${config.frontend.url}" style="color: #6366f1; text-decoration: none;">mytradevision.online</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendPaymentReminderEmail(opts: ReminderEmailOpts): Promise<{ ok: boolean; error?: string }> {
  if (!config.email.resendApiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }

  const resend = new Resend(config.email.resendApiKey);
  const subject = opts.couponCode
    ? `🎁 A special discount is waiting — complete your ${PLAN_LABELS[opts.plan] || opts.plan} upgrade`
    : `⚡ Your ${PLAN_LABELS[opts.plan] || opts.plan} upgrade is almost done`;

  try {
    const result = await resend.emails.send({
      from: config.email.from,
      replyTo: config.email.replyTo,
      to: opts.to,
      subject,
      html: buildReminderHtml(opts),
    });

    if (result.error) {
      return { ok: false, error: result.error.message || 'Resend error' };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}
