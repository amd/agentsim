/* Milliseconds <-> Date mapping. vis-timeline needs a Date axis; the public API
   is in milliseconds (the smallest unit), so we anchor to an arbitrary epoch and
   convert at the boundary. */

const BASE = new Date(2024, 0, 1, 0, 0, 0, 0).getTime();

export const msToDate = (ms: number): Date => new Date(BASE + ms);
export const dateToMs = (value: number): number => value - BASE;

/* Apple/NLE-style timecode. The field structure is fixed up-front so labels
   never overflow as you pan: `hours` (chosen once from the total span) decides
   `hh:mm:ss` vs `m:ss`; `tenths` (driven by sub-second zoom) appends `.d`. We
   floor every field — like FCP — so a tick reads the interval it sits in rather
   than rounding up into the next one. */
export function formatTimecode(
  ms: number,
  opts: { hours: boolean; tenths: boolean },
): string {
  const sign = ms < 0 ? "-" : "";
  const t = Math.max(0, Math.abs(ms));
  const totalSec = Math.floor(t / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  let out = opts.hours
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  if (opts.tenths) out += `.${Math.floor((t % 1000) / 100)}`;
  return sign + out;
}

/** Axis label ladder. The structure (`hh:mm:ss` vs `m:ss`) is fixed by the
    total span via `longTimeline`; only the finest sub-second tick adds `.d`. */
export function formatAxisLabel(ms: number, scale: string, longTimeline: boolean): string {
  return formatTimecode(ms, { hours: longTimeline, tenths: scale === "millisecond" });
}

/** Millisecond-precise clock for labels/info: `m:ss.mmm` (e.g. 0:05.123). */
export function formatClockMs(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const t = Math.abs(ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const millis = Math.round(t % 1000);
  return `${sign}${m}:${String(s).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
