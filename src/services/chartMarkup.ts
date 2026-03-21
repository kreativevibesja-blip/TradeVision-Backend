import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { config } from '../config';
import { supabase } from '../lib/supabase';

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
}

interface MarkupResult {
  markedImageUrl: string | null;
  chartBounds: ChartBounds | null;
  hasMarkup: boolean;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const collectZoneNumbers = (zone?: NumericZone | null) => {
  if (!zone) {
    return [] as number[];
  }

  return [zone.min, zone.max].filter(isFiniteNumber);
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
  return context.height - percent * context.height;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const drawZone = (context: DrawContext, zone: NumericZone | null | undefined, color: string, label: string) => {
  if (!zone || !isFiniteNumber(zone.min) || !isFiniteNumber(zone.max)) {
    return '';
  }

  const y1 = priceToY(zone.max, context);
  const y2 = priceToY(zone.min, context);

  if (!isFiniteNumber(y1) || !isFiniteNumber(y2)) {
    return '';
  }

  const top = clamp(Math.min(y1, y2), 0, context.height);
  const height = clamp(Math.abs(y2 - y1), 0, context.height);

  if (height < 2) {
    return '';
  }

  const labelY = clamp(top + 22, 24, context.height - 12);
  const reason = zone.reason ? ` • ${zone.reason}` : '';
  const labelText = escapeXml(`${label}${reason}`);

  return `
    <rect x="0" y="${top}" width="${context.width}" height="${height}" fill="${color}33" stroke="${color}" stroke-width="2" rx="2" />
    <rect x="14" y="${labelY - 18}" width="220" height="24" fill="rgba(10,14,23,0.82)" rx="6" />
    <text x="24" y="${labelY}" fill="${color}" font-size="14" font-family="Arial, sans-serif" font-weight="700">${labelText}</text>
  `;
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
  const safeY = clamp(y, 8, context.height - 8);
  const labelY = clamp(safeY - 10, 18, context.height - 16);

  return `
    <line x1="0" y1="${safeY}" x2="${context.width}" y2="${safeY}" stroke="${color}" stroke-width="2" stroke-dasharray="10 8" />
    <rect x="14" y="${labelY - 18}" width="230" height="24" fill="rgba(10,14,23,0.86)" rx="6" />
    <text x="24" y="${labelY}" fill="${color}" font-size="14" font-family="Arial, sans-serif" font-weight="700">${escapeXml(label)}</text>
  `;
};

const buildOverlay = (context: DrawContext, analysis: MarkupAnalysis) => {
  const fragments = [
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