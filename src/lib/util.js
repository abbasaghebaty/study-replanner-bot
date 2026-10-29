// Shared small helpers: dates, Persian digits, text normalisation, formatting.

export const DAY = 864e5;
export const ms = (d) => Date.parse(d + "T00:00:00Z");
export const tehranToday = (now = Date.now()) => new Date(now + 210 * 6e4).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const dayIdx = (d) => (new Date(ms(d)).getUTCDay() + 1) % 7; // Saturday = 0 … Friday = 6
export const pad = (n) => String(n).padStart(2, "0");

const FA = "۰۱۲۳۴۵۶۷۸۹";
export const fa = (s) => String(s).replace(/\d/g, (d) => FA[d]);
export const toEn = (s) => String(s).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06f0).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660);
export const norm = (s) =>
  String(s || "")
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[آأإ]/g, "ا")
    .replace(/[\u064B-\u065F\u200c\u200d\s()]/g, "").toLowerCase();
export const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const fmt = (d, opts) => {
  try { return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { ...opts, timeZone: "UTC" }).format(new Date(ms(d))); } catch { return d; }
};
export const niceDate = (d) => (d ? `${fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${d})` : "—");
export const shortDate = (d) => fmt(d, { weekday: "long", day: "numeric", month: "long" });
export const daysLeft = (d, today) => {
  const n = Math.round((ms(d) - ms(today)) / DAY);
  return n < 0 ? `${fa(-n)} روز گذشته` : n === 0 ? "امروز" : n === 1 ? "فردا" : `${fa(n)} روز دیگه`;
};
export const pagesText = (p) => (p ? `${fa(p[0])} تا ${fa(p[1])}` : "ندارد");
