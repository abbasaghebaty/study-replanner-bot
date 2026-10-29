// D1 access: per-chat conversation state, books/schedule context, subject matching, progress lookups.
import { norm, fa } from "./lib/util.js";
import { sessionDays } from "./lib/schedule.js";

export const getState = async (db, chat) => {
  const r = await db.prepare("SELECT data FROM bot_state WHERE chat_id=?").bind(chat).first();
  return r ? JSON.parse(r.data) : null;
};
export const setState = (db, chat, st) =>
  st
    ? db.prepare("INSERT INTO bot_state(chat_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
        .bind(chat, JSON.stringify(st), new Date().toISOString()).run()
    : db.prepare("DELETE FROM bot_state WHERE chat_id=?").bind(chat).run();

export async function loadCtx(db) {
  const [books, sched] = await Promise.all([
    db.prepare("SELECT id, subject, title FROM books ORDER BY id").all(),
    db.prepare("SELECT day_index, subject, book_id FROM weekly_schedule").all()
  ]);
  const names = new Map(books.results.map((b) => [b.id, [b.subject, b.title]]));
  for (const s of sched.results) if (s.book_id != null && s.subject !== "خالی") names.get(s.book_id)?.push(s.subject);
  return { books: books.results, names, sessions: sessionDays(books.results, sched.results), byId: new Map(books.results.map((b) => [b.id, b])) };
}

// fuzzy subject match: exact > prefix > contains
export function matchBooks(ctx, text) {
  const q = norm(text);
  if (!q) return [];
  let best = 0, hits = [];
  for (const b of ctx.books) {
    let sc = 0;
    for (const raw of ctx.names.get(b.id)) {
      const n = norm(raw);
      if (!n) continue;
      if (n === q) sc = Math.max(sc, 3);
      else if (n.startsWith(q)) sc = Math.max(sc, 2);
      else if (n.includes(q) || (n.length >= 3 && q.includes(n))) sc = Math.max(sc, 1);
    }
    if (sc > best) { best = sc; hits = [b]; } else if (sc === best && sc > 0) hits.push(b);
  }
  return hits;
}

export async function lastLog(db, bookId) {
  const withPage = await db.prepare("SELECT up_to_page, lesson_label FROM progress_log WHERE book_id=? AND up_to_page IS NOT NULL ORDER BY report_date DESC, id DESC LIMIT 1").bind(bookId).first();
  if (withPage) return { page: withPage.up_to_page, label: withPage.lesson_label };
  const any = await db.prepare("SELECT lesson_label FROM progress_log WHERE book_id=? ORDER BY report_date DESC, id DESC LIMIT 1").bind(bookId).first();
  return any ? { page: null, label: any.lesson_label } : null;
}

export async function tocLabel(db, bookId, page) {
  const r = await db.prepare("SELECT chapter, lesson, title FROM toc WHERE book_id=? AND start_page>0 AND start_page<=? ORDER BY start_page DESC, id DESC LIMIT 1").bind(bookId, page).first();
  if (!r) return null;
  return r.lesson != null ? `درس ${fa(r.lesson)}: ${r.title}` : `فصل ${fa(r.chapter)}: ${r.title}`;
}
