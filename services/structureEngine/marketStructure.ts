import type { ChartVisionOutput, DetectedZone } from '../imageProcessing/chartVision';
import { roundPrice } from '../../utils/volatilityDetector';

export interface TradeSetup {
  type: 'pullback' | 'breakout' | 'reversal' | 'range';
  entryZone: [number, number];
  stopLoss: number;
}

export interface MarketStructureOutput {
  marketBias: 'bullish' | 'bearish' | 'neutral';
  structure: string;
  liquidity: string;
  keyLevels: number[];
  tradeSetup: TradeSetup;
  volatilityRegime: string;
  smcSignals: {
    bos: string[];
    choch: string[];
    liquiditySweeps: string[];
    fairValueGaps: string[];
    supplyDemandZones: DetectedZone[];
  };
}

const getLatestZone = (zones: DetectedZone[], type: DetectedZone['type']) => zones.find((zone) => zone.type === type);
const hasHigherHighs = (highs: number[]) => highs.length >= 2 && highs[highs.length - 1] > highs[0];
const hasHigherLows = (lows: number[]) => lows.length >= 2 && lows[lows.length - 1] >= lows[0];
const hasLowerHighs = (highs: number[]) => highs.length >= 2 && highs[highs.length - 1] < highs[0];
const hasLowerLows = (lows: number[]) => lows.length >= 2 && lows[lows.length - 1] <= lows[0];

export function deriveMarketStructure(chartVision: ChartVisionOutput, pair: string): MarketStructureOutput {
  const highs = chartVision.recentSwings.filter((swing) => swing.type === 'high').map((swing) => swing.price);
  const lows = chartVision.recentSwings.filter((swing) => swing.type === 'low').map((swing) => swing.price);
  const demandZone = getLatestZone(chartVision.detectedZones, 'demand');
  const supplyZone = getLatestZone(chartVision.detectedZones, 'supply');
  const higherHighs = hasHigherHighs(highs);
  const higherLows = hasHigherLows(lows);
  const lowerHighs = hasLowerHighs(highs);
  const lowerLows = hasLowerLows(lows);

  let marketBias: MarketStructureOutput['marketBias'] = 'neutral';
  let structure = 'balanced range';
  const bos: string[] = [];
  const choch: string[] = [];
  const liquiditySweeps: string[] = [];
  const fairValueGaps: string[] = [];

  if (chartVision.trend === 'bullish' && higherHighs && higherLows) {
    marketBias = 'bullish';
    structure = 'higher highs and higher lows';
    bos.push(`Bullish BOS above ${chartVision.recentHigh}`);
  } else if (chartVision.trend === 'bearish' && lowerHighs && lowerLows) {
    marketBias = 'bearish';
    structure = 'lower highs and lower lows';
    bos.push(`Bearish BOS below ${chartVision.recentLow}`);
  } else if (chartVision.range === 'compression') {
    structure = 'compressed range';
  }

  if (marketBias === 'bullish' && supplyZone) {
    liquiditySweeps.push(`Buy-side liquidity resting above ${supplyZone.priceEnd}`);
  }

  if (marketBias === 'bearish' && demandZone) {
    liquiditySweeps.push(`Sell-side liquidity resting below ${demandZone.priceStart}`);
  }

  if (chartVision.range === 'expansion') {
    fairValueGaps.push(
      marketBias === 'bearish'
        ? `Bearish imbalance likely between ${roundPrice(chartVision.recentHigh - (chartVision.recentHigh - chartVision.recentLow) * 0.22, pair)} and ${roundPrice(chartVision.recentHigh - (chartVision.recentHigh - chartVision.recentLow) * 0.12, pair)}`
        : `Bullish imbalance likely between ${roundPrice(chartVision.recentLow + (chartVision.recentHigh - chartVision.recentLow) * 0.12, pair)} and ${roundPrice(chartVision.recentLow + (chartVision.recentHigh - chartVision.recentLow) * 0.22, pair)}`
    );
  }

  if (marketBias === 'bullish' && lowerHighs) {
    choch.push('Short-term CHoCH would occur if price breaks back below the latest higher low.');
  }

  if (marketBias === 'bearish' && higherLows) {
    choch.push('Short-term CHoCH would occur if price reclaims the latest lower high.');
  }

  const keyLevels = [
    chartVision.recentLow,
    ...(demandZone ? [demandZone.priceStart, demandZone.priceEnd] : []),
    ...(supplyZone ? [supplyZone.priceStart, supplyZone.priceEnd] : []),
    chartVision.recentHigh,
  ].filter((value, index, array) => array.indexOf(value) === index);

  const defaultEntry: [number, number] = marketBias === 'bearish'
    ? [
        supplyZone?.priceStart ?? roundPrice(chartVision.recentHigh - (chartVision.recentHigh - chartVision.recentLow) * 0.22, pair),
        supplyZone?.priceEnd ?? roundPrice(chartVision.recentHigh - (chartVision.recentHigh - chartVision.recentLow) * 0.12, pair),
      ]
    : [
        demandZone?.priceStart ?? roundPrice(chartVision.recentLow + (chartVision.recentHigh - chartVision.recentLow) * 0.12, pair),
        demandZone?.priceEnd ?? roundPrice(chartVision.recentLow + (chartVision.recentHigh - chartVision.recentLow) * 0.22, pair),
      ];

  const tradeSetup: TradeSetup = {
    type: chartVision.range === 'compression' ? 'range' : marketBias === 'neutral' ? 'range' : 'pullback',
    entryZone: defaultEntry[0] <= defaultEntry[1] ? defaultEntry : [defaultEntry[1], defaultEntry[0]],
    stopLoss:
      marketBias === 'bearish'
        ? roundPrice(chartVision.recentHigh + (chartVision.recentHigh - chartVision.recentLow) * 0.08, pair)
        : roundPrice(chartVision.recentLow - (chartVision.recentHigh - chartVision.recentLow) * 0.08, pair),
  };

  const liquidity = marketBias === 'bullish'
    ? `above recent high ${chartVision.recentHigh}`
    : marketBias === 'bearish'
      ? `below recent low ${chartVision.recentLow}`
      : 'balanced around mid-range liquidity';

  return {
    marketBias,
    structure,
    liquidity,
    keyLevels,
    tradeSetup,
    volatilityRegime: chartVision.volatility,
    smcSignals: {
      bos,
      choch,
      liquiditySweeps,
      fairValueGaps,
      supplyDemandZones: chartVision.detectedZones,
    },
  };
}