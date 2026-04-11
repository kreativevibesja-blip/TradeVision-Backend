import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { supabase } from '../lib/supabase';
import { config } from '../config';

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

interface SnapshotInput {
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number | null;
  candles: Candle[];
}

// ── Chart constants ──

const WIDTH = 800;
const HEIGHT = 420;
const PADDING_LEFT = 72;
const PADDING_RIGHT = 16;
const PADDING_TOP = 24;
const PADDING_BOTTOM = 32;
const CHART_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const CHART_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

const BG_COLOR = '#0f1729';
const GRID_COLOR = '#1e293b';
const TEXT_COLOR = '#94a3b8';
const BULL_COLOR = '#22c55e';
const BEAR_COLOR = '#ef4444';
const ENTRY_COLOR = '#3b82f6';
const SL_COLOR = '#ef4444';
const TP_COLOR = '#22c55e';

const VISIBLE_CANDLES = 80;
const CANDLE_GAP = 1;

// ── Helpers ──

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPrice(price: number) {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 10) return price.toFixed(3);
  return price.toFixed(5);
}

/** Create an SVG chart image with candles + trade levels drawn on it. */
function renderChartSvg(input: SnapshotInput): string {
  const { candles: rawCandles, direction, entry, stopLoss, takeProfit, takeProfit2, symbol } = input;

  // Take the last N candles for display
  const candles = rawCandles.slice(-VISIBLE_CANDLES);
  if (candles.length < 5) {
    throw new Error('Not enough candles for snapshot');
  }

  // Compute price range including trade levels
  const allPrices = [
    ...candles.flatMap((c) => [c.high, c.low]),
    entry,
    stopLoss,
    takeProfit,
    ...(takeProfit2 != null ? [takeProfit2] : []),
  ];
  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const pricePadding = (rawMax - rawMin) * 0.06;
  const priceMin = rawMin - pricePadding;
  const priceMax = rawMax + pricePadding;
  const priceRange = priceMax - priceMin;

  const priceToY = (price: number) =>
    PADDING_TOP + CHART_HEIGHT - ((price - priceMin) / priceRange) * CHART_HEIGHT;

  const candleSlotWidth = CHART_WIDTH / candles.length;
  const candleBodyWidth = Math.max(1, candleSlotWidth - CANDLE_GAP * 2);

  // Start building SVG
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
  );

  // Background
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${BG_COLOR}" rx="8"/>`);

  // Grid lines (5 horizontal)
  for (let i = 0; i <= 4; i++) {
    const y = PADDING_TOP + (CHART_HEIGHT / 4) * i;
    const price = priceMax - (priceRange / 4) * i;
    parts.push(`<line x1="${PADDING_LEFT}" y1="${y}" x2="${WIDTH - PADDING_RIGHT}" y2="${y}" stroke="${GRID_COLOR}" stroke-width="0.5"/>`);
    parts.push(`<text x="${PADDING_LEFT - 6}" y="${y + 4}" fill="${TEXT_COLOR}" font-size="10" font-family="monospace" text-anchor="end">${formatPrice(price)}</text>`);
  }

  // Candles
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const x = PADDING_LEFT + i * candleSlotWidth + candleSlotWidth / 2;
    const isBull = c.close >= c.open;
    const color = isBull ? BULL_COLOR : BEAR_COLOR;

    // Wick
    const wickTop = priceToY(c.high);
    const wickBot = priceToY(c.low);
    parts.push(`<line x1="${x}" y1="${wickTop}" x2="${x}" y2="${wickBot}" stroke="${color}" stroke-width="1"/>`);

    // Body
    const bodyTop = priceToY(Math.max(c.open, c.close));
    const bodyBot = priceToY(Math.min(c.open, c.close));
    const bodyHeight = Math.max(1, bodyBot - bodyTop);
    const bx = x - candleBodyWidth / 2;
    parts.push(`<rect x="${bx}" y="${bodyTop}" width="${candleBodyWidth}" height="${bodyHeight}" fill="${color}" rx="0.5"/>`);
  }

  // ── Trade level overlays ──

  const drawLevel = (price: number, color: string, label: string, dashed: boolean) => {
    const y = priceToY(price);
    const dash = dashed ? ' stroke-dasharray="6,4"' : '';
    parts.push(`<line x1="${PADDING_LEFT}" y1="${y}" x2="${WIDTH - PADDING_RIGHT}" y2="${y}" stroke="${color}" stroke-width="1.5"${dash} opacity="0.85"/>`);
    // Label background
    const textWidth = label.length * 7 + 12;
    parts.push(`<rect x="${PADDING_LEFT + 4}" y="${y - 17}" width="${textWidth}" height="16" fill="${color}" rx="3" opacity="0.9"/>`);
    parts.push(`<text x="${PADDING_LEFT + 10}" y="${y - 5}" fill="white" font-size="10" font-weight="bold" font-family="sans-serif">${escapeXml(label)}</text>`);
    // Price label on right
    parts.push(`<text x="${WIDTH - PADDING_RIGHT - 2}" y="${y - 4}" fill="${color}" font-size="9" font-family="monospace" text-anchor="end">${formatPrice(price)}</text>`);
  };

  // SL zone (shaded)
  const slY = priceToY(stopLoss);
  const entryY = priceToY(entry);
  const slZoneTop = Math.min(slY, entryY);
  const slZoneHeight = Math.abs(slY - entryY);
  parts.push(`<rect x="${PADDING_LEFT}" y="${slZoneTop}" width="${CHART_WIDTH}" height="${slZoneHeight}" fill="${SL_COLOR}" opacity="0.08"/>`);

  // TP zone (shaded)
  const tpY = priceToY(takeProfit);
  const tpZoneTop = Math.min(tpY, entryY);
  const tpZoneHeight = Math.abs(tpY - entryY);
  parts.push(`<rect x="${PADDING_LEFT}" y="${tpZoneTop}" width="${CHART_WIDTH}" height="${tpZoneHeight}" fill="${TP_COLOR}" opacity="0.08"/>`);

  // TP2 zone (lighter)
  if (takeProfit2 != null) {
    const tp2Y = priceToY(takeProfit2);
    const tp2ZoneTop = Math.min(tp2Y, tpY);
    const tp2ZoneHeight = Math.abs(tp2Y - tpY);
    parts.push(`<rect x="${PADDING_LEFT}" y="${tp2ZoneTop}" width="${CHART_WIDTH}" height="${tp2ZoneHeight}" fill="${TP_COLOR}" opacity="0.04"/>`);
  }

  // Draw level lines
  drawLevel(entry, ENTRY_COLOR, 'ENTRY', false);
  drawLevel(stopLoss, SL_COLOR, 'SL', true);
  drawLevel(takeProfit, TP_COLOR, 'TP', false);
  if (takeProfit2 != null) {
    drawLevel(takeProfit2, TP_COLOR, 'TP2', true);
  }

  // Symbol + direction badge top-left
  const dirColor = direction === 'buy' ? BULL_COLOR : BEAR_COLOR;
  parts.push(`<text x="${PADDING_LEFT + 4}" y="16" fill="${TEXT_COLOR}" font-size="12" font-family="sans-serif" font-weight="bold">${escapeXml(symbol)}</text>`);
  const badgeX = PADDING_LEFT + 4 + symbol.length * 8 + 8;
  parts.push(`<rect x="${badgeX}" y="5" width="${direction.length * 8 + 10}" height="16" fill="${dirColor}" rx="3" opacity="0.85"/>`);
  parts.push(`<text x="${badgeX + 5}" y="16" fill="white" font-size="10" font-weight="bold" font-family="sans-serif">${direction.toUpperCase()}</text>`);

  parts.push('</svg>');
  return parts.join('');
}

/** Generate a PNG snapshot of the trade chart and upload it to Supabase storage. */
export async function generateAndUploadSnapshot(
  scanResultId: string,
  input: SnapshotInput,
): Promise<string | null> {
  try {
    const svg = renderChartSvg(input);
    const pngBuffer = await sharp(Buffer.from(svg)).png({ quality: 85 }).toBuffer();

    const bucket = config.supabase.storageBucket;
    if (!bucket) return null;

    const objectPath = `snapshots/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.png`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, pngBuffer, {
      contentType: 'image/png',
      upsert: false,
    });

    if (uploadError) {
      console.error('[Snapshot] Upload failed:', uploadError);
      return null;
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    const snapshotUrl = data.publicUrl;

    // Persist URL on the scan result
    const { error: updateError } = await supabase
      .from('ScanResult')
      .update({ snapshotUrl })
      .eq('id', scanResultId);

    if (updateError) {
      console.error('[Snapshot] DB update failed:', updateError);
    }

    return snapshotUrl;
  } catch (err) {
    console.error('[Snapshot] Generation failed:', err);
    return null;
  }
}
