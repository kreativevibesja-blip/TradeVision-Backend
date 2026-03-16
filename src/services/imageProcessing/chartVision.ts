import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  classifyVolatility,
  getPairTemplate,
  inferAssetClass,
  roundPrice,
  type AssetClass,
  type VolatilityClassification,
} from '../../utils/volatilityDetector';

export type ZoneType = 'demand' | 'supply' | 'support' | 'resistance';

export interface DetectedZone {
  type: ZoneType;
  priceStart: number;
  priceEnd: number;
}

export interface SwingPoint {
  type: 'high' | 'low';
  price: number;
  strength: number;
}

export interface ChartVisionOutput {
  trend: 'bullish' | 'bearish' | 'sideways';
  recentHigh: number;
  recentLow: number;
  range: 'compression' | 'balanced' | 'expansion';
  detectedZones: DetectedZone[];
  volatility: VolatilityClassification;
  candlePatterns: string[];
  supportLevels: number[];
  resistanceLevels: number[];
  recentSwings: SwingPoint[];
  trendStrength: number;
  assetClass: AssetClass;
  normalizedImageUrl: string;
  edgeImageUrl: string;
  imageStats: {
    width: number;
    height: number;
    brightness: number;
    contrast: number;
    activityScore: number;
  };
}

const EDGE_KERNEL = {
  width: 3,
  height: 3,
  kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildOutputPaths = (filePath: string) => {
  const parsed = path.parse(filePath);
  return {
    normalizedPath: path.join(parsed.dir, `${parsed.name}_normalized.png`),
    edgePath: path.join(parsed.dir, `${parsed.name}_edges.png`),
  };
};

const toPrice = (y: number, pair: string) => {
  const template = getPairTemplate(pair);
  const normalized = 1 - y;
  return roundPrice(template.referencePrice + (normalized - 0.5) * template.amplitude, pair);
};

const detectRangeState = (variance: number, edgeDensity: number): 'compression' | 'balanced' | 'expansion' => {
  if (variance > 0.06 || edgeDensity > 0.42) return 'expansion';
  if (variance < 0.022 && edgeDensity < 0.22) return 'compression';
  return 'balanced';
};

const detectTrend = (series: number[]): { trend: 'bullish' | 'bearish' | 'sideways'; strength: number } => {
  if (series.length < 8) {
    return { trend: 'sideways', strength: 0.2 };
  }

  const window = Math.max(3, Math.floor(series.length * 0.15));
  const first = series.slice(0, window).reduce((sum, value) => sum + value, 0) / window;
  const last = series.slice(-window).reduce((sum, value) => sum + value, 0) / window;
  const slope = first - last;
  const strength = clamp(Math.abs(slope) * 3.5, 0, 1);

  if (strength < 0.12) {
    return { trend: 'sideways', strength };
  }

  return {
    trend: slope > 0 ? 'bullish' : 'bearish',
    strength,
  };
};

const detectSwings = (series: number[], pair: string): SwingPoint[] => {
  const swings: SwingPoint[] = [];

  for (let index = 2; index < series.length - 2; index += 1) {
    const current = series[index];
    const prev = series[index - 1];
    const next = series[index + 1];
    const prev2 = series[index - 2];
    const next2 = series[index + 2];
    const localHigh = current > prev && current > next && current > prev2 && current > next2;
    const localLow = current < prev && current < next && current < prev2 && current < next2;

    if (localHigh || localLow) {
      const strength = Math.abs(((prev + next) / 2) - current);
      swings.push({
        type: localHigh ? 'high' : 'low',
        price: toPrice(current, pair),
        strength: Number(strength.toFixed(3)),
      });
    }
  }

  return swings.slice(-8);
};

const pickLevels = (swings: SwingPoint[], type: 'high' | 'low') =>
  swings
    .filter((swing) => swing.type === type)
    .map((swing) => swing.price)
    .slice(-3);

const detectPatterns = (rangeState: 'compression' | 'balanced' | 'expansion', trendStrength: number, edgeDensity: number) => {
  const patterns: string[] = [];

  if (rangeState === 'expansion') patterns.push('impulsive expansion candles');
  if (rangeState === 'compression') patterns.push('tight consolidation cluster');
  if (trendStrength > 0.5) patterns.push('trend continuation leg');
  if (edgeDensity > 0.35) patterns.push('high participation move');
  if (patterns.length === 0) patterns.push('balanced rotation candles');

  return patterns;
};

export async function analyzeChartVision(filePath: string, pair: string): Promise<ChartVisionOutput> {
  const { normalizedPath, edgePath } = buildOutputPaths(filePath);
  const template = getPairTemplate(pair);

  await fs.mkdir(path.dirname(normalizedPath), { recursive: true });

  const normalizedPipeline = sharp(filePath)
    .resize(1600, 900, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen();

  await normalizedPipeline.clone().png().toFile(normalizedPath);
  await normalizedPipeline.clone().convolve(EDGE_KERNEL).png().toFile(edgePath);

  const sampled = await normalizedPipeline
    .clone()
    .resize(96, 54, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const stats = await sharp(normalizedPath).stats();
  const width = sampled.info.width;
  const height = sampled.info.height;
  const pixels = sampled.data;
  const lineSeries: number[] = [];
  let edgeActivity = 0;

  for (let x = 0; x < width; x += 1) {
    let weightedY = 0;
    let intensitySum = 0;

    for (let y = 0; y < height; y += 1) {
      const pixel = pixels[y * width + x] / 255;
      const signal = 1 - pixel;
      weightedY += (y / (height - 1)) * signal;
      intensitySum += signal;
    }

    const center = intensitySum > 0.0001 ? weightedY / intensitySum : 0.5;
    lineSeries.push(center);
    edgeActivity += intensitySum / height;
  }

  const avgEdgeActivity = edgeActivity / width;
  const mean = lineSeries.reduce((sum, value) => sum + value, 0) / lineSeries.length;
  const variance = lineSeries.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lineSeries.length;
  const { trend, strength: trendStrength } = detectTrend(lineSeries);
  const recentSwings = detectSwings(lineSeries, pair);
  const mappedPrices = lineSeries.map((value) => toPrice(value, pair));
  const swingHighs = recentSwings.filter((swing) => swing.type === 'high').map((swing) => swing.price);
  const swingLows = recentSwings.filter((swing) => swing.type === 'low').map((swing) => swing.price);
  const recentHigh = roundPrice(Math.max(...mappedPrices, ...(swingHighs.length ? swingHighs : [template.referencePrice + template.amplitude * 0.2])), pair);
  const recentLow = roundPrice(Math.min(...mappedPrices, ...(swingLows.length ? swingLows : [template.referencePrice - template.amplitude * 0.2])), pair);
  const priceSpan = Math.abs(recentHigh - recentLow) || template.amplitude * 0.18;
  const rangeState = detectRangeState(variance, avgEdgeActivity);
  const volatility = classifyVolatility({
    pair,
    priceSpan,
    activityScore: avgEdgeActivity,
    rangeState,
  });

  const supportLevels = pickLevels(recentSwings, 'low');
  const resistanceLevels = pickLevels(recentSwings, 'high');

  const demandStart = roundPrice(recentLow + priceSpan * 0.08, pair);
  const demandEnd = roundPrice(recentLow + priceSpan * 0.16, pair);
  const supplyStart = roundPrice(recentHigh - priceSpan * 0.16, pair);
  const supplyEnd = roundPrice(recentHigh - priceSpan * 0.08, pair);

  return {
    trend,
    recentHigh,
    recentLow,
    range: rangeState,
    detectedZones: [
      { type: 'demand', priceStart: Math.min(demandStart, demandEnd), priceEnd: Math.max(demandStart, demandEnd) },
      { type: 'supply', priceStart: Math.min(supplyStart, supplyEnd), priceEnd: Math.max(supplyStart, supplyEnd) },
    ],
    volatility,
    candlePatterns: detectPatterns(rangeState, trendStrength, avgEdgeActivity),
    supportLevels,
    resistanceLevels,
    recentSwings,
    trendStrength: Number(trendStrength.toFixed(2)),
    assetClass: inferAssetClass(pair),
    normalizedImageUrl: `/uploads/${path.basename(normalizedPath)}`,
    edgeImageUrl: `/uploads/${path.basename(edgePath)}`,
    imageStats: {
      width,
      height,
      brightness: Number(((stats.channels[0]?.mean || 0) / 255).toFixed(3)),
      contrast: Number(((stats.channels[0]?.stdev || 0) / 255).toFixed(3)),
      activityScore: Number(avgEdgeActivity.toFixed(3)),
    },
  };
}