// ── Email Campaign Controller ──

import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import { executeCampaignSend, sendTestEmail } from '../services/campaignService';
import { EMAIL_TEMPLATES, getTemplateByKey } from '../services/emailTemplates';
import type { AuthRequest } from '../middleware/auth';

// ── GET /admin/email-campaigns ──
export async function getEmailCampaigns(req: Request, res: Response) {
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;

    const { count } = await supabase
      .from('EmailCampaign')
      .select('id', { count: 'exact', head: true });

    const { data, error } = await supabase
      .from('EmailCampaign')
      .select('*')
      .order('createdAt', { ascending: false })
      .range(offset, offset + perPage - 1);

    if (error) throw error;

    res.json({
      campaigns: data || [],
      total: count || 0,
      page,
      pages: Math.ceil((count || 0) / perPage),
    });
  } catch (err: any) {
    console.error('getEmailCampaigns error:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns.' });
  }
}

// ── GET /admin/email-campaigns/:id ──
export async function getEmailCampaignById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data: campaign, error } = await supabase
      .from('EmailCampaign')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    // Fetch logs
    const { data: logs } = await supabase
      .from('EmailLog')
      .select('*')
      .eq('campaignId', id)
      .order('sentAt', { ascending: false })
      .limit(500);

    res.json({ campaign, logs: logs || [] });
  } catch (err: any) {
    console.error('getEmailCampaignById error:', err);
    res.status(500).json({ error: 'Failed to fetch campaign.' });
  }
}

// ── POST /admin/email-campaigns ──
export async function createEmailCampaign(req: Request, res: Response) {
  try {
    const { name, subject, htmlContent, audience, singleEmail, templateKey } = req.body;

    if (!name || !subject || !htmlContent) {
      return res.status(400).json({ error: 'name, subject, and htmlContent are required.' });
    }
    if (!['all', 'free', 'pro', 'single'].includes(audience)) {
      return res.status(400).json({ error: 'Invalid audience.' });
    }
    if (audience === 'single' && !singleEmail) {
      return res.status(400).json({ error: 'singleEmail is required for single audience.' });
    }

    const { data, error } = await supabase
      .from('EmailCampaign')
      .insert({
        name,
        subject,
        htmlContent,
        audience,
        singleEmail: audience === 'single' ? singleEmail : null,
        templateKey: templateKey || null,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ campaign: data });
  } catch (err: any) {
    console.error('createEmailCampaign error:', err);
    res.status(500).json({ error: 'Failed to create campaign.' });
  }
}

// ── POST /admin/email-campaigns/:id/send ──
export async function sendEmailCampaign(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data: campaign, error } = await supabase
      .from('EmailCampaign')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    if (campaign.status === 'sending') {
      return res.status(409).json({ error: 'Campaign is already being sent.' });
    }

    // Execute send (fire-and-forget for large sends, but we await for consistency)
    const result = await executeCampaignSend({
      campaignId: id,
      subject: campaign.subject,
      htmlContent: campaign.htmlContent,
      audience: campaign.audience,
      singleEmail: campaign.singleEmail || undefined,
    });

    res.json({
      success: true,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
    });
  } catch (err: any) {
    console.error('sendEmailCampaign error:', err);
    res.status(500).json({ error: 'Failed to send campaign.' });
  }
}

// ── POST /admin/email-campaigns/test ──
export async function sendTestCampaignEmail(req: Request, res: Response) {
  try {
    const authReq = req as AuthRequest;
    const adminEmail = authReq.user?.email;
    if (!adminEmail) {
      return res.status(400).json({ error: 'Cannot determine admin email.' });
    }

    const { subject, htmlContent } = req.body;
    if (!subject || !htmlContent) {
      return res.status(400).json({ error: 'subject and htmlContent are required.' });
    }

    const result = await sendTestEmail(adminEmail, subject, htmlContent);

    if (!result.ok) {
      return res.status(500).json({ error: result.error || 'Failed to send test email.' });
    }

    res.json({ success: true, sentTo: adminEmail });
  } catch (err: any) {
    console.error('sendTestCampaignEmail error:', err);
    res.status(500).json({ error: 'Failed to send test email.' });
  }
}

// ── POST /admin/email-campaigns/:id/retry ──
export async function retryFailedEmails(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const { data: campaign, error: campErr } = await supabase
      .from('EmailCampaign')
      .select('*')
      .eq('id', id)
      .single();

    if (campErr || !campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    // Get failed logs
    const { data: failedLogs, error: logErr } = await supabase
      .from('EmailLog')
      .select('*')
      .eq('campaignId', id)
      .eq('status', 'failed');

    if (logErr) throw logErr;
    if (!failedLogs || failedLogs.length === 0) {
      return res.json({ success: true, retriedCount: 0, message: 'No failed emails to retry.' });
    }

    const { Resend } = await import('resend');
    const { config } = await import('../config');
    const resend = new Resend(config.email.resendApiKey);

    let retriedOk = 0;
    let retriedFail = 0;

    for (const log of failedLogs) {
      try {
        const result = await resend.emails.send({
          from: config.email.from,
          replyTo: config.email.replyTo,
          to: log.userEmail,
          subject: campaign.subject,
          html: campaign.htmlContent.replace(/\{\{name\}\}/g, 'Trader'),
        });

        if (result.error) {
          retriedFail++;
          await supabase
            .from('EmailLog')
            .update({ errorMessage: result.error.message })
            .eq('id', log.id);
        } else {
          retriedOk++;
          await supabase
            .from('EmailLog')
            .update({ status: 'sent', errorMessage: null, sentAt: new Date().toISOString() })
            .eq('id', log.id);
        }
      } catch (err: any) {
        retriedFail++;
      }
    }

    // Update counts
    const { data: sentLogs } = await supabase
      .from('EmailLog')
      .select('id', { count: 'exact', head: true })
      .eq('campaignId', id)
      .eq('status', 'sent');

    const { data: failLogs } = await supabase
      .from('EmailLog')
      .select('id', { count: 'exact', head: true })
      .eq('campaignId', id)
      .eq('status', 'failed');

    // Use the count from head queries
    const { count: sentCountVal } = await supabase
      .from('EmailLog')
      .select('id', { count: 'exact', head: true })
      .eq('campaignId', id)
      .eq('status', 'sent');

    const { count: failCountVal } = await supabase
      .from('EmailLog')
      .select('id', { count: 'exact', head: true })
      .eq('campaignId', id)
      .eq('status', 'failed');

    await supabase
      .from('EmailCampaign')
      .update({ sentCount: sentCountVal || 0, failedCount: failCountVal || 0, updatedAt: new Date().toISOString() })
      .eq('id', id);

    res.json({ success: true, retriedOk, retriedFail });
  } catch (err: any) {
    console.error('retryFailedEmails error:', err);
    res.status(500).json({ error: 'Failed to retry emails.' });
  }
}

// ── GET /admin/email-templates ──
export async function getEmailTemplates(_req: Request, res: Response) {
  res.json({
    templates: EMAIL_TEMPLATES.map((t) => ({ key: t.key, label: t.label, subject: t.subject })),
  });
}

// ── GET /admin/email-templates/:key/preview ──
export async function previewEmailTemplate(req: Request, res: Response) {
  const tpl = getTemplateByKey(req.params.key);
  if (!tpl) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  res.json({ subject: tpl.subject, html: tpl.html({ name: 'Trader' }) });
}

// ── GET /admin/users/search?query= ──
export async function searchUsers(req: Request, res: Response) {
  try {
    const q = String(req.query.query || '').trim();
    if (!q) {
      return res.json({ users: [] });
    }

    const { data, error } = await supabase
      .from('User')
      .select('id, email, name, subscription')
      .or(`email.ilike.%${q}%,name.ilike.%${q}%`)
      .eq('banned', false)
      .limit(10);

    if (error) throw error;

    res.json({ users: data || [] });
  } catch (err: any) {
    console.error('searchUsers error:', err);
    res.status(500).json({ error: 'Failed to search users.' });
  }
}
