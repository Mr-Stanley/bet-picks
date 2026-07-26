/**
 * Analysis day window: a new run is allowed once per day starting at 09:00
 * in ANALYSIS_TZ (default Africa/Lagos, UTC+1 year-round).
 */

const DEFAULT_TZ = "Africa/Lagos";
const DEFAULT_HOUR = 9;

export function getAnalysisTz(): string {
  return process.env.ANALYSIS_TZ?.trim() || DEFAULT_TZ;
}

export function getAnalysisStartHour(): number {
  const n = Number(process.env.ANALYSIS_DAY_START_HOUR ?? DEFAULT_HOUR);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? Math.floor(n) : DEFAULT_HOUR;
}

/** Format parts in a timezone via Intl. */
function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Convert a calendar date + wall time in `timeZone` to a UTC Date.
 * Uses a short binary search against Intl (no extra deps).
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  // Initial guess: treat as UTC
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 5; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * Start of the current analysis window (most recent 09:00 in ANALYSIS_TZ).
 * Before 09:00, that is yesterday's 09:00.
 */
export function currentAnalysisWindowStart(now = new Date()): Date {
  const tz = getAnalysisTz();
  const startHour = getAnalysisStartHour();
  const p = zonedParts(now, tz);

  let y = p.year;
  let m = p.month;
  let d = p.day;
  if (p.hour < startHour) {
    ({ year: y, month: m, day: d } = addCalendarDays(y, m, d, -1));
  }

  return zonedTimeToUtc(y, m, d, startHour, 0, 0, tz);
}

/** Next time a new run unlocks (next 09:00 in ANALYSIS_TZ). */
export function nextAnalysisUnlock(now = new Date()): Date {
  const tz = getAnalysisTz();
  const startHour = getAnalysisStartHour();
  const p = zonedParts(now, tz);

  let y = p.year;
  let m = p.month;
  let d = p.day;
  if (p.hour >= startHour) {
    ({ year: y, month: m, day: d } = addCalendarDays(y, m, d, 1));
  }

  return zonedTimeToUtc(y, m, d, startHour, 0, 0, tz);
}

export function analysisWindowLabel(): string {
  const hour = getAnalysisStartHour();
  const tz = getAnalysisTz();
  return `${String(hour).padStart(2, "0")}:00 (${tz})`;
}
