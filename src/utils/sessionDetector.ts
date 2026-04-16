export type DetectedSession = 'london_killzone' | 'newyork_killzone' | 'high_volatility' | 'low_activity';

function getEasternHour(now: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  });

  return Number(formatter.format(now));
}

export function getSession(now: Date = new Date()): DetectedSession {
  const hour = getEasternHour(now);

  if (hour >= 2 && hour < 5) return 'london_killzone';
  if (hour >= 8 && hour < 11) return 'newyork_killzone';
  if (hour >= 2 && hour < 17) return 'high_volatility';
  return 'low_activity';
}
