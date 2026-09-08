/**
 * Freshness gates for persisted claim evidence. Pure and deterministic when `now`
 * is supplied; never performs I/O or converts invalid inputs into healthy defaults.
 */
export const DEFAULT_PERSISTENCE_STALE_MINUTES = 180;
export const MAX_PERSISTENCE_CLOCK_SKEW_MS = 60_000;

function thresholdMinutes(value) {
  // An absent setting has a default. A present but malformed setting is an error.
  if (value === undefined) return DEFAULT_PERSISTENCE_STALE_MINUTES;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 30 && number <= 1440
    ? number : null;
}

function timestampMilliseconds(value) {
  if (typeof value !== 'string') return null;
  // Require an explicit zone. Accept PostgreSQL's microsecond precision and
  // numeric offsets, but reject dates JavaScript would silently normalise.
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, , zone] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
      || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  if (zone.toUpperCase() !== 'Z'
      && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  const milliseconds = Date.parse(text.replace(' ', 'T').replace(/z$/i, 'Z'));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

/**
 * @param {{ingestedAt?: unknown, staleAfterMinutes?: unknown, now?: number}} input
 * @returns {{configValid: boolean, clockValid: boolean, timestampValid: boolean,
 *   timestampNotFuture: boolean, stale: boolean, graphAgeMinutes: number|null,
 *   staleAfterMinutes: number|null, reason: string, clockSkewToleranceSeconds: number}}
 */
export function evaluatePersistenceFreshness({ ingestedAt, staleAfterMinutes, now = Date.now() } = {}) {
  const threshold = thresholdMinutes(staleAfterMinutes);
  const timestamp = timestampMilliseconds(ingestedAt);
  const configValid = threshold !== null;
  const clockValid = typeof now === 'number' && Number.isFinite(now);
  const timestampValid = timestamp !== null;
  const ageMs = timestampValid && clockValid ? now - timestamp : null;
  const timestampNotFuture = ageMs !== null && ageMs >= -MAX_PERSISTENCE_CLOCK_SKEW_MS;
  // The gate uses exact milliseconds. Rounded display age must never create a
  // grace period beyond the configured freshness limit.
  const stale = !configValid || !clockValid || !timestampValid
    || !timestampNotFuture || ageMs > threshold * 60_000;
  const reason = !configValid ? 'invalid_freshness_configuration'
    : !clockValid ? 'invalid_clock'
      : !timestampValid ? 'invalid_ingestion_timestamp'
        : !timestampNotFuture ? 'timestamp_in_future'
          : stale ? 'stale' : 'fresh';
  return {
    configValid,
    clockValid,
    timestampValid,
    timestampNotFuture,
    stale,
    graphAgeMinutes: ageMs === null ? null : Math.max(0, Math.floor(ageMs / 60_000)),
    staleAfterMinutes: threshold,
    reason,
    clockSkewToleranceSeconds: MAX_PERSISTENCE_CLOCK_SKEW_MS / 1000
  };
}
