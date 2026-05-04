const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SEMESTER_TOTAL_WEEKS = 20;

export type AcademicWeekInfo = {
  weekNumber: number;
  weekLabel: string;
  weekStart: Date;
  weekEnd: Date;
  startDateLabel: string;
  endDateLabel: string;
};

export function startOfDay(value: Date | string | number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfWeekMonday(value: Date | string | number) {
  const date = startOfDay(value);
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return date;
}

export function formatDateOnly(value: Date | string | number) {
  const date = startOfDay(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDefaultSemesterStartDate(referenceDate = new Date()) {
  const reference = startOfDay(referenceDate);
  const year = reference.getFullYear();
  const month = reference.getMonth() + 1;

  if (month >= 8) {
    return new Date(year, 8, 1, 0, 0, 0, 0);
  }

  if (month >= 2) {
    return new Date(year, 1, 1, 0, 0, 0, 0);
  }

  return new Date(year - 1, 8, 1, 0, 0, 0, 0);
}

export function resolveSemesterStartDate(rawValue?: string | null, referenceDate = new Date()) {
  const normalized = String(rawValue || '').trim();
  if (!normalized) {
    return startOfWeekMonday(getDefaultSemesterStartDate(referenceDate));
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return startOfWeekMonday(getDefaultSemesterStartDate(referenceDate));
  }

  return startOfWeekMonday(parsed);
}

export function resolveSemesterTotalWeeks(rawValue?: number | string | null) {
  const parsed = Math.floor(Number(rawValue));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SEMESTER_TOTAL_WEEKS;
  }
  return parsed;
}

export function getAcademicWeekInfo(anchorDate: Date | string | number, semesterStartDate: Date) {
  const target = startOfDay(anchorDate);
  const semesterStart = startOfWeekMonday(semesterStartDate);
  const targetWeekStart = startOfWeekMonday(target);
  const diffDays = Math.max(
    0,
    Math.floor((targetWeekStart.getTime() - semesterStart.getTime()) / DAY_MS),
  );
  const weekNumber = Math.floor(diffDays / 7) + 1;
  const weekStart = new Date(semesterStart.getTime() + (weekNumber - 1) * 7 * DAY_MS);
  const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);

  return {
    weekNumber,
    weekLabel: `第${weekNumber}周`,
    weekStart,
    weekEnd,
    startDateLabel: formatDateOnly(weekStart),
    endDateLabel: formatDateOnly(weekEnd),
  } satisfies AcademicWeekInfo;
}

export function getAcademicWeekInfoByNumber(
  weekNumber: number,
  semesterStartDate: Date,
) {
  const safeWeekNumber = Math.max(1, Math.floor(Number(weekNumber) || 1));
  const semesterStart = startOfWeekMonday(semesterStartDate);
  const anchor = new Date(semesterStart.getTime() + (safeWeekNumber - 1) * 7 * DAY_MS);
  return getAcademicWeekInfo(anchor, semesterStart);
}

export function buildRecentAcademicWeeks(
  semesterStartDate: Date,
  count: number,
  referenceDate = new Date(),
) {
  const currentWeek = getAcademicWeekInfo(referenceDate, semesterStartDate).weekNumber;
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const startWeek = Math.max(1, currentWeek - safeCount + 1);

  return Array.from({ length: safeCount }, (_, index) =>
    getAcademicWeekInfoByNumber(startWeek + index, semesterStartDate),
  );
}

export function buildAcademicWeeksFromStart(
  semesterStartDate: Date,
  endWeekNumber: number,
) {
  const safeEndWeekNumber = Math.max(1, Math.floor(Number(endWeekNumber) || 1));
  return Array.from({ length: safeEndWeekNumber }, (_, index) =>
    getAcademicWeekInfoByNumber(index + 1, semesterStartDate),
  );
}
