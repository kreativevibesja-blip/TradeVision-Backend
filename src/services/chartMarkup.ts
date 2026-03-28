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
  visiblePriceRange?: { min: number; max: number } | null;
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
  const decimals = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 1 ? 4 : 5;
  const parts = value.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};

const inferChartBounds = (analysis: MarkupAnalysis, input: ChartBoundsInput): ChartBounds | null => {
  if (isFiniteNumber(input.minPrice) && isFiniteNumber(input.maxPrice) && input.maxPrice > input.minPrice) {
    return {
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      source: 'input',
    };
  }

  if (
    analysis.visiblePriceRange &&
    isFiniteNumber(analysis.visiblePriceRange.min) &&
    isFiniteNumber(analysis.visiblePriceRange.max) &&
    analysis.visiblePriceRange.max > analysis.visiblePriceRange.min
  ) {
    return {
      minPrice: analysis.visiblePriceRange.min,
      maxPrice: analysis.visiblePriceRange.max,
      source: 'inferred',
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

  const padding = range * 0.12;

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

const isPriceWithinBounds = (price: number, context: DrawContext) =>
  price >= context.bounds.minPrice && price <= context.bounds.maxPrice;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const inferPlotArea = (width: number, height: number) => {
  const left = Math.round(width * 0.005);
  const right = Math.round(width * 0.905);
  const top = Math.round(height * 0.06);
  const bottom = Math.round(height * 0.925);

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
};

const FONT_STACK = 'DejaVu Sans, Liberation Sans, Noto Sans, Arial, Helvetica, sans-serif';

const drawTag = (x: number, y: number, color: string, title: string, subtitle?: string) => {
  const safeTitle = escapeXml(title);
  const safeSubtitle = subtitle ? escapeXml(subtitle) : '';
  const width = Math.max(90, Math.min(210, 32 + Math.max(title.length, subtitle?.length || 0) * 5.6));
  const height = subtitle ? 32 : 20;

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="rgba(10,14,23,0.92)" stroke="${color}" stroke-width="1" rx="4" />
    <text x="${x + 8}" y="${y + 13}" fill="${color}" font-size="10" font-family="${FONT_STACK}" font-weight="700">${safeTitle}</text>
    ${subtitle ? `<text x="${x + 8}" y="${y + 25}" fill="#e2e8f0" font-size="8" font-family="${FONT_STACK}" font-weight="500">${safeSubtitle}</text>` : ''}
  `;
};

const drawZone = (context: DrawContext, zone: NumericZone | null | undefined, color: string, label: string) => {
  if (!zone || !isFiniteNumber(zone.min) || !isFiniteNumber(zone.max)) {
    return '';
  }

  if (zone.max < context.bounds.minPrice || zone.min > context.bounds.maxPrice) {
    return '';
  }

  const visibleMin = clamp(zone.min, context.bounds.minPrice, context.bounds.maxPrice);
  const visibleMax = clamp(zone.max, context.bounds.minPrice, context.bounds.maxPrice);

  const y1 = priceToY(visibleMax, context);
  const y2 = priceToY(visibleMin, context);

  if (!isFiniteNumber(y1) || !isFiniteNumber(y2)) {
    return '';
  }

  const rawTop = Math.min(y1, y2);
  const rawHeight = Math.abs(y2 - y1);
  const maxHeight = context.plotArea.height * 0.12;
  const height = clamp(Math.min(rawHeight, maxHeight), 2, context.plotArea.height);
  const center = rawTop + rawHeight / 2;
  const top = clamp(center - height / 2, context.plotArea.top, context.plotArea.bottom - height);

  if (height < 2) {
    return '';
  }

  const tagY = clamp(top - 26, context.plotArea.top + 2, context.plotArea.bottom - 36);
  const tagX = clamp(context.plotArea.left + 10, 8, context.plotArea.right - 180);
  const anchorX = context.plotArea.left + 6;
  const anchorY = clamp(center, context.plotArea.top + 4, context.plotArea.bottom - 4);

  return `
    <rect x="${context.plotArea.left}" y="${top}" width="${context.plotArea.width}" height="${height}" fill="${color}18" stroke="${color}" stroke-width="1" rx="2" />
    <line x1="${anchorX}" y1="${anchorY}" x2="${tagX}" y2="${tagY + 14}" stroke="${color}" stroke-width="1" stroke-dasharray="4 3" opacity="0.6" />
    <circle cx="${anchorX}" cy="${anchorY}" r="2.5" fill="${color}" />
    ${drawTag(tagX, tagY, color, label)}
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

  const badgeWidth = 72;
  const badgeHeight = 20;
  const gap = 6;
  const totalWidth = badges.length * badgeWidth + (badges.length - 1) * gap;
  const startX = Math.max(context.plotArea.left, context.plotArea.right - totalWidth);
  const y = Math.max(8, context.plotArea.top - 28);

  return badges
    .map((badge, index) => {
      const x = startX + index * (badgeWidth + gap);
      return `
        <rect x="${x}" y="${y}" width="${badgeWidth}" height="${badgeHeight}" fill="rgba(10,14,23,0.88)" stroke="${badge.color}" stroke-width="1" rx="4" />
        <circle cx="${x + 12}" cy="${y + 10}" r="3.5" fill="${badge.color}" />
        <text x="${x + 22}" y="${y + 14}" fill="#f8fafc" font-size="10" font-family="${FONT_STACK}" font-weight="700">${escapeXml(badge.label)}</text>
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

  if (!isPriceWithinBounds(level, context)) {
    return '';
  }

  const y = priceToY(level, context);
  if (!isFiniteNumber(y)) {
    return '';
  }

  const color = analysis.liquidity?.type === 'buy-side' ? '#f59e0b' : '#06b6d4';
  const sweepLabel = analysis.liquidity?.type === 'buy-side' ? 'above highs' : 'below lows';
  const safeY = clamp(y, context.plotArea.top + 4, context.plotArea.bottom - 4);
  const tagX = clamp(context.plotArea.right - 180, context.plotArea.left + 8, context.plotArea.right - 120);
  const tagY = clamp(safeY - 14, context.plotArea.top + 4, context.plotArea.bottom - 26);

  return `
    <line x1="${context.plotArea.left}" y1="${safeY}" x2="${context.plotArea.right}" y2="${safeY}" stroke="${color}" stroke-width="1.5" stroke-dasharray="8 6" opacity="0.8" />
    ${drawTag(tagX, tagY, color, 'Liq. sweep', sweepLabel)}
  `;
};

const buildOverlay = (context: DrawContext, analysis: MarkupAnalysis) => {
  const fragments = [
    drawLegendBadges(context, analysis),
    drawZone(context, analysis.zones?.supplyZone, '#ef4444', 'Resistance zone'),
    drawZone(context, analysis.zones?.demandZone, '#22c55e', 'Support zone'),
    drawZone(context, analysis.entryPlan?.entryZone ?? analysis.entryZone, '#3b82f6', 'Entry zone'),
    drawLiquidityMarker(context, analysis),
  ].filter(Boolean);

  if (!fragments.length) {
    return null;
  }

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <svg width="${context.width}" height="${context.height}" viewBox="0 0 ${context.width} ${context.height}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style type="text/css">
          text { font-family: 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Arial', 'Helvetica', sans-serif; }
        </style>
      </defs>
      ${fragments.join('\n')}
    </svg>
  `);
};

// ============================================
// Specialized HTF/LTF overlay builders
// ============================================

const drawPriceLevel = (context: DrawContext, price: number | null | undefined, color: string, label: string) => {
  if (!isFiniteNumber(price)) return '';
  if (!isPriceWithinBounds(price, context)) return '';
  const y = priceToY(price, context);
  if (!isFiniteNumber(y)) return '';
  const safeY = clamp(y, context.plotArea.top + 4, context.plotArea.bottom - 4);
  const tagX = clamp(context.plotArea.right - 200, context.plotArea.left + 8, context.plotArea.right - 140);
  const tagY = clamp(safeY - 14, context.plotArea.top + 4, context.plotArea.bottom - 26);
  return `
    <line x1="${context.plotArea.left}" y1="${safeY}" x2="${context.plotArea.right}" y2="${safeY}" stroke="${color}" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.9" />
    ${drawTag(tagX, tagY, color, label)}
  `;
};

const resolveSafeExitLevels = (analysis: MarkupAnalysis & { takeProfit1?: number | null; takeProfit2?: number | null; takeProfit3?: number | null }) => {
  const candidates = [analysis.takeProfit1, analysis.takeProfit2, analysis.takeProfit3].filter(isFiniteNumber);
  const uniqueLevels = candidates.filter((level, index) => candidates.findIndex((candidate) => Math.abs(candidate - level) < 1e-8) === index);

  return uniqueLevels.slice(0, 2).map((price, index) => ({
    price,
    label: `Safe Exit ${index + 1}`,
    color: index === 0 ? '#10b981' : '#34d399',
  }));
};

const buildHTFOverlay = (context: DrawContext, analysis: MarkupAnalysis) => {
  // HTF: Resistance/support zones + premium/discount indicator + liquidity pool
  const premiumDiscountLabel = analysis.zones?.supplyZone && analysis.zones?.demandZone
    ? (() => {
        const supply = analysis.zones.supplyZone;
        const demand = analysis.zones.demandZone;
        if (!isFiniteNumber(supply.max) || !isFiniteNumber(demand.min)) return '';
        const midY = priceToY((supply.max + demand.min) / 2, context);
        if (!isFiniteNumber(midY)) return '';
        const safeMidY = clamp(midY, context.plotArea.top + 4, context.plotArea.bottom - 4);
        return `
          <line x1="${context.plotArea.left}" y1="${safeMidY}" x2="${context.plotArea.right}" y2="${safeMidY}" stroke="#a78bfa" stroke-width="1" stroke-dasharray="4 4" opacity="0.6" />
          ${drawTag(context.plotArea.left + 10, clamp(safeMidY - 26, context.plotArea.top + 4, context.plotArea.bottom - 36), '#a78bfa', 'Equilibrium', 'Premium above · Discount below')}
        `;
      })()
    : '';

  const htfBadges = [
    analysis.zones?.supplyZone ? { label: 'Resistance', color: '#ef4444' } : null,
    analysis.zones?.demandZone ? { label: 'Support', color: '#22c55e' } : null,
    { label: 'P/D', color: '#a78bfa' },
    analysis.liquidity?.type && analysis.liquidity.type !== 'none'
      ? { label: 'Liquidity', color: analysis.liquidity.type === 'buy-side' ? '#f59e0b' : '#06b6d4' }
      : null,
  ].filter(Boolean) as Array<{ label: string; color: string }>;

  const badgesSvg = (() => {
    if (!htfBadges.length) return '';
    const badgeWidth = 72;
    const gap = 6;
    const totalWidth = htfBadges.length * badgeWidth + (htfBadges.length - 1) * gap;
    const startX = Math.max(context.plotArea.left, context.plotArea.right - totalWidth);
    const y = Math.max(8, context.plotArea.top - 28);
    return htfBadges.map((badge, i) => {
      const x = startX + i * (badgeWidth + gap);
      return `
        <rect x="${x}" y="${y}" width="${badgeWidth}" height="20" fill="rgba(10,14,23,0.88)" stroke="${badge.color}" stroke-width="1" rx="4" />
        <circle cx="${x + 12}" cy="${y + 10}" r="3.5" fill="${badge.color}" />
        <text x="${x + 22}" y="${y + 14}" fill="#f8fafc" font-size="10" font-family="${FONT_STACK}" font-weight="700">${escapeXml(badge.label)}</text>
      `;
    }).join('\n');
  })();

  const fragments = [
    badgesSvg,
    drawZone(context, analysis.zones?.supplyZone, '#ef4444', 'HTF Resistance'),
    drawZone(context, analysis.zones?.demandZone, '#22c55e', 'HTF Support'),
    premiumDiscountLabel,
    drawLiquidityMarker(context, analysis),
  ].filter(Boolean);

  if (!fragments.length) return null;

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <svg width="${context.width}" height="${context.height}" viewBox="0 0 ${context.width} ${context.height}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><style type="text/css">text { font-family: 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Arial', 'Helvetica', sans-serif; }</style></defs>
      ${fragments.join('\n')}
    </svg>
  `);
};

const buildLTFOverlay = (context: DrawContext, analysis: MarkupAnalysis & { stopLoss?: number | null; takeProfit1?: number | null; takeProfit2?: number | null; takeProfit3?: number | null }) => {
  const safeExits = resolveSafeExitLevels(analysis);

  // LTF: Entry zone + SL + safe exits + internal support/resistance zones + liquidity sweep
  const ltfBadges = [
    (analysis.entryPlan?.entryZone ?? analysis.entryZone) ? { label: 'Entry', color: '#3b82f6' } : null,
    isFiniteNumber(analysis.stopLoss) ? { label: 'SL', color: '#ef4444' } : null,
    safeExits.length ? { label: 'Exits', color: '#10b981' } : null,
    analysis.zones?.supplyZone ? { label: 'Int. Resist.', color: '#f97316' } : null,
    analysis.zones?.demandZone ? { label: 'Int. Support', color: '#06b6d4' } : null,
    analysis.liquidity?.type && analysis.liquidity.type !== 'none'
      ? { label: 'Sweep', color: analysis.liquidity.type === 'buy-side' ? '#f59e0b' : '#06b6d4' }
      : null,
  ].filter(Boolean) as Array<{ label: string; color: string }>;

  const badgesSvg = (() => {
    if (!ltfBadges.length) return '';
    const badgeWidth = 72;
    const gap = 6;
    const totalWidth = ltfBadges.length * badgeWidth + (ltfBadges.length - 1) * gap;
    const startX = Math.max(context.plotArea.left, context.plotArea.right - totalWidth);
    const y = Math.max(8, context.plotArea.top - 28);
    return ltfBadges.map((badge, i) => {
      const x = startX + i * (badgeWidth + gap);
      return `
        <rect x="${x}" y="${y}" width="${badgeWidth}" height="20" fill="rgba(10,14,23,0.88)" stroke="${badge.color}" stroke-width="1" rx="4" />
        <circle cx="${x + 12}" cy="${y + 10}" r="3.5" fill="${badge.color}" />
        <text x="${x + 22}" y="${y + 14}" fill="#f8fafc" font-size="10" font-family="${FONT_STACK}" font-weight="700">${escapeXml(badge.label)}</text>
      `;
    }).join('\n');
  })();

  const fragments = [
    badgesSvg,
    drawZone(context, analysis.zones?.supplyZone, '#f97316', 'Internal resistance'),
    drawZone(context, analysis.zones?.demandZone, '#06b6d4', 'Internal support'),
    drawZone(context, analysis.entryPlan?.entryZone ?? analysis.entryZone, '#3b82f6', 'Entry zone'),
    drawPriceLevel(context, analysis.stopLoss, '#ef4444', 'Stop Loss'),
    ...safeExits.map((exit) => drawPriceLevel(context, exit.price, exit.color, exit.label)),
    drawLiquidityMarker(context, analysis),
  ].filter(Boolean);

  if (!fragments.length) return null;

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <svg width="${context.width}" height="${context.height}" viewBox="0 0 ${context.width} ${context.height}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><style type="text/css">text { font-family: 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Arial', 'Helvetica', sans-serif; }</style></defs>
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

export async function drawHTFChartMarkup(
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

    const overlay = buildHTFOverlay(
      { width: metadata.width, height: metadata.height, bounds: chartBounds, plotArea: inferPlotArea(metadata.width, metadata.height) },
      analysis
    );

    if (!overlay) {
      return { markedImageUrl: null, chartBounds, hasMarkup: false };
    }

    const markedBuffer = await sharp(imageBuffer).composite([{ input: overlay }]).png().toBuffer();

    try {
      const markedImageUrl = await uploadMarkupToStorage(markedBuffer);
      return { markedImageUrl, chartBounds, hasMarkup: true };
    } catch {
      const markedImageUrl = await writeLocalMarkup(markedBuffer);
      return { markedImageUrl, chartBounds, hasMarkup: true };
    }
  } catch (error) {
    console.error('[chartMarkup] failed to generate HTF markup:', error);
    return { markedImageUrl: null, chartBounds: null, hasMarkup: false };
  }
}

export async function drawLTFChartMarkup(
  imageBuffer: Buffer,
  analysis: MarkupAnalysis & { stopLoss?: number | null; takeProfit1?: number | null; takeProfit2?: number | null; takeProfit3?: number | null },
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

    const overlay = buildLTFOverlay(
      { width: metadata.width, height: metadata.height, bounds: chartBounds, plotArea: inferPlotArea(metadata.width, metadata.height) },
      analysis
    );

    if (!overlay) {
      return { markedImageUrl: null, chartBounds, hasMarkup: false };
    }

    const markedBuffer = await sharp(imageBuffer).composite([{ input: overlay }]).png().toBuffer();

    try {
      const markedImageUrl = await uploadMarkupToStorage(markedBuffer);
      return { markedImageUrl, chartBounds, hasMarkup: true };
    } catch {
      const markedImageUrl = await writeLocalMarkup(markedBuffer);
      return { markedImageUrl, chartBounds, hasMarkup: true };
    }
  } catch (error) {
    console.error('[chartMarkup] failed to generate LTF markup:', error);
    return { markedImageUrl: null, chartBounds: null, hasMarkup: false };
  }
}