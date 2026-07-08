import type { TradingAnalysis } from '../validators/tradingAnalysisValidator';

export type InternalPlaybook =
  | 'liquidity_sweep_reversal'
  | 'trend_continuation'
  | 'breakout_retest'
  | 'range_reversal'
  | 'pullback_continuation'
  | 'no_trade';

export const classifySetup = (analysis: TradingAnalysis): InternalPlaybook => {
  if (analysis.setupType === 'no_trade' || analysis.entryReadiness === 'no_trade' || analysis.direction === 'none') {
    return 'no_trade';
  }

  const levelText = analysis.keyLevels.map((level) => `${level.type} ${level.description}`).join(' ').toLowerCase();
  const summaryText = `${analysis.summary} ${analysis.whatToWaitFor} ${levelText}`.toLowerCase();

  if (summaryText.includes('sweep') || summaryText.includes('liquidity grab') || summaryText.includes('stop run')) {
    return 'liquidity_sweep_reversal';
  }

  if (analysis.setupType === 'breakout') {
    return summaryText.includes('retest') ? 'breakout_retest' : 'trend_continuation';
  }

  if (analysis.setupType === 'pullback') {
    return 'pullback_continuation';
  }

  if (analysis.setupType === 'range') {
    return 'range_reversal';
  }

  if (analysis.setupType === 'reversal') {
    return summaryText.includes('range') ? 'range_reversal' : 'liquidity_sweep_reversal';
  }

  return 'trend_continuation';
};
