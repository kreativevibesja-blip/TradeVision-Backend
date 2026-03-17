"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyVolatility = exports.roundPrice = exports.getPricePrecision = exports.getPairTemplate = exports.inferAssetClass = exports.inferSyntheticProfile = void 0;
const containsAny = (value, needles) => needles.some((needle) => value.includes(needle));
const inferSyntheticProfile = (pair) => {
    const normalized = pair.toLowerCase();
    if (normalized.includes('boom'))
        return 'Boom';
    if (normalized.includes('crash'))
        return 'Crash';
    if (normalized.includes('jump'))
        return 'Jump';
    if (normalized.includes('step'))
        return 'Step';
    if (normalized.includes('volatility') || normalized.includes('vix'))
        return 'VIX';
    return 'Standard';
};
exports.inferSyntheticProfile = inferSyntheticProfile;
const inferAssetClass = (pair) => {
    const normalized = pair.toLowerCase();
    if (containsAny(normalized, ['boom', 'crash', 'step', 'jump', 'volatility', 'vix'])) {
        return 'synthetic';
    }
    if (containsAny(normalized, ['btc', 'eth', 'sol', 'xrp', 'crypto'])) {
        return 'crypto';
    }
    if (containsAny(normalized, ['us30', 'nas100', 'spx500', 'ger40', 'uk100', 'dj30'])) {
        return 'indices';
    }
    return 'forex';
};
exports.inferAssetClass = inferAssetClass;
const getPairTemplate = (pair) => {
    const normalized = pair.toUpperCase();
    const assetClass = (0, exports.inferAssetClass)(pair);
    const syntheticProfile = (0, exports.inferSyntheticProfile)(pair);
    if (normalized.includes('BTC')) {
        return { assetClass: 'crypto', referencePrice: 65000, amplitude: 4000, precision: 0, syntheticProfile };
    }
    if (normalized.includes('ETH')) {
        return { assetClass: 'crypto', referencePrice: 3200, amplitude: 300, precision: 1, syntheticProfile };
    }
    if (normalized.includes('XAU')) {
        return { assetClass: 'forex', referencePrice: 2150, amplitude: 35, precision: 1, syntheticProfile };
    }
    if (normalized.includes('JPY')) {
        return { assetClass, referencePrice: 150, amplitude: 1.8, precision: 3, syntheticProfile };
    }
    if (normalized.includes('US30')) {
        return { assetClass: 'indices', referencePrice: 39000, amplitude: 450, precision: 0, syntheticProfile };
    }
    if (normalized.includes('NAS100')) {
        return { assetClass: 'indices', referencePrice: 18200, amplitude: 260, precision: 0, syntheticProfile };
    }
    if (normalized.includes('SPX500')) {
        return { assetClass: 'indices', referencePrice: 5200, amplitude: 75, precision: 0, syntheticProfile };
    }
    if (assetClass === 'synthetic') {
        return { assetClass, referencePrice: 1000, amplitude: 120, precision: 2, syntheticProfile };
    }
    return { assetClass, referencePrice: 1.085, amplitude: 0.01, precision: 4, syntheticProfile };
};
exports.getPairTemplate = getPairTemplate;
const getPricePrecision = (pair) => (0, exports.getPairTemplate)(pair).precision;
exports.getPricePrecision = getPricePrecision;
const roundPrice = (value, pair) => {
    const precision = (0, exports.getPricePrecision)(pair);
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
};
exports.roundPrice = roundPrice;
const classifyVolatility = ({ pair, priceSpan, activityScore, rangeState }) => {
    const template = (0, exports.getPairTemplate)(pair);
    const normalizedSpan = template.amplitude > 0 ? priceSpan / template.amplitude : priceSpan;
    const combinedScore = normalizedSpan * 0.65 + activityScore * 0.35;
    if (template.syntheticProfile === 'Boom' || template.syntheticProfile === 'Crash') {
        if (combinedScore > 0.95 || rangeState === 'expansion')
            return 'extreme';
        if (combinedScore > 0.65)
            return 'high';
        return 'medium';
    }
    if (template.syntheticProfile === 'VIX' || template.syntheticProfile === 'Jump') {
        if (combinedScore > 0.85)
            return 'extreme';
        if (combinedScore > 0.55)
            return 'high';
        if (combinedScore > 0.3)
            return 'medium';
        return 'low';
    }
    if (combinedScore > 0.8)
        return 'extreme';
    if (combinedScore > 0.5)
        return 'high';
    if (combinedScore > 0.22)
        return 'medium';
    return 'low';
};
exports.classifyVolatility = classifyVolatility;
//# sourceMappingURL=volatilityDetector.js.map