export type AssetClass = 'forex' | 'crypto' | 'indices' | 'synthetic';
export type SyntheticProfile = 'VIX' | 'Boom' | 'Crash' | 'Jump' | 'Step' | 'Standard';
export type VolatilityClassification = 'low' | 'medium' | 'high' | 'extreme';
type PairTemplate = {
    assetClass: AssetClass;
    referencePrice: number;
    amplitude: number;
    precision: number;
    syntheticProfile: SyntheticProfile;
};
export declare const inferSyntheticProfile: (pair: string) => SyntheticProfile;
export declare const inferAssetClass: (pair: string) => AssetClass;
export declare const getPairTemplate: (pair: string) => PairTemplate;
export declare const getPricePrecision: (pair: string) => number;
export declare const roundPrice: (value: number, pair: string) => number;
type VolatilityInput = {
    pair: string;
    priceSpan: number;
    activityScore: number;
    rangeState?: 'compression' | 'balanced' | 'expansion';
};
export declare const classifyVolatility: ({ pair, priceSpan, activityScore, rangeState }: VolatilityInput) => VolatilityClassification;
export {};
//# sourceMappingURL=volatilityDetector.d.ts.map