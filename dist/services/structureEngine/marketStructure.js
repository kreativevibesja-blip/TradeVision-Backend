"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveMarketStructure = deriveMarketStructure;
const volatilityDetector_1 = require("../../utils/volatilityDetector");
const getLatestZone = (zones, type) => zones.find((zone) => zone.type === type);
const hasHigherHighs = (highs) => highs.length >= 2 && highs[highs.length - 1] > highs[0];
const hasHigherLows = (lows) => lows.length >= 2 && lows[lows.length - 1] >= lows[0];
const hasLowerHighs = (highs) => highs.length >= 2 && highs[highs.length - 1] < highs[0];
const hasLowerLows = (lows) => lows.length >= 2 && lows[lows.length - 1] <= lows[0];
function deriveMarketStructure(chartVision, pair) {
    const highs = chartVision.recentSwings.filter((swing) => swing.type === 'high').map((swing) => swing.price);
    const lows = chartVision.recentSwings.filter((swing) => swing.type === 'low').map((swing) => swing.price);
    const demandZone = getLatestZone(chartVision.detectedZones, 'demand');
    const supplyZone = getLatestZone(chartVision.detectedZones, 'supply');
    const higherHighs = hasHigherHighs(highs);
    const higherLows = hasHigherLows(lows);
    const lowerHighs = hasLowerHighs(highs);
    const lowerLows = hasLowerLows(lows);
    let marketBias = 'neutral';
    let structure = 'balanced range';
    const bos = [];
    const choch = [];
    const liquiditySweeps = [];
    const fairValueGaps = [];
    if (chartVision.trend === 'bullish' && higherHighs && higherLows) {
        marketBias = 'bullish';
        structure = 'higher highs and higher lows';
        bos.push(`Bullish BOS above ${chartVision.recentHigh}`);
    }
    else if (chartVision.trend === 'bearish' && lowerHighs && lowerLows) {
        marketBias = 'bearish';
        structure = 'lower highs and lower lows';
        bos.push(`Bearish BOS below ${chartVision.recentLow}`);
    }
    else if (chartVision.range === 'compression') {
        structure = 'compressed range';
    }
    if (marketBias === 'bullish' && supplyZone) {
        liquiditySweeps.push(`Buy-side liquidity resting above ${supplyZone.priceEnd}`);
    }
    if (marketBias === 'bearish' && demandZone) {
        liquiditySweeps.push(`Sell-side liquidity resting below ${demandZone.priceStart}`);
    }
    if (chartVision.range === 'expansion') {
        fairValueGaps.push(marketBias === 'bearish'
            ? `Bearish imbalance likely between ${(0, volatilityDetector_1.roundPrice)(chartVision.recentHigh - (chartVision.recentHigh - chartVision.recentLow) * 0.22, pair)} and ${(0, volatilityDetector_1.roundPrice)(chartVision.recentHigh - (chartVision.recentHigh - chartVision.recentLow) * 0.12, pair)}`
            : `Bullish imbalance likely between ${(0, volatilityDetector_1.roundPrice)(chartVision.recentLow + (chartVision.recentHigh - chartVision.recentLow) * 0.12, pair)} and ${(0, volatilityDetector_1.roundPrice)(chartVision.recentLow + (chartVision.recentHigh - chartVision.recentLow) * 0.22, pair)}`);
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
    const defaultEntry = marketBias === 'bearish'
        ? [
            supplyZone?.priceStart ?? (0, volatilityDetector_1.roundPrice)(chartVision.recentHigh - (chartVision.recentHigh - chartVision.recentLow) * 0.22, pair),
            supplyZone?.priceEnd ?? (0, volatilityDetector_1.roundPrice)(chartVision.recentHigh - (chartVision.recentHigh - chartVision.recentLow) * 0.12, pair),
        ]
        : [
            demandZone?.priceStart ?? (0, volatilityDetector_1.roundPrice)(chartVision.recentLow + (chartVision.recentHigh - chartVision.recentLow) * 0.12, pair),
            demandZone?.priceEnd ?? (0, volatilityDetector_1.roundPrice)(chartVision.recentLow + (chartVision.recentHigh - chartVision.recentLow) * 0.22, pair),
        ];
    const tradeSetup = {
        type: chartVision.range === 'compression' ? 'range' : marketBias === 'neutral' ? 'range' : 'pullback',
        entryZone: defaultEntry[0] <= defaultEntry[1] ? defaultEntry : [defaultEntry[1], defaultEntry[0]],
        stopLoss: marketBias === 'bearish'
            ? (0, volatilityDetector_1.roundPrice)(chartVision.recentHigh + (chartVision.recentHigh - chartVision.recentLow) * 0.08, pair)
            : (0, volatilityDetector_1.roundPrice)(chartVision.recentLow - (chartVision.recentHigh - chartVision.recentLow) * 0.08, pair),
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
//# sourceMappingURL=marketStructure.js.map