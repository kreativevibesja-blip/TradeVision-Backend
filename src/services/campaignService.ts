// ── Campaign Email Sender (batch send with Resend) ──

import { Resend } from 'resend';
import { config } from '../config';
import { supabase } from '../lib/supabase';

const BATCH_SIZE = 15;
const BATCH_DELAY_MS = 1200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SendCampaignOpts {
  campaignId: string;
  subject: string;
  htmlContent: string;
  audience: 'all' | 'free' | 'pro' | 'single';
  singleEmail?: string;
}

/**
 * Send a single email through Resend.
 * Returns true on success, error message on failure.
 */
async function sendOne(
  resend: Resend,
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await resend.emails.send({
      from: config.email.from,
      replyTo: config.email.replyTo,
      to,
      subject,
      html,
    });
    if (result.error) {
      return { ok: false, error: result.error.message || 'Resend error' };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Unknown error' };
  }
}

/**
 * Fetch target users based on audience segment.
 */
async function fetchRecipients(
  audience: string,
  singleEmail?: string
): Promise<{ email: string; name: string | null }[]> {
  let query = supabase.from('User').select('email, name');

  switch (audience) {
    case 'free':
      query = query.eq('subscription', 'FREE');
      break;
    case 'pro':
      query = query.eq('subscription', 'PRO');
      break;
    case 'single':
      if (!singleEmail) return [];
      query = query.eq('email', singleEmail);
      break;
    // 'all' — no filter
  }

  query = query.eq('banned', false);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch recipients: ${error.message}`);
  return (data || []) as { email: string; name: string | null }[];
}

/**
 * Execute a full campaign send: fetch users, send in batches, log results, update campaign.
 */
export async function executeCampaignSend(opts: SendCampaignOpts): Promise<{
  sentCount: number;
  failedCount: number;
}> {
  if (!config.email.resendApiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }

  const resend = new Resend(config.email.resendApiKey);
  const recipients = await fetchRecipients(opts.audience, opts.singleEmail);

  // Mark campaign as 'sending'
  await supabase
    .from('EmailCampaign')
    .update({ status: 'sending', updatedAt: new Date().toISOString() })
    .eq('id', opts.campaignId);

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (r) => {
        const personalHtml = opts.htmlContent.replace(/\{\{name\}\}/g, r.name || 'Trader');
        const result = await sendOne(resend, r.email, opts.subject, personalHtml);

        // Log each send
        await supabase.from('EmailLog').insert({
          campaignId: opts.campaignId,
          userEmail: r.email,
          status: result.ok ? 'sent' : 'failed',
          errorMessage: result.error || null,
        });

        return result;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) {
        sentCount++;
      } else {
        failedCount++;
      }
    }

    // Delay between batches to respect rate limits
    if (i + BATCH_SIZE < recipients.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Finalize campaign
  await supabase
    .from('EmailCampaign')
    .update({
      status: 'sent',
      sentCount,
      failedCount,
      updatedAt: new Date().toISOString(),
    })
    .eq('id', opts.campaignId);

  return { sentCount, failedCount };
}

/**
 * Send a single test email to the admin.
 */
export async function sendTestEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ ok: boolean; error?: string }> {
  if (!config.email.resendApiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not configured.' };
  }
  const resend = new Resend(config.email.resendApiKey);
  return sendOne(resend, to, `[TEST] ${subject}`, html);
}
