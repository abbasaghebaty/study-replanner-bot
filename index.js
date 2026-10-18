// study-bot — Telegram bot that logs teaching progress & homework into the study-planner D1.
// It only INSERTs into progress_log / homework. The study-replanner worker notices the change
// (fingerprint cron) and generates review / pre-study / schedule by itself.

const DAY = 864e5;
const ms = (d) => Date.parse(d + "T00:00:00Z");
const tehranToday = (now = Date.now()) => new Date(now + 210 * 6e4).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const dayIdx = (d) => (new Date(ms(d)).getUTCDay() + 1) % 7; // Saturday = 0 … Friday = 6

const FA = "۰۱۲۳۴۵۶۷۸۹";
const fa = (s) => String(s).replace(/\d/g, (d) => FA[d]);
const toEn = (s) => String(s).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06f0).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660);
const niceDate = (d) => {
  try {
    const t = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(ms(d)));
    return `${t} (${d})`;
  } catch {
    return d;
  }
};
const norm = (s) =>
  String(s || "")
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[آأإ]/g, "ا")
    .replace(/[\u064B-\u065F\u200c\u200d\s()]/g, "").toLowerCase();

// ───────────── schedule helpers (same rules as the replanner) ─────────────
function sessionDays(books, sched) {
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
// the n most recent class days (today included), newest first
function lastSessions(days, today, n) {
  const out = [];
  if (!days.length) return [today];
  for (let i = 0; i <= 42 && out.length < n; i++) {
    const d = addDays(today, -i);
    if (days.includes(dayIdx(d))) out.push(d);
  }
  return out;
}
function nextSession(days, from) {
  if (!days.length) return null;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(from, i);
    if (days.includes(dayIdx(d))) return d;
  }
  return null;
}

// ───────────── Telegram ─────────────
const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then((r) => r.json());
const send = (env, chat, text, kb) =>
  tg(env, "sendMessage", { chat_id: chat, text, ...(kb ? { reply_markup: kb } : {}) });
const edit = (env, chat, id, text, kb) =>
  tg(env, "editMessageText", { chat_id: chat, message_id: id, text, ...(kb ? { reply_markup: kb } : {}) });
const btn = (text, data) => ({ text, callback_data: data });
const kb = (rows) => ({ inline_keyboard: rows });
const chunk = (a, n) => a.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);

const MENU = kb([[btn("📚 ثبت تدریس", "m:teach")], [btn("📝 ثبت تکلیف", "m:hw")]]);
const menu = (env, chat, text = "چی ثبت کنم؟") => send(env, chat, text, MENU);
const subjectKb = (books) => kb([...chunk(books.map((b) => btn(b.subject, "b:" + b.id)), 2), [btn("❌ لغو", "x")]]);

// ───────────── state (one row per chat, in D1) ─────────────
const getState = async (db, chat) => {
  const r = await db.prepare("SELECT data FROM bot_state WHERE chat_id=?").bind(chat).first();
  return r ? JSON.parse(r.data) : null;
};
const setState = (db, chat, st) =>
  st
    ? db.prepare("INSERT INTO bot_state(chat_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
        .bind(chat, JSON.stringify(st), new Date().toISOString()).run()
    : db.prepare("DELETE FROM bot_state WHERE chat_id=?").bind(chat).run();

async function loadCtx(db) {
  const [books, sched] = await Promise.all([
    db.prepare("SELECT id, subject, title FROM books ORDER BY id").all(),
    db.prepare("SELECT day_index, subject, book_id FROM weekly_schedule").all()
  ]);
  const names = new Map(books.results.map((b) => [b.id, [b.subject, b.title]]));
  for (const s of sched.results) if (s.book_id != null && s.subject !== "خالی") names.get(s.book_id)?.push(s.subject);
  return { books: books.results, names, sessions: sessionDays(books.results, sched.results), byId: new Map(books.results.map((b) => [b.id, b])) };
}

// fuzzy subject match: exact > prefix > contains. Returns the best-scoring books (1 = resolved, >1 = ask).
function matchBooks(ctx, text) {
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

// ───────────── flow ─────────────
async function askSubject(env, ctx, chat, mode, editId) {
  await setState(env.DB, chat, { mode, step: "subject" });
  const t = (mode === "teach" ? "📚 تدریس — " : "📝 تکلیف — ") + "کدوم درس؟ دکمه بزن یا اسمش رو بنویس";
  return editId ? edit(env, chat, editId, t, subjectKb(ctx.books)) : send(env, chat, t, subjectKb(ctx.books));
}

async function pickBook(env, ctx, chat, bookId, editId) {
  const b = ctx.byId.get(bookId);
  if (!b) return menu(env, chat);
  const st = (await getState(env.DB, chat)) || { mode: "teach" };
  Object.assign(st, { book_id: b.id, shift: 0, step: st.mode === "teach" ? "page" : "hw_text" });
  await setState(env.DB, chat, st);
  let t;
  if (st.mode === "teach") {
    const last = await env.DB.prepare("SELECT up_to_page, report_date FROM progress_log WHERE book_id=? AND up_to_page IS NOT NULL ORDER BY report_date DESC, id DESC LIMIT 1").bind(b.id).first();
    t = `${b.subject}\nمعلم تا چه صفحه‌ای درس داد؟ (فقط عدد)` + (last ? `\nآخرین ثبت: صفحهٔ ${fa(last.up_to_page)}` : "");
  } else {
    t = `${b.subject}\nتکلیف چیه؟ (متن رو بنویس)`;
  }
  return editId ? edit(env, chat, editId, t, kb([[btn("❌ لغو", "x")]])) : send(env, chat, t, kb([[btn("❌ لغو", "x")]]));
}

async function tocLabel(db, bookId, page) {
  const r = await db.prepare("SELECT chapter, lesson, title FROM toc WHERE book_id=? AND start_page>0 AND start_page<=? ORDER BY start_page DESC, id DESC LIMIT 1").bind(bookId, page).first();
  if (!r) return null;
  return r.lesson != null ? `درس ${fa(r.lesson)}: ${r.title}` : `فصل ${fa(r.chapter)}: ${r.title}`;
}

// compute what would be written, show it, wait for ✅
async function renderConfirm(env, ctx, chat, st, editId) {
  const b = ctx.byId.get(st.book_id);
  const days = ctx.sessions.get(b.id) || [];
  const today = tehranToday();
  const sessions = lastSessions(days, today, 6);
  st.shift = Math.max(0, Math.min(st.shift || 0, sessions.length - 1));
  const date = sessions[st.shift];
  st.step = "confirm";
  await setState(env.DB, chat, st);
  let t;
  if (st.mode === "teach") {
    const label = await tocLabel(env.DB, b.id, st.page);
    const last = await env.DB.prepare("SELECT up_to_page FROM progress_log WHERE book_id=? AND up_to_page IS NOT NULL ORDER BY report_date DESC, id DESC LIMIT 1").bind(b.id).first();
    t = `📚 تدریس\nدرس: ${b.subject}\nتا صفحهٔ ${fa(st.page)}` + (label ? ` — ${label}` : "") + `\nتاریخ جلسه: ${niceDate(date)}`;
    if (last && st.page < last.up_to_page) t += `\n⚠️ از آخرین ثبت (صفحهٔ ${fa(last.up_to_page)}) کمتره.`;
    if (!days.length) t += "\n⚠️ این درس توی برنامهٔ هفتگی نیست؛ تاریخ امروز ثبت می‌شه.";
  } else {
    const due = nextSession(days, date);
    st.due = due && due > today ? due : nextSession(days, today);
    await setState(env.DB, chat, st);
    t = `📝 تکلیف\nدرس: ${b.subject}\nتکلیف: ${st.text}\nتاریخ دادن: ${niceDate(date)}\nمهلت تحویل: ${st.due ? niceDate(st.due) : "بدون مهلت"}`;
  }
  const row2 = [btn("✅ تأیید", "ok")];
  if (sessions.length > st.shift + 1) row2.push(btn("⏪ جلسهٔ قبل‌تر", "prev"));
  if (st.shift > 0) row2.push(btn("⏩ جلسهٔ بعدتر", "next"));
  const markup = kb([row2, [btn("❌ لغو", "x")]]);
  return editId ? edit(env, chat, editId, t, markup) : send(env, chat, t, markup);
}

async function commit(env, ctx, chat, st, editId) {
  const b = ctx.byId.get(st.book_id);
  const days = ctx.sessions.get(b.id) || [];
  const date = lastSessions(days, tehranToday(), 6)[st.shift || 0];
  let note;
  if (st.mode === "teach") {
    const dup = await env.DB.prepare("SELECT id FROM progress_log WHERE book_id=? AND report_date=? AND up_to_page=?").bind(b.id, date, st.page).first();
    if (dup) note = "این گزارش قبلاً ثبت شده بود؛ دوباره ثبتش نکردم.";
    else {
      const label = await tocLabel(env.DB, b.id, st.page);
      await env.DB.prepare("INSERT INTO progress_log(book_id,report_date,up_to_page,lesson_label,notes) VALUES(?,?,?,?,'telegram-bot')").bind(b.id, date, st.page, label).run();
      note = `✅ ثبت شد: ${b.subject} تا صفحهٔ ${fa(st.page)}`;
    }
  } else {
    await env.DB.prepare("INSERT INTO homework(book_id,description,due_date,status,assigned_date,notes) VALUES(?,?,?,'todo',?,'telegram-bot')").bind(b.id, st.text, st.due || null, date).run();
    note = `✅ تکلیف ثبت شد: ${b.subject}`;
  }
  await setState(env.DB, chat, null);
  if (editId) await edit(env, chat, editId, note);
  return menu(env, chat, "برنامه تا چند دقیقهٔ دیگه خودکار به‌روز می‌شه. چیز دیگه‌ای؟");
}

async function onCallback(env, ctx, chat, mid, data) {
  const db = env.DB;
  if (data === "x") { await setState(db, chat, null); return edit(env, chat, mid, "لغو شد.", MENU); }
  if (data === "m:teach" || data === "m:hw") return askSubject(env, ctx, chat, data.slice(2), mid);
  if (data.startsWith("b:")) return pickBook(env, ctx, chat, Number(data.slice(2)), mid);
  const st = await getState(db, chat);
  if (!st || st.step !== "confirm") return menu(env, chat, "این پیام منقضی شده؛ دوباره از منو شروع کن 👇");
  if (data === "prev") { st.shift = (st.shift || 0) + 1; return renderConfirm(env, ctx, chat, st, mid); }
  if (data === "next") { st.shift = Math.max(0, (st.shift || 0) - 1); return renderConfirm(env, ctx, chat, st, mid); }
  if (data === "ok") return commit(env, ctx, chat, st, mid);
}

async function onText(env, ctx, chat, text) {
  const db = env.DB;
  if (/^\/(start|menu|cancel)\b/.test(text)) { await setState(db, chat, null); return menu(env, chat); }
  const st = await getState(db, chat);
  if (!st) return menu(env, chat, "یکی از گزینه‌ها رو انتخاب کن 👇");
  if (st.step === "subject") {
    const hits = matchBooks(ctx, text);
    if (hits.length === 1) return pickBook(env, ctx, chat, hits[0].id);
    if (hits.length > 1) return send(env, chat, "کدوم‌یکی؟", kb([...chunk(hits.map((b) => btn(b.subject, "b:" + b.id)), 2), [btn("❌ لغو", "x")]]));
    return send(env, chat, "درسی با این اسم پیدا نکردم. از دکمه‌ها انتخاب کن:", subjectKb(ctx.books));
  }
  if (st.step === "page") {
    const n = parseInt(toEn(text), 10);
    if (!(n > 0 && n < 2000)) return send(env, chat, "فقط شمارهٔ صفحه رو بنویس (مثلاً ۲۰).");
    st.page = n;
    return renderConfirm(env, ctx, chat, st);
  }
  if (st.step === "hw_text") {
    if (text.length < 2) return send(env, chat, "متن تکلیف رو بنویس.");
    st.text = text;
    return renderConfirm(env, ctx, chat, st);
  }
  return send(env, chat, "برای ادامه از دکمه‌های بالا استفاده کن یا /cancel بزن.");
}

async function handle(env, u) {
  const cb = u.callback_query;
  const msg = cb ? cb.message : u.message;
  if (!msg) return;
  const chat = String(msg.chat.id);
  if (!env.OWNER_CHAT_ID || chat !== String(env.OWNER_CHAT_ID)) {
    if (!cb) await send(env, chat, `دسترسی نداری.\nChat ID: ${chat}\n(برای راه‌اندازی، همین عدد رو بذار توی OWNER_CHAT_ID)`);
    return;
  }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS bot_state (chat_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  const ctx = await loadCtx(env.DB);
  if (cb) {
    await tg(env, "answerCallbackQuery", { callback_query_id: cb.id });
    return onCallback(env, ctx, chat, msg.message_id, cb.data || "");
  }
  return onText(env, ctx, chat, (msg.text || "").trim());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname !== "/webhook" || request.method !== "POST") return new Response("not found", { status: 404 });
    if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("unauthorized", { status: 401 });
    try {
      await handle(env, await request.json());
    } catch (e) {
      console.error("bot error", e); // always 200 so Telegram doesn't retry-storm
    }
    return new Response("ok");
  }
};
