// Weekly-schedule helpers: which days each book has class, last / next class day.
import { addDays, dayIdx } from "./util.js";

export function sessionDays(books, sched) {
  const own = new Map();
  for (const s of sched) {
    if (s.book_id == null || s.subject === "خالی") continue;
    if (!own.has(s.book_id)) own.set(s.book_id, new Set());
    own.get(s.book_id).add(s.day_index);
  }
  const out = new Map();
  for (const b of books) {
    let days = own.get(b.id);
    if (!days) {
      const parent = books.find((p) => p.id !== b.id && own.has(p.id) && b.subject.startsWith(p.subject));
      days = parent ? own.get(parent.id) : null;
    }
    out.set(b.id, days ? [...days] : []);
  }
  return out;
}

export function lastSessions(days, today, n) { // n most recent class days (today included), newest first
  if (!days.length) return [today];
  const out = [];
  for (let i = 0; i <= 42 && out.length < n; i++) {
    const d = addDays(today, -i);
    if (days.includes(dayIdx(d))) out.push(d);
  }
  return out;
}

export function nextSession(days, from) {
  if (!days.length) return null;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(from, i);
    if (days.includes(dayIdx(d))) return d;
  }
  return null;
}
