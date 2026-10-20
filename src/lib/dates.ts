// Reporting dates are calendar days in REPORT_TIMEZONE, except that a store's
// orders and refunds fall on the day in the store's own time zone (as in Shopify).
export const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE ?? "Europe/Copenhagen";

export function toReportDate(d: Date | string, timeZone = REPORT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(d));
}

export function today(): string {
  return toReportDate(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
