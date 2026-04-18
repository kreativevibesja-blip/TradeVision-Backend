// ── Subscription Renewal Reminder Email ──

import { Resend } from 'resend';
import { config } from '../config';

const PLAN_LABELS: Record<string, string> = {
  PRO: 'PRO',
  TOP_TIER: 'PRO+',
  VIP_AUTO_TRADER: 'VIP Auto Trader',
  FREE: 'Free',
};

const PLAN_PRICES: Record<string, number> = {
  PRO: 19.95,
  TOP_TIER: 39.95,
  VIP_AUTO_TRADER: 69.95,
  FREE: 0,
};

interface RenewalReminderOpts {
  to: string;
  userName: string;
  plan: string;
  daysLeft: number;
  expiresAt: string;
}

function buildCheckoutUrl(plan: string): string {
  return `${config.frontend.url}/checkout?plan=${encodeURIComponent(plan)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function buildRenewalHtml(opts: RenewalReminderOpts): string {
  const planLabel = PLAN_LABELS[opts.plan] || opts.plan;
  const planPrice = PLAN_PRICES[opts.plan] ?? 0;
  const checkoutUrl = buildCheckoutUrl(opts.plan);
  const expiryDate = formatDate(opts.expiresAt);
  const isExpired = opts.daysLeft <= 0;
  const isUrgent = opts.daysLeft <= 3 && opts.daysLeft > 0;

  const urgencyColor = isExpired ? '#ef4444' : isUrgent ? '#f59e0b' : '#8b5cf6';
  const urgencyBg = isExpired ? 'rgba(239,68,68,0.1)' : isUrgent ? 'rgba(245,158,11,0.1)' : 'rgba(139,92,246,0.1)';
  const urgencyBorder = isExpired ? 'rgba(239,68,68,0.3)' : isUrgent ? 'rgba(245,158,11,0.3)' : 'rgba(139,92,246,0.3)';

  const timeMessage = isExpired
    ? 'Your subscription has expired'
    : opts.daysLeft === 1
      ? 'Your subscription expires <strong>tomorrow</strong>'
      : `Your subscription expires in <strong>${opts.daysLeft} days</strong>`;

  const headlineText = isExpired
    ? `Your ${planLabel} plan has expired`
    : `Your ${planLabel} plan is ending soon`;

  const ctaText = isExpired ? 'Resubscribe Now' : 'Renew My Plan';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Subscription Renewal Reminder</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background: linear-gradient(180deg, #111118 0%, #0d0d14 100%); border-radius: 16px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden;">

          <!-- Header gradient bar -->
          <tr>
            <td style="height: 4px; background: linear-gradient(90deg, ${urgencyColor}, #8b5cf6, #6366f1);"></td>
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
                ${headlineText}
              </h1>
            </td>
          </tr>

          <!-- Urgency card -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <div style="background: ${urgencyBg}; border: 1px solid ${urgencyBorder}; border-radius: 12px; padding: 20px 24px; text-align: center;">
                <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: ${urgencyColor}; margin-bottom: 8px;">
                  ${isExpired ? '⚠️ Expired' : isUrgent ? '⏰ Urgent' : '📅 Reminder'}
                </div>
                <div style="font-size: 16px; font-weight: 600; color: #ffffff; margin-bottom: 6px;">
                  ${timeMessage}
                </div>
                <div style="font-size: 13px; color: #94a3b8;">
                  ${isExpired ? 'Expired on' : 'Expires on'} ${expiryDate}
                </div>
              </div>
            </td>
          </tr>

          <!-- Plan card -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px 24px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <div style="font-size: 16px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">${planLabel} Plan</div>
                      <div style="font-size: 12px; color: #64748b;">Your current plan</div>
                    </td>
                    <td style="text-align: right;">
                      <div style="font-size: 24px; font-weight: 700; color: #ffffff;">
                        $${planPrice.toFixed(2)}<span style="font-size: 13px; font-weight: 400; color: #64748b;">/mo</span>
                      </div>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- What you'll lose -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <div style="font-size: 14px; font-weight: 600; color: #ffffff; margin-bottom: 12px;">
                ${isExpired ? "What you're missing:" : "Don't lose access to:"}
              </div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #e2e8f0;">
                    <span style="color: #8b5cf6; margin-right: 8px;">✦</span> Unlimited chart analyses
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #e2e8f0;">
                    <span style="color: #8b5cf6; margin-right: 8px;">✦</span> Pro AI model with higher accuracy
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #e2e8f0;">
                    <span style="color: #8b5cf6; margin-right: 8px;">✦</span> Live TradingView chart analysis
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #e2e8f0;">
                    <span style="color: #8b5cf6; margin-right: 8px;">✦</span> Priority processing — no queue
                  </td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 13px; color: #e2e8f0;">
                    <span style="color: #8b5cf6; margin-right: 8px;">✦</span> Trade Radar & Command Center
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 32px 32px; text-align: center;">
              <a href="${checkoutUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 44px; border-radius: 12px; letter-spacing: 0.3px; box-shadow: 0 4px 24px rgba(99,102,241,0.35);">
                ${ctaText} →
              </a>
            </td>
          </tr>

          <!-- Reassurance -->
          <tr>
            <td style="padding: 0 32px 28px; text-align: center; font-size: 12px; color: #475569; line-height: 1.5;">
              Renewing takes less than 60 seconds. Your account data<br/>
              and analysis history are safe and waiting for you.
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;"><div style="border-top: 1px solid rgba(255,255,255,0.06);"></div></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px 28px; text-align: center; font-size: 11px; color: #334155; line-height: 1.6;">
              You're receiving this because you have a ${planLabel} subscription on TradeVision AI.<br/>
              If you have questions, reply to this email or contact us.<br/><br/>
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

export async function sendRenewalReminderEmail(opts: RenewalReminderOpts): Promise<{ ok: boolean; error?: string }> {
  if (!config.email.resendApiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured' };
  }

  const resend = new Resend(config.email.resendApiKey);
  const planLabel = PLAN_LABELS[opts.plan] || opts.plan;
  const isExpired = opts.daysLeft <= 0;

  const subject = isExpired
    ? `⚠️ Your ${planLabel} plan has expired — renew now to keep your access`
    : opts.daysLeft <= 3
      ? `⏰ ${opts.daysLeft} day${opts.daysLeft !== 1 ? 's' : ''} left on your ${planLabel} plan — renew now`
      : `📅 Your ${planLabel} plan expires in ${opts.daysLeft} days — time to renew`;

  try {
    const result = await resend.emails.send({
      from: config.email.from,
      replyTo: config.email.replyTo,
      to: opts.to,
      subject,
      html: buildRenewalHtml(opts),
    });

    if (result.error) {
      return { ok: false, error: result.error.message || 'Resend error' };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}
