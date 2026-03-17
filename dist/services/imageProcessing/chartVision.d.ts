import { type AssetClass, type VolatilityClassification } from '../../utils/volatilityDetector';
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
export declare function analyzeChartVision(filePath: string, pair: string): Promise<ChartVisionOutput>;
//# sourceMappingURL=chartVision.d.ts.map