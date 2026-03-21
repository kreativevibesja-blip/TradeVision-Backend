import nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { promises as dns } from 'dns';
import { config } from '../config';

const resolveTransportOptions = async (): Promise<SMTPTransport.Options> => {
  let transportHost = config.email.host;

  if (config.email.forceIPv4) {
    try {
      const resolved = await dns.lookup(config.email.host, { family: 4 });
      transportHost = resolved.address;
    } catch (error) {
      console.warn('[email] IPv4 lookup failed, falling back to hostname:', config.email.host, error);
    }
  }

  return {
    host: transportHost,
    port: config.email.port,
    secure: config.email.secure,
    name: 'mytradevision.online',
    connectionTimeout: config.email.connectionTimeout,
    greetingTimeout: config.email.greetingTimeout,
    socketTimeout: config.email.socketTimeout,
    requireTLS: !config.email.secure,
    tls: {
      servername: config.email.host,
      minVersion: 'TLSv1.2',
    },
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  };
};

interface TicketReplyEmail {
  to: string;
  name: string | null;
  ticketNumber: string;
  subject: string;
  message: string;
}

class EmailDeliveryError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

export async function sendTicketReplyEmail({ to, name, ticketNumber, subject, message }: TicketReplyEmail): Promise<{ success: boolean }> {
  if (!config.email.user || !config.email.pass) {
    console.warn('Email not configured — skipping send.');
    throw new EmailDeliveryError('Email is not configured on the server.', 'EMAIL_NOT_CONFIGURED');
  }

  const escapedMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  try {
    const transporter = nodemailer.createTransport(await resolveTransportOptions());

    await transporter.sendMail({
      from: config.email.from,
      replyTo: config.email.replyTo,
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
  } catch (error: any) {
    const code = typeof error?.code === 'string' ? error.code : undefined;

    if (code === 'ETIMEDOUT') {
      throw new EmailDeliveryError(
        'SMTP connection timed out. Your hosting provider is likely blocking outbound SMTP on ports 465/587, or Gmail is unreachable from the container.',
        code
      );
    }

    if (code === 'ESOCKET' && /ENETUNREACH/i.test(error?.message || '')) {
      throw new EmailDeliveryError(
        'SMTP tried to use an unreachable network route. The server cannot reach Gmail over IPv6, so the app now forces IPv4. Redeploy with EMAIL_FORCE_IPV4=true.',
        code
      );
    }

    if (code === 'EAUTH') {
      throw new EmailDeliveryError('SMTP authentication failed. Check EMAIL_USER, EMAIL_PASS, Gmail App Password, and Send As configuration.', code);
    }

    throw new EmailDeliveryError(error?.message || 'Failed to send email.', code);
  }

  return { success: true };
}

export { EmailDeliveryError };
