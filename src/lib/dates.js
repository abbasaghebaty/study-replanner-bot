// Date / page parsing from user text (Jalali + Gregorian, relative words, weekdays).
import { ms, addDays, dayIdx, pad, toEn, norm } from "./util.js";

// Jalali → Gregorian (jdf algorithm)
export function j2g(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + ~~(jy / 33) * 8 + ~~(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * ~~(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * ~~(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * ~~(days / 1461);
  days %= 1461;
  gy += ~~((days - 1) / 365);
  if (days > 365) days = (days - 1) % 365;
  let gd = days + 1;
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (; gm < 13 && gd > sal[gm]; gm++) gd -= sal[gm];
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

const WD = { "شنبه": 0, "یکشنبه": 1, "دوشنبه": 2, "سهشنبه": 3, "چهارشنبه": 4, "پنجشنبه": 5, "جمعه": 6 };
const REL = { "امروز": 0, "دیروز": -1, "پریروز": -2, "فردا": 1, "پسفردا": 2 };

// dir = -1: "past" context (weekday → most recent), +1: "future" context (weekday → next one)
export function parseDate(text, today, dir) {
  const q = norm(toEn(text));
  if (q in REL) return addDays(today, REL[q]);
  if (q in WD) {
    for (let i = dir < 0 ? 0 : 1; i <= 7; i++) {
      const d = addDays(today, dir * i);
      if (dayIdx(d) === WD[q]) return d;
    }
  }
  const m = toEn(text).trim().match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/);
  if (!m) return null;
  let [y, mo, d] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = y >= 1300 && y < 1500 ? j2g(y, mo, d) : y >= 1900 ? `${y}-${pad(mo)}-${pad(d)}` : null;
  if (!iso || isNaN(ms(iso)) || new Date(ms(iso)).getUTCDate() !== Number(iso.slice(8))) return null;
  return iso;
}

export const parsePages = (t) => {
  const n = (toEn(t).match(/\d+/g) || []).map(Number);
  return !n.length ? null : n.length === 1 ? [n[0], n[0]] : [Math.min(n[0], n[1]), Math.max(n[0], n[1])];
};
