// Date bucketing shared by the sidebar list grouping and the filter panel.

export const DAY_MS = 86_400_000;
export const SECTIONS = ["Today", "Yesterday", "This Week", "This Month", "Older"] as const;
export type Section = (typeof SECTIONS)[number];

// Local midnight at the start of the current day, as epoch ms.
export function startOfToday(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// Bucket a date by how far it is from the start of the current day.
export function sectionFor(date: string, startOfTodayMs: number): Section {
  const t = new Date(date).getTime();
  if (t >= startOfTodayMs) return "Today";
  if (t >= startOfTodayMs - DAY_MS) return "Yesterday";
  if (t >= startOfTodayMs - 7 * DAY_MS) return "This Week";
  if (t >= startOfTodayMs - 30 * DAY_MS) return "This Month";
  return "Older";
}
