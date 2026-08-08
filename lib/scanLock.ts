/** Calendar-day helpers for once-per-day scan lock (ANALYSIS_TZ). */

const DEFAULT_TZ = "Africa/Lagos";

function getTz(): string {
  return process.env.ANALYSIS_TZ?.trim() || DEFAULT_TZ;
}

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

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 5; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second
    );
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

/** Midnight (00:00) of the current calendar day in ANALYSIS_TZ. */
export function currentCalendarDayStart(now = new Date()): Date {
  const tz = getTz();
  const p = zonedParts(now, tz);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, tz);
}

/** Next midnight in ANALYSIS_TZ (when a new scan day unlocks). */
export function nextCalendarDayStart(now = new Date()): Date {
  const tz = getTz();
  const p = zonedParts(now, tz);
  const n = addCalendarDays(p.year, p.month, p.day, 1);
  return zonedTimeToUtc(n.year, n.month, n.day, 0, 0, 0, tz);
}

export {
  analysisWindowLabel,
  currentAnalysisWindowStart,
  nextAnalysisUnlock,
  getAnalysisTz,
  getAnalysisStartHour,
} from "./analysisWindow";
