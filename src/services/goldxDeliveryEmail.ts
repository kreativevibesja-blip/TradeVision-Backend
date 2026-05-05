import { Resend } from 'resend';
import { config } from '../config';
import { adminGetSetting } from './goldx/licenseService';

interface GoldxDeliveryEmailInput {
  to: string;
  name: string | null;
  licenseKey?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
}

interface GoldxDeliveryLinkSetting {
  url?: string;
}

const GOLDX_DELIVERY_LINK_SETTING_KEY = 'delivery_download_link';

const normalizeMailbox = (value: string) =>
  value
    .trim()
    .replace(/^['"\u201c\u201d\u2018\u2019]+|['"\u201c\u201d\u2018\u2019]+$/g, '')
    .replace(/\s+/g, ' ');

export async function sendGoldxEaDeliveryEmail({ to, name, licenseKey, issuedAt, expiresAt }: GoldxDeliveryEmailInput) {
  if (!config.email.resendApiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }

  const resend = new Resend(config.email.resendApiKey);
  const from = normalizeMailbox(config.email.from);
  const replyTo = normalizeMailbox(config.email.replyTo);

  const deliverySetting = await adminGetSetting<GoldxDeliveryLinkSetting>(GOLDX_DELIVERY_LINK_SETTING_KEY);
  const downloadUrl = deliverySetting?.url?.trim() ?? '';
  if (!downloadUrl) {
    throw new Error('GoldX delivery download link is not configured in GoldX admin settings.');
  }

  try {
    new URL(downloadUrl);
  } catch {
    throw new Error('GoldX delivery download link is invalid.');
  }

  const traderName = name?.trim() || 'Trader';
  const licenseMarkup = licenseKey
    ? `
      <div style="margin: 24px 0; padding: 20px; border-radius: 18px; background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); color: #111827;">
        <p style="margin: 0 0 6px; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Your GoldX EA License Key</p>
        <p style="margin: 0; font-size: 28px; font-weight: 800; letter-spacing: 0.06em;">${licenseKey}</p>
        <p style="margin: 10px 0 0; font-size: 13px; line-height: 1.6; opacity: 0.85;">
          Issued ${issuedAt ? new Date(issuedAt).toUTCString() : 'today'}${expiresAt ? ` &middot; Expires ${new Date(expiresAt).toUTCString()}` : ''}
        </p>
      </div>
    `
    : `
      <div style="margin: 24px 0; padding: 18px 20px; border-radius: 18px; background: #111827; border: 1px solid rgba(255,255,255,0.08); color: #e5e7eb;">
        <p style="margin: 0; font-size: 14px; line-height: 1.7;">
          Your EA files are attached. If you also need your license key reissued, reply to this email and we will generate a fresh key for you.
        </p>
      </div>
    `;

  const html = `
    <div style="margin:0; padding:0; background:#06070b; font-family: Inter, Segoe UI, Helvetica, Arial, sans-serif; color:#f8fafc;">
      <div style="max-width:680px; margin:0 auto; padding:32px 16px;">
        <div style="overflow:hidden; border-radius:28px; background:linear-gradient(180deg, #0b1020 0%, #0f172a 100%); border:1px solid rgba(255,255,255,0.08); box-shadow:0 30px 80px rgba(0,0,0,0.45);">
          <div style="padding:40px 36px; background:radial-gradient(circle at top left, rgba(245,158,11,0.28), transparent 36%), radial-gradient(circle at top right, rgba(34,211,238,0.18), transparent 34%), #0f172a;">
            <p style="margin:0 0 10px; font-size:12px; letter-spacing:0.24em; text-transform:uppercase; color:#fbbf24;">GoldX EA Delivery</p>
            <h1 style="margin:0; font-size:34px; line-height:1.1; font-weight:800; color:#ffffff;">Your GoldX files are ready.</h1>
            <p style="margin:16px 0 0; font-size:15px; line-height:1.8; color:rgba(255,255,255,0.78);">
              Hi ${traderName}, thanks for subscribing to GoldX. Your private download link is ready below so you can access your EA files and agreement immediately.
            </p>
            ${licenseMarkup}
            <div style="margin-top:24px;">
              <a href="${downloadUrl}" style="display:inline-block; padding:16px 26px; border-radius:16px; background:linear-gradient(135deg, #f59e0b 0%, #f97316 100%); color:#111827; font-size:15px; font-weight:800; text-decoration:none; letter-spacing:0.02em;">
                Download GoldX Files
              </a>
            </div>
            <div style="display:grid; gap:14px; grid-template-columns:1fr 1fr; margin-top:24px;">
              <div style="padding:18px; border-radius:18px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);">
                <p style="margin:0 0 6px; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#93c5fd;">Download Access</p>
                <p style="margin:0; font-size:14px; line-height:1.7; color:#e2e8f0;">Use the button above to access your GoldX EA package and agreement files.</p>
              </div>
              <div style="padding:18px; border-radius:18px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);">
                <p style="margin:0 0 6px; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#67e8f9;">Next Steps</p>
                <p style="margin:0; font-size:14px; line-height:1.7; color:#e2e8f0;">Download the files, review the agreement, then install the EA in MT5 and complete setup.</p>
              </div>
            </div>
          </div>
          <div style="padding:30px 36px; background:#ffffff; color:#0f172a;">
            <h2 style="margin:0 0 12px; font-size:18px; font-weight:700;">Recommended setup flow</h2>
            <ol style="margin:0; padding-left:20px; font-size:14px; line-height:1.9; color:#334155;">
              <li>Use the download button above to access your GoldX files.</li>
              <li>Open the legal agreement PDF and review the product-use terms.</li>
              <li>Install the EA inside MetaTrader 5 and complete your license binding.</li>
              <li>Reply to this email if you need your key reissued or need help with MT5 setup.</li>
            </ol>
            <div style="margin-top:24px; padding:18px 20px; border-radius:18px; background:#eff6ff; border:1px solid #bfdbfe;">
              <p style="margin:0; font-size:13px; line-height:1.8; color:#1e3a8a;">
                We appreciate your subscription. If you want direct onboarding help, reply here and our team will guide you through installation and license activation.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const result = await resend.emails.send({
    from,
    replyTo,
    to,
    subject: 'Welcome to GoldX EA - your download link is ready',
    html,
  });

  if (result.error) {
    throw new Error(result.error.message || 'Failed to send GoldX delivery email.');
  }

  return {
    success: true,
    downloadUrl,
  };
}