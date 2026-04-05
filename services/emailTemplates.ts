// ── Email Campaign Templates ──

export interface EmailTemplate {
  key: string;
  label: string;
  subject: string;
  html: (vars: { name?: string }) => string;
}

const HEADER = `
<div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 24px; border-radius: 8px 8px 0 0; text-align: center;">
  <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">MyTradeVision</h1>
  <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8;">AI-Powered Trading Analysis</p>
</div>`;

const FOOTER = `
<div style="padding: 20px 24px; border-top: 1px solid #e2e8f0; text-align: center;">
  <p style="margin: 0; font-size: 12px; color: #94a3b8;">&copy; ${new Date().getFullYear()} MyTradeVision &middot; All rights reserved</p>
  <p style="margin: 6px 0 0; font-size: 11px; color: #cbd5e1;">You received this email because you're a MyTradeVision member.</p>
</div>`;

const wrap = (body: string) =>
  `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">${HEADER}<div style="padding: 32px 24px;">${body}</div>${FOOTER}</div>`;

const greeting = (name?: string) =>
  `<p style="margin: 0 0 20px; font-size: 15px; color: #334155; line-height: 1.6;">Hi ${name || 'Trader'},</p>`;

const cta = (text: string, url: string) =>
  `<div style="text-align: center; margin: 28px 0;">
    <a href="${url}" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">${text}</a>
  </div>`;

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    key: 'welcome',
    label: 'Welcome',
    subject: 'Welcome to MyTradeVision!',
    html: ({ name }) =>
      wrap(`
        ${greeting(name)}
        <p style="margin: 0 0 16px; font-size: 14px; color: #475569; line-height: 1.7;">
          We're thrilled to have you on board! MyTradeVision uses advanced AI to analyze your trading charts and deliver professional-grade insights in seconds.
        </p>
        <div style="margin: 0 0 24px; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
          <p style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: #1e293b;">Here's how to get started:</p>
          <ol style="margin: 0; padding-left: 20px; font-size: 14px; color: #475569; line-height: 2;">
            <li>Upload your trading chart screenshot</li>
            <li>Let our AI analyze market structure</li>
            <li>Get entry, SL & TP levels instantly</li>
          </ol>
        </div>
        ${cta('Start Analyzing', 'https://mytradevision.online/analyze')}
      `),
  },
  {
    key: 'upgrade_to_pro',
    label: 'Upgrade to Pro',
    subject: 'Unlock Pro — Unlimited Analyses + Live Charts',
    html: ({ name }) =>
      wrap(`
        ${greeting(name)}
        <p style="margin: 0 0 16px; font-size: 14px; color: #475569; line-height: 1.7;">
          You've been doing great with your free analyses! Ready to level up?
        </p>
        <div style="margin: 0 0 24px; padding: 20px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 12px; color: #ffffff;">
          <p style="margin: 0 0 12px; font-size: 16px; font-weight: 700; text-align: center;">Pro Membership</p>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 2; color: #e2e8f0;">
            <li>Unlimited chart analyses</li>
            <li>Pro AI model (higher accuracy)</li>
            <li>Live TradingView chart analysis</li>
            <li>Priority processing — no queue</li>
          </ul>
        </div>
        ${cta('Upgrade Now', 'https://mytradevision.online/pricing')}
      `),
  },
  {
    key: 'high_demand',
    label: 'High Demand Notice',
    subject: 'High Demand — Upgrade for Instant Access',
    html: ({ name }) =>
      wrap(`
        ${greeting(name)}
        <p style="margin: 0 0 16px; font-size: 14px; color: #475569; line-height: 1.7;">
          Our analysis servers are experiencing <strong>high demand</strong> right now! Free users may experience longer queue times.
        </p>
        <div style="margin: 0 0 24px; padding: 16px; background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>Pro members skip the queue entirely</strong> and get instant analysis — even during peak hours.
          </p>
        </div>
        ${cta('Skip the Queue — Go Pro', 'https://mytradevision.online/pricing')}
      `),
  },
  {
    key: 'feature_update',
    label: 'Feature Update',
    subject: "What's New on MyTradeVision",
    html: ({ name }) =>
      wrap(`
        ${greeting(name)}
        <p style="margin: 0 0 16px; font-size: 14px; color: #475569; line-height: 1.7;">
          We've been shipping new features and improvements to make your trading experience even better. Here's what's new:
        </p>
        <div style="margin: 0 0 24px; padding: 20px; background-color: #f8fafc; border-radius: 8px;">
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #475569; line-height: 2;">
            <li><strong>Live TradingView Charts</strong> — Analyze real-time market data with a single click</li>
            <li><strong>Improved AI Engine</strong> — More accurate SMC & Supply-Demand detection</li>
            <li><strong>Faster Processing</strong> — Reduced average analysis time by 40%</li>
            <li><strong>Campaign Emails</strong> — Stay updated with the latest from our team</li>
          </ul>
        </div>
        ${cta('Try It Out', 'https://mytradevision.online/dashboard')}
      `),
  },
  {
    key: 'education',
    label: 'Education Email',
    subject: 'Trading Tip: Read Your Charts Like a Pro',
    html: ({ name }) =>
      wrap(`
        ${greeting(name)}
        <p style="margin: 0 0 16px; font-size: 14px; color: #475569; line-height: 1.7;">
          Want to improve your chart-reading skills? Here are 3 quick tips our AI uses that you can apply right away:
        </p>
        <div style="margin: 0 0 24px;">
          <div style="margin-bottom: 16px; padding: 16px; background-color: #f0f9ff; border-radius: 8px;">
            <p style="margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #1e40af;">1. Identify Market Structure</p>
            <p style="margin: 0; font-size: 13px; color: #475569;">Look for higher highs and higher lows (bullish) or lower highs and lower lows (bearish) before placing a trade.</p>
          </div>
          <div style="margin-bottom: 16px; padding: 16px; background-color: #f0fdf4; border-radius: 8px;">
            <p style="margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #166534;">2. Spot Order Blocks</p>
            <p style="margin: 0; font-size: 13px; color: #475569;">The last bullish candle before a strong bearish move (or vice versa) often acts as a key support/resistance zone.</p>
          </div>
          <div style="padding: 16px; background-color: #faf5ff; border-radius: 8px;">
            <p style="margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #6b21a8;">3. Use Multi-Timeframe Confluence</p>
            <p style="margin: 0; font-size: 13px; color: #475569;">When your entry signal aligns across 2+ timeframes, the probability of a successful trade increases significantly.</p>
          </div>
        </div>
        <p style="margin: 0 0 8px; font-size: 14px; color: #475569;">Upload a chart and let our AI put these concepts to work for you:</p>
        ${cta('Analyze a Chart', 'https://mytradevision.online/analyze')}
      `),
  },
];

export function getTemplateByKey(key: string): EmailTemplate | undefined {
  return EMAIL_TEMPLATES.find((t) => t.key === key);
}
