import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { config } from '../config';
import { getSystemSetting, supabase, type SubscriptionTier } from '../lib/supabase';

interface NumericZone {
  min: number | null;
  max: number | null;
  reason?: string;
}

interface MarkupAnalysis {
  zones?: {
    supplyZone?: NumericZone | null;
    demandZone?: NumericZone | null;
  };
  entryPlan?: {
    entryZone?: NumericZone | null;
  };
  entryZone?: NumericZone | null;
  liquidity?: {
    type?: 'buy-side' | 'sell-side' | 'none';
    description?: string;
  };
  invalidationLevel?: number | null;
  currentPrice?: number;
}

interface ChartBoundsInput {
  minPrice: number | null;
  maxPrice: number | null;
}

interface ChartBounds {
  minPrice: number;
  maxPrice: number;
  source: 'input' | 'inferred';
}

interface DrawContext {
  width: number;
  height: number;
  bounds: ChartBounds;
  plotArea: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
}

interface MarkupResult {
  markedImageUrl: string | null;
  chartBounds: ChartBounds | null;
  hasMarkup: boolean;
}

const CHART_MARKUP_FREE_ENABLED_KEY = 'chart_markup_free_enabled';
const CHART_MARKUP_PRO_ENABLED_KEY = 'chart_markup_pro_enabled';

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const collectZoneNumbers = (zone?: NumericZone | null) => {
  if (!zone) {
    return [] as number[];
  }

  return [zone.min, zone.max].filter(isFiniteNumber);
};

const formatMarkupPrice = (value: number) => {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(2);
  }

  if (Math.abs(value) >= 1) {
    return value.toFixed(4);
  }

  return value.toFixed(5);
};

const inferChartBounds = (analysis: MarkupAnalysis, input: ChartBoundsInput): ChartBounds | null => {
  if (isFiniteNumber(input.minPrice) && isFiniteNumber(input.maxPrice) && input.maxPrice > input.minPrice) {
    return {
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      source: 'input',
    };
  }

  const numbers = [
    ...collectZoneNumbers(analysis.zones?.supplyZone),
    ...collectZoneNumbers(analysis.zones?.demandZone),
    ...collectZoneNumbers(analysis.entryPlan?.entryZone),
    ...collectZoneNumbers(analysis.entryZone),
    analysis.invalidationLevel,
    analysis.currentPrice,
  ].filter(isFiniteNumber);

  if (numbers.length < 2) {
    return null;
  }

  const minPrice = Math.min(...numbers);
  const maxPrice = Math.max(...numbers);
  const range = maxPrice - minPrice;

  if (!Number.isFinite(range) || range <= 0) {
    return null;
  }

  if (isFiniteNumber(analysis.currentPrice)) {
    const currentPrice = analysis.currentPrice;
    const furthestDistance = Math.max(...numbers.map((value) => Math.abs(value - currentPrice)));
    const paddedDistance = furthestDistance * 1.18;

    if (Number.isFinite(paddedDistance) && paddedDistance > 0) {
      return {
        minPrice: currentPrice - paddedDistance,
        maxPrice: currentPrice + paddedDistance,
        source: 'inferred',
      };
    }
  }

  const padding = range * 0.14;

  return {
    minPrice: minPrice - padding,
    maxPrice: maxPrice + padding,
    source: 'inferred',
  };
};

const priceToY = (price: number, context: DrawContext) => {
  const range = context.bounds.maxPrice - context.bounds.minPrice;
  if (!Number.isFinite(range) || range <= 0) {
    return null;
  }

  const percent = (price - context.bounds.minPrice) / range;
  return context.plotArea.bottom - percent * context.plotArea.height;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const inferPlotArea = (width: number, height: number) => {
  const left = Math.round(width * 0.03);
  const right = Math.round(width * 0.91);
  const top = Math.round(height * 0.11);
  const bottom = Math.round(height * 0.88);

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
};

const drawTag = (x: number, y: number, color: string, title: string, subtitle?: string) => {
  const safeTitle = escapeXml(title);
  const safeSubtitle = subtitle ? escapeXml(subtitle) : '';
  const width = Math.max(124, Math.min(260, 48 + Math.max(title.length, subtitle?.length || 0) * 7));
  const height = subtitle ? 42 : 28;

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="rgba(10,14,23,0.92)" stroke="${color}" stroke-width="1.5" rx="10" />
    <text x="${x + 12}" y="${y + 18}" fill="${color}" font-size="13" font-family="Arial, sans-serif" font-weight="700">${safeTitle}</text>
    ${subtitle ? `<text x="${x + 12}" y="${y + 33}" fill="#e2e8f0" font-size="11" font-family="Arial, sans-serif" font-weight="500">${safeSubtitle}</text>` : ''}
  `;
};

const drawZone = (context: DrawContext, zone: NumericZone | null | undefined, color: string, label: string) => {
  if (!zone || !isFiniteNumber(zone.min) || !isFiniteNumber(zone.max)) {
    return '';
  }

  const y1 = priceToY(zone.max, context);
  const y2 = priceToY(zone.min, context);

  if (!isFiniteNumber(y1) || !isFiniteNumber(y2)) {
    return '';
  }

  const top = clamp(Math.min(y1, y2), context.plotArea.top, context.plotArea.bottom);
  const height = clamp(Math.abs(y2 - y1), 0, context.plotArea.height);

  if (height < 2) {
    return '';
  }

  const centerY = top + height / 2;
  const tagY = clamp(top - 34, context.plotArea.top + 4, context.plotArea.bottom - 46);
  const priceRange = `${formatMarkupPrice(zone.min)} - ${formatMarkupPrice(zone.max)}`;
  const tagX = clamp(context.plotArea.left + 14, 12, context.plotArea.right - 220);
  const anchorX = context.plotArea.left + 8;
  const anchorY = clamp(centerY, context.plotArea.top + 8, context.plotArea.bottom - 8);
  const reason = zone.reason || undefined;

  return `
    <rect x="${context.plotArea.left}" y="${top}" width="${context.plotArea.width}" height="${height}" fill="${color}24" stroke="${color}" stroke-width="2" rx="4" />
    <line x1="${anchorX}" y1="${anchorY}" x2="${tagX}" y2="${tagY + 20}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 4" />
    <circle cx="${anchorX}" cy="${anchorY}" r="3.5" fill="${color}" />
    ${drawTag(tagX, tagY, color, label, reason ? `${priceRange} • ${reason}` : priceRange)}
  `;
};

const drawLegendBadges = (context: DrawContext, analysis: MarkupAnalysis) => {
  const badges = [
    analysis.zones?.supplyZone ? { label: 'Supply', color: '#ef4444' } : null,
    analysis.zones?.demandZone ? { label: 'Demand', color: '#22c55e' } : null,
    (analysis.entryPlan?.entryZone ?? analysis.entryZone) ? { label: 'Entry', color: '#3b82f6' } : null,
    analysis.liquidity?.type && analysis.liquidity.type !== 'none'
      ? { label: 'Sweep', color: analysis.liquidity.type === 'buy-side' ? '#f59e0b' : '#06b6d4' }
      : null,
  ].filter(Boolean) as Array<{ label: string; color: string }>;

  if (!badges.length) {
    return '';
  }

  const badgeWidth = 92;
  const badgeHeight = 28;
  const gap = 10;
  const totalWidth = badges.length * badgeWidth + (badges.length - 1) * gap;
  const startX = Math.max(context.plotArea.left, context.plotArea.right - totalWidth);
  const y = Math.max(14, context.plotArea.top - 44);

  return badges
    .map((badge, index) => {
      const x = startX + index * (badgeWidth + gap);
      return `
        <rect x="${x}" y="${y}" width="${badgeWidth}" height="${badgeHeight}" fill="rgba(10,14,23,0.88)" stroke="${badge.color}" stroke-width="1.5" rx="10" />
        <circle cx="${x + 16}" cy="${y + 14}" r="5" fill="${badge.color}" />
        <text x="${x + 28}" y="${y + 19}" fill="#f8fafc" font-size="13" font-family="Arial, sans-serif" font-weight="700">${escapeXml(badge.label)}</text>
      `;
    })
    .join('\n');
};

const resolveLiquidityLevel = (analysis: MarkupAnalysis) => {
  if (analysis.liquidity?.type === 'buy-side') {
    const candidates = [
      analysis.zones?.supplyZone?.max,
      analysis.entryPlan?.entryZone?.max,
      analysis.entryZone?.max,
      analysis.invalidationLevel,
    ].filter(isFiniteNumber);

    return candidates.length ? Math.max(...candidates) : null;
  }

  if (analysis.liquidity?.type === 'sell-side') {
    const candidates = [
      analysis.zones?.demandZone?.min,
      analysis.entryPlan?.entryZone?.min,
      analysis.entryZone?.min,
      analysis.invalidationLevel,
    ].filter(isFiniteNumber);

    return candidates.length ? Math.min(...candidates) : null;
  }

  return null;
};

const drawLiquidityMarker = (context: DrawContext, analysis: MarkupAnalysis) => {
  const level = resolveLiquidityLevel(analysis);
  if (!isFiniteNumber(level)) {
    return '';
  }

  const y = priceToY(level, context);
  if (!isFiniteNumber(y)) {
    return '';
  }

  const color = analysis.liquidity?.type === 'buy-side' ? '#f59e0b' : '#06b6d4';
  const label = analysis.liquidity?.type === 'buy-side' ? 'Liquidity sweep above highs' : 'Liquidity sweep below lows';
  const safeY = clamp(y, context.plotArea.top + 8, context.plotArea.bottom - 8);
  const tagX = clamp(context.plotArea.right - 232, context.plotArea.left + 12, context.plotArea.right - 180);
  const tagY = clamp(safeY - 18, context.plotArea.top + 6, context.plotArea.bottom - 34);

  return `
    <line x1="${context.plotArea.left}" y1="${safeY}" x2="${context.plotArea.right}" y2="${safeY}" stroke="${color}" stroke-width="2" stroke-dasharray="10 8" />
    ${drawTag(tagX, tagY, color, 'Liquidity sweep', label)}
  `;
};

const buildOverlay = (context: DrawContext, analysis: MarkupAnalysis) => {
  const fragments = [
    drawLegendBadges(context, analysis),
    drawZone(context, analysis.zones?.supplyZone, '#ef4444', 'Supply zone'),
    drawZone(context, analysis.zones?.demandZone, '#22c55e', 'Demand zone'),
    drawZone(context, analysis.entryPlan?.entryZone ?? analysis.entryZone, '#3b82f6', 'Entry zone'),
    drawLiquidityMarker(context, analysis),
  ].filter(Boolean);

  if (!fragments.length) {
    return null;
  }

  return Buffer.from(`
    <svg width="${context.width}" height="${context.height}" viewBox="0 0 ${context.width} ${context.height}" fill="none" xmlns="http://www.w3.org/2000/svg">
      ${fragments.join('\n')}
    </svg>
  `);
};

const parseBooleanSetting = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
};

export async function isChartMarkupEnabledForPlan(subscription: SubscriptionTier) {
  const key = subscription === 'PRO' ? CHART_MARKUP_PRO_ENABLED_KEY : CHART_MARKUP_FREE_ENABLED_KEY;
  const setting = await getSystemSetting(key);
  return parseBooleanSetting(setting?.value, true);
}

const writeLocalMarkup = async (buffer: Buffer) => {
  const fileName = `markup-${randomUUID()}.png`;
  const filePath = path.join(process.cwd(), config.upload.dir, fileName);
  await fs.writeFile(filePath, buffer);
  return `/uploads/${fileName}`;
};

const uploadMarkupToStorage = async (buffer: Buffer) => {
  const bucket = config.supabase.storageBucket;
  if (!bucket) {
    throw new Error('No Supabase storage bucket configured');
  }

  const objectPath = `markups/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.png`;
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType: 'image/png',
    upsert: false,
  });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
};

export async function drawChartMarkup(
  imageBuffer: Buffer,
  analysis: MarkupAnalysis,
  chartBoundsInput: ChartBoundsInput
): Promise<MarkupResult> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.width || !metadata.height) {
      return { markedImageUrl: null, chartBounds: null, hasMarkup: false };
    }

    const chartBounds = inferChartBounds(analysis, chartBoundsInput);
    if (!chartBounds) {
      return { markedImageUrl: null, chartBounds: null, hasMarkup: false };
    }

    const overlay = buildOverlay(
      {
        width: metadata.width,
        height: metadata.height,
        bounds: chartBounds,
        plotArea: inferPlotArea(metadata.width, metadata.height),
      },
      analysis
    );

    if (!overlay) {
      return { markedImageUrl: null, chartBounds, hasMarkup: false };
    }

    const markedBuffer = await sharp(imageBuffer)
      .composite([{ input: overlay }])
      .png()
      .toBuffer();

    try {
      const markedImageUrl = await uploadMarkupToStorage(markedBuffer);
      return { markedImageUrl, chartBounds, hasMarkup: true };
    } catch (storageError) {
      console.warn('[chartMarkup] Supabase storage upload failed, falling back to local uploads:', storageError);
      const markedImageUrl = await writeLocalMarkup(markedBuffer);
      return { markedImageUrl, chartBounds, hasMarkup: true };
    }
  } catch (error) {
    console.error('[chartMarkup] failed to generate markup:', error);
    return { markedImageUrl: null, chartBounds: null, hasMarkup: false };
  }
}