import { Resend } from 'resend';
import { config } from '../config';

interface TicketReplyEmail {
  to: string;
  name: string | null;
  ticketNumber: string;
  subject: string;
  message: string;
}

const normalizeMailbox = (value: string) =>
  value
    .trim()
    .replace(/^['"\u201c\u201d\u2018\u2019]+|['"\u201c\u201d\u2018\u2019]+$/g, '')
    .replace(/\s+/g, ' ');

const isValidMailbox = (value: string) =>
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) || /^.+\s<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(value);

class EmailDeliveryError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

export async function sendTicketReplyEmail({ to, name, ticketNumber, subject, message }: TicketReplyEmail): Promise<{ success: boolean }> {
  if (!config.email.resendApiKey) {
    console.warn('Resend is not configured — skipping send.');
    throw new EmailDeliveryError('Email is not configured on the server.', 'EMAIL_NOT_CONFIGURED');
  }

  const resend = new Resend(config.email.resendApiKey);
  const from = normalizeMailbox(config.email.from);
  const replyTo = normalizeMailbox(config.email.replyTo);

  if (!isValidMailbox(from)) {
    throw new EmailDeliveryError('EMAIL_FROM is invalid. Use help@mytradevision.online or MyTradeVision Support <help@mytradevision.online>.', 'INVALID_EMAIL_FROM');
  }

  if (!isValidMailbox(replyTo)) {
    throw new EmailDeliveryError('EMAIL_REPLY_TO is invalid. Use help@mytradevision.online.', 'INVALID_EMAIL_REPLY_TO');
  }

  const escapedMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  try {
    const response = await resend.emails.send({
      from,
      replyTo,
      to,
      subject: `Re: ${ticketNumber} — ${subject}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">MyTradeVision</h1>
            <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8;">Support Team</p>
          </div>

          <div style="padding: 32px 24px;">
            <p style="margin: 0 0 20px; font-size: 15px; color: #334155; line-height: 1.6;">
              Hi ${name || 'Trader'},
            </p>

            <div style="margin: 0 0 24px; padding: 20px; background-color: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0;">
              <p style="margin: 0 0 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;">
                Ticket ${ticketNumber}
              </p>
              <p style="margin: 0; font-size: 14px; color: #1e293b; line-height: 1.7;">
                ${escapedMessage}
              </p>
            </div>

            <p style="margin: 0 0 8px; font-size: 14px; color: #475569; line-height: 1.6;">
              If you need further assistance, simply reply to this email or open a new ticket from your dashboard.
            </p>
          </div>

          <div style="padding: 20px 24px; border-top: 1px solid #e2e8f0; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8;">
              &copy; ${new Date().getFullYear()} MyTradeVision &middot; All rights reserved
            </p>
            <p style="margin: 6px 0 0; font-size: 11px; color: #cbd5e1;">
              This is an automated message from MyTradeVision Support.
            </p>
          </div>
        </div>
      `,
    });

    if (response.error) {
      throw new EmailDeliveryError(response.error.message || 'Resend failed to send the email.', 'RESEND_ERROR');
    }
  } catch (error: any) {
    const code = typeof error?.code === 'string' ? error.code : undefined;

    if (error instanceof EmailDeliveryError) {
      throw error;
    }

    throw new EmailDeliveryError(error?.message || 'Failed to send email through Resend.', code);
  }

  return { success: true };
}

// ── Referral System Emails ──

export async function sendReferralCommissionEmail(
  to: string,
  name: string | null,
  amount: number
): Promise<{ success: boolean }> {
  if (!config.email.resendApiKey) {
    console.warn('Resend is not configured — skipping referral commission email.');
    return { success: false };
  }

  const resend = new Resend(config.email.resendApiKey);
  const from = normalizeMailbox(config.email.from);
  const replyTo = normalizeMailbox(config.email.replyTo);

  if (!isValidMailbox(from)) return { success: false };

  await resend.emails.send({
    from,
    replyTo,
    to,
    subject: `You earned $${amount.toFixed(2)} in referral commission!`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">MyTradeVision</h1>
          <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8;">Referral Program</p>
        </div>
        <div style="padding: 32px 24px;">
          <p style="margin: 0 0 20px; font-size: 15px; color: #334155;">Hi ${name || 'Trader'},</p>
          <div style="margin: 0 0 24px; padding: 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; text-align: center;">
            <p style="margin: 0 0 4px; font-size: 13px; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 0.05em;">Commission Earned</p>
            <p style="margin: 0; font-size: 32px; font-weight: 700; color: #ffffff;">$${amount.toFixed(2)}</p>
          </div>
          <p style="margin: 0 0 8px; font-size: 14px; color: #475569;">One of your referrals just subscribed! Your commission will be available for payout once approved.</p>
          <p style="margin: 0; font-size: 14px; color: #475569;">Visit your <strong>Referrals Dashboard</strong> to track earnings and request payouts.</p>
        </div>
        <div style="padding: 20px 24px; border-top: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #94a3b8;">&copy; ${new Date().getFullYear()} MyTradeVision &middot; All rights reserved</p>
        </div>
      </div>
    `,
  });

  return { success: true };
}

export async function sendPayoutRequestedEmail(
  to: string,
  name: string | null,
  amount: number
): Promise<{ success: boolean }> {
  if (!config.email.resendApiKey) return { success: false };

  const resend = new Resend(config.email.resendApiKey);
  const from = normalizeMailbox(config.email.from);
  const replyTo = normalizeMailbox(config.email.replyTo);
  if (!isValidMailbox(from)) return { success: false };

  await resend.emails.send({
    from,
    replyTo,
    to,
    subject: `Payout request of $${amount.toFixed(2)} received`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">MyTradeVision</h1>
          <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8;">Referral Program</p>
        </div>
        <div style="padding: 32px 24px;">
          <p style="margin: 0 0 20px; font-size: 15px; color: #334155;">Hi ${name || 'Trader'},</p>
          <p style="margin: 0 0 8px; font-size: 14px; color: #475569;">Your payout request for <strong>$${amount.toFixed(2)}</strong> has been received and is being reviewed.</p>
          <p style="margin: 0; font-size: 14px; color: #475569;">We'll notify you once the payout is processed.</p>
        </div>
        <div style="padding: 20px 24px; border-top: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #94a3b8;">&copy; ${new Date().getFullYear()} MyTradeVision &middot; All rights reserved</p>
        </div>
      </div>
    `,
  });

  return { success: true };
}

export async function sendPayoutCompletedEmail(
  to: string,
  name: string | null,
  amount: number
): Promise<{ success: boolean }> {
  if (!config.email.resendApiKey) return { success: false };

  const resend = new Resend(config.email.resendApiKey);
  const from = normalizeMailbox(config.email.from);
  const replyTo = normalizeMailbox(config.email.replyTo);
  if (!isValidMailbox(from)) return { success: false };

  await resend.emails.send({
    from,
    replyTo,
    to,
    subject: `Your $${amount.toFixed(2)} payout has been sent!`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">MyTradeVision</h1>
          <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8;">Referral Program</p>
        </div>
        <div style="padding: 32px 24px;">
          <p style="margin: 0 0 20px; font-size: 15px; color: #334155;">Hi ${name || 'Trader'},</p>
          <div style="margin: 0 0 24px; padding: 20px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius: 12px; text-align: center;">
            <p style="margin: 0 0 4px; font-size: 13px; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 0.05em;">Payout Sent</p>
            <p style="margin: 0; font-size: 32px; font-weight: 700; color: #ffffff;">$${amount.toFixed(2)}</p>
          </div>
          <p style="margin: 0; font-size: 14px; color: #475569;">Your payout has been sent to your PayPal account. It may take 1-3 business days to appear.</p>
        </div>
        <div style="padding: 20px 24px; border-top: 1px solid #e2e8f0; text-align: center;">
          <p style="margin: 0; font-size: 12px; color: #94a3b8;">&copy; ${new Date().getFullYear()} MyTradeVision &middot; All rights reserved</p>
        </div>
      </div>
    `,
  });

  return { success: true };
}

export { EmailDeliveryError };
