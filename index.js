// study-replanner-bot — Telegram bot for the study-planner D1.
// Logs teaching / homework / exams, ticks tasks done (with a custom date), edits before confirming.
// The study-replanner worker notices DB changes (fingerprint cron) and re-plans by itself.

const DAY = 864e5;
const ms = (d) => Date.parse(d + "T00:00:00Z");
const tehranToday = (now = Date.now()) => new Date(now + 210 * 6e4).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
const dayIdx = (d) => (new Date(ms(d)).getUTCDay() + 1) % 7; // Saturday = 0 … Friday = 6
const pad = (n) => String(n).padStart(2, "0");

const FA = "۰۱۲۳۴۵۶۷۸۹";
const fa = (s) => String(s).replace(/\d/g, (d) => FA[d]);
const toEn = (s) => String(s).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06f0).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660);
const norm = (s) =>
  String(s || "")
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[آأإ]/g, "ا")
    .replace(/[\u064B-\u065F\u200c\u200d\s()]/g, "").toLowerCase();
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const fmt = (d, opts) => {
  try { return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { ...opts, timeZone: "UTC" }).format(new Date(ms(d))); } catch { return d; }
};
const niceDate = (d) => (d ? `${fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (${d})` : "—");
const shortDate = (d) => fmt(d, { weekday: "long", day: "numeric", month: "long" });

// Jalali → Gregorian (jdf algorithm)
function j2g(jy, jm, jd) {
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
function parseDate(text, today, dir) {
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
const parsePages = (t) => {
  const n = (toEn(t).match(/\d+/g) || []).map(Number);
  return !n.length ? null : n.length === 1 ? [n[0], n[0]] : [Math.min(n[0], n[1]), Math.max(n[0], n[1])];
};

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
function lastSessions(days, today, n) { // n most recent class days (today included), newest first
  if (!days.length) return [today];
  const out = [];
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
const send = (env, chat, text, kb) => tg(env, "sendMessage", { chat_id: chat, text, ...(kb ? { reply_markup: kb } : {}) });
const edit = (env, chat, id, text, kb) => tg(env, "editMessageText", { chat_id: chat, message_id: id, text, ...(kb ? { reply_markup: kb } : {}) });
const show = (env, chat, id, text, kb) => (id ? edit(env, chat, id, text, kb) : send(env, chat, text, kb)); // edit if we have a message, else send
const btn = (text, data) => ({ text, callback_data: data });
const kb = (rows) => ({ inline_keyboard: rows });
const chunk = (a, n) => a.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);
const CANCEL = [btn("❌ لغو", "x")];

const MENU = kb([
  [btn("📚 ثبت تدریس", "m:teach"), btn("📝 ثبت تکلیف", "m:hw")],
  [btn("🎓 امتحان جدید", "m:exam"), btn("🗂 امتحان‌ها", "m:exams")],
  [btn("✅ تیک کارها", "m:done")]
]);
const menu = (env, chat, text = "چی ثبت کنم؟", id) => show(env, chat, id, text, MENU);
const subjectKb = (books) => kb([...chunk(books.map((b) => btn(b.subject, "b:" + b.id)), 2), CANCEL]);

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

// ───────────── modes ─────────────
const PAST_MODES = new Set(["teach", "hw", "done", "examdone"]);
const FIELDS = { teach: ["date", "page"], hw: ["date", "due", "text"], exam: ["date", "covers", "pages"], done: ["date"], examdate: ["date"], examdone: ["date"], examcancel: [] };
const dateLabel = (mode, f) =>
  f === "due" ? "⏰ مهلت تحویل" : { teach: "📅 تاریخ جلسه", hw: "📅 تاریخ دادن", exam: "📅 تاریخ امتحان", done: "📅 تاریخ انجام", examdate: "📅 تاریخ جدید", examdone: "📅 تاریخ برگزاری" }[mode];
const fieldLabel = (mode, f) => ({ page: "📄 شمارهٔ صفحه", text: "📝 متن تکلیف", covers: "📖 مبحث", pages: "📄 صفحه‌های امتحان" }[f] || dateLabel(mode, f));
const dirOf = (mode, f) => (f === "due" || mode === "exam" || mode === "examdate" ? 1 : -1);

// fill computed defaults (date from the weekly schedule, due = next class, …)
function fill(ctx, st) {
  const today = tehranToday();
  const days = st.book_id ? ctx.sessions.get(st.book_id) || [] : [];
  if (st.mode === "teach" || st.mode === "hw") st.date ??= lastSessions(days, today, 1)[0];
  if (st.mode === "hw" && !st.dueCustom) {
    const d = nextSession(days, st.date);
    st.due = d && d > today ? d : nextSession(days, today);
  }
  if (st.mode === "exam") st.date ??= nextSession(days, today) || addDays(today, 7);
  if (st.mode === "done" || st.mode === "examdone") st.date ??= today;
}

async function summary(env, ctx, st) {
  const today = tehranToday();
  const b = st.book_id ? ctx.byId.get(st.book_id) : null;
  const days = b ? ctx.sessions.get(b.id) || [] : [];
  const warn = [];
  let t;
  if (st.mode === "teach") {
    const label = await tocLabel(env.DB, b.id, st.page);
    const last = await env.DB.prepare("SELECT up_to_page FROM progress_log WHERE book_id=? AND up_to_page IS NOT NULL ORDER BY report_date DESC, id DESC LIMIT 1").bind(b.id).first();
    t = `📚 ثبت تدریس\nدرس: ${b.subject}\nتا صفحهٔ ${fa(st.page)}${label ? ` — ${label}` : ""}\nتاریخ جلسه: ${niceDate(st.date)}`;
    if (last && st.page < last.up_to_page) warn.push(`از آخرین ثبت (صفحهٔ ${fa(last.up_to_page)}) کمتره.`);
    if (!days.length) warn.push("این درس توی برنامهٔ هفتگی نیست.");
  } else if (st.mode === "hw") {
    t = `📝 ثبت تکلیف\nدرس: ${b.subject}\nتکلیف: ${st.text}\nتاریخ دادن: ${niceDate(st.date)}\nمهلت تحویل: ${st.due ? niceDate(st.due) : "بدون مهلت"}`;
  } else if (st.mode === "exam") {
    t = `🎓 امتحان جدید\nدرس: ${b.subject}\nمبحث: ${st.covers}\nصفحه‌ها: ${st.pages ? `${fa(st.pages[0])} تا ${fa(st.pages[1])}` : "ندارد"}\nتاریخ امتحان: ${niceDate(st.date)}`;
    if (!days.length) warn.push("این درس توی برنامهٔ هفتگی نیست؛ تاریخ رو دستی بزن.");
    if (st.date <= today) warn.push("تاریخ امتحان گذشته یا امروزه؛ برنامهٔ مطالعه ساخته نمی‌شه.");
  } else if (st.mode === "done") {
    t = `✅ انجام کار\n${st.desc}\nتاریخ انجام: ${niceDate(st.date)}`;
  } else if (st.mode === "examdate") {
    t = `📅 تغییر تاریخ امتحان\n${st.label}\nاز: ${niceDate(st.oldDate)}\nبه: ${niceDate(st.date)}`;
    if (st.date === st.oldDate) warn.push("تاریخ تغییری نکرده.");
    warn.push("برنامهٔ مطالعهٔ این امتحان دوباره ساخته می‌شه.");
  } else if (st.mode === "examdone") {
    t = `✔️ امتحان برگزار شد\n${st.label}\nتاریخ: ${niceDate(st.date)}`;
  } else if (st.mode === "examcancel") {
    t = `🚫 لغو امتحان\n${st.label}\nکارهای باقی‌ماندهٔ مطالعهٔ این امتحان بسته می‌شن.`;
  }
  if (PAST_MODES.has(st.mode) && st.mode !== "examdone" && st.date > today) warn.push("تاریخ آینده است.");
  return t + warn.map((w) => `\n⚠️ ${w}`).join("");
}

async function tocLabel(db, bookId, page) {
  const r = await db.prepare("SELECT chapter, lesson, title FROM toc WHERE book_id=? AND start_page>0 AND start_page<=? ORDER BY start_page DESC, id DESC LIMIT 1").bind(bookId, page).first();
  if (!r) return null;
  return r.lesson != null ? `درس ${fa(r.lesson)}: ${r.title}` : `فصل ${fa(r.chapter)}: ${r.title}`;
}

// confirmation screen: ✅ تأیید / ✏️ ویرایش / ❌ لغو
async function renderConfirm(env, ctx, chat, st, editId) {
  fill(ctx, st);
  st.step = "confirm";
  await setState(env.DB, chat, st);
  const row = [btn("✅ تأیید", "ok")];
  if (FIELDS[st.mode].length) row.push(btn("✏️ ویرایش", "e"));
  return show(env, chat, editId, await summary(env, ctx, st), kb([row, CANCEL]));
}
const renderEditMenu = (env, chat, st, id) =>
  show(env, chat, id, "کدوم رو ویرایش کنم؟", kb([...chunk(FIELDS[st.mode].map((f) => btn(fieldLabel(st.mode, f), "f:" + f)), 2), [btn("🔙 برگشت", "back")]]));

function dateChoices(ctx, st, field) {
  const today = tehranToday();
  const days = st.book_id ? ctx.sessions.get(st.book_id) || [] : [];
  if (dirOf(st.mode, field) < 0) return st.mode === "done" || st.mode === "examdone" ? [0, 1, 2, 3].map((i) => addDays(today, -i)) : lastSessions(days, today, 5);
  const out = [];
  let d = today;
  for (let i = 0; i < 4; i++) { d = nextSession(days, d); if (!d) break; out.push(d); }
  return out.length ? out : [1, 2, 3, 7].map((i) => addDays(today, i));
}
async function askField(env, ctx, chat, st, field, id) {
  st.step = "edit:" + field;
  st.editField = field;
  await setState(env.DB, chat, st);
  if (field === "date" || field === "due") {
    const rows = chunk(dateChoices(ctx, st, field).map((d) => btn(shortDate(d), "d:" + d)), 2);
    if (field === "due") rows.push([btn("بدون مهلت", "d:none")]);
    return show(env, chat, id, `${fieldLabel(st.mode, field)} رو انتخاب کن یا بنویس\n(مثلاً ۱۴۰۵/۰۷/۲۷، امروز، دیروز، سه‌شنبه)`, kb([...rows, [btn("🔙 برگشت", "back")]]));
  }
  const hint = { page: "شمارهٔ صفحه رو بنویس (مثلاً ۲۰).", text: "متن جدید تکلیف:", covers: "مبحث امتحان:", pages: "صفحه‌ها (مثلاً ۱-۲۰) یا «ندارد»:" }[field];
  return show(env, chat, id, hint, kb([[btn("🔙 برگشت", "back")], CANCEL]));
}
function setField(st, field, value) {
  if (field === "due") st.dueCustom = true;
  st[field] = value;
}

// ───────────── subject / lists ─────────────
async function askSubject(env, ctx, chat, mode, id) {
  await setState(env.DB, chat, { mode, step: "subject" });
  const title = { teach: "📚 تدریس", hw: "📝 تکلیف", exam: "🎓 امتحان جدید" }[mode];
  return show(env, chat, id, `${title} — کدوم درس؟ دکمه بزن یا اسمش رو بنویس`, subjectKb(ctx.books));
}
async function pickBook(env, ctx, chat, bookId, id) {
  const b = ctx.byId.get(bookId);
  const st = await getState(env.DB, chat);
  if (!b || !st) return menu(env, chat);
  st.book_id = b.id;
  st.step = { teach: "page", hw: "hw_text", exam: "covers" }[st.mode];
  await setState(env.DB, chat, st);
  let t;
  if (st.mode === "teach") {
    const last = await env.DB.prepare("SELECT up_to_page FROM progress_log WHERE book_id=? AND up_to_page IS NOT NULL ORDER BY report_date DESC, id DESC LIMIT 1").bind(b.id).first();
    t = `${b.subject}\nمعلم تا چه صفحه‌ای درس داد؟ (فقط عدد)${last ? `\nآخرین ثبت: صفحهٔ ${fa(last.up_to_page)}` : ""}`;
  } else if (st.mode === "hw") t = `${b.subject}\nتکلیف چیه؟ (متن رو بنویس)`;
  else t = `${b.subject}\nامتحان از چه مبحثی؟ (متن، مثلاً «فصل ۲ و ۳»)`;
  return show(env, chat, id, t, kb([CANCEL]));
}

const KIND = { exam: "🎓", homework: "📝", review: "🔁", preview: "👀" };
async function showTaskList(env, chat, which, id) {
  const today = tehranToday();
  // only live work: open (todo) rows whose deadline hasn't passed. Archived/burned/done rows are never shown.
  const q = {
    today: ["SELECT id,kind,description FROM plan WHERE status='todo' AND plan_date<=? AND due_date>=? ORDER BY due_date, id LIMIT 15", [today, today], "📅 کارهای امروز"],
    next: ["SELECT id,kind,description FROM plan WHERE status='todo' AND plan_date>? ORDER BY plan_date, id LIMIT 15", [today], "🔜 کارهای بعدی"]
  }[which];
  const rows = (await env.DB.prepare(q[0]).bind(...q[1]).all()).results;
  const back = [btn("🔙 برگشت", "m:done")];
  if (!rows.length) return show(env, chat, id, `${q[2]}\nکاری نیست 🎉`, kb([back]));
  return show(env, chat, id, `${q[2]}\nیکی رو بزن تا تیک بخوره:`, kb([...rows.map((r) => [btn(`${KIND[r.kind] || "•"} ${trunc(r.description, 44)}`, "t:" + r.id)]), back]));
}
async function pickTask(env, ctx, chat, planId, id) {
  const today = tehranToday();
  const p = await env.DB.prepare("SELECT * FROM plan WHERE id=?").bind(planId).first();
  if (!p || p.status !== "todo" || p.due_date < today) return menu(env, chat, "این کار دیگه فعال نیست.", id);
  const st = { mode: "done", plan_id: p.id, desc: trunc(p.description, 200), date: today };
  return renderConfirm(env, ctx, chat, st, id);
}
async function showExams(env, chat, id) {
  const rows = (await env.DB.prepare("SELECT e.id,e.exam_date,e.covers,b.subject FROM exams e JOIN books b ON b.id=e.book_id WHERE e.status='upcoming' AND e.exam_date>? ORDER BY e.exam_date").bind(tehranToday()).all()).results;
  const back = [btn("🔙 منو", "menu")];
  if (!rows.length) return show(env, chat, id, "امتحان فعالی نیست.", kb([back]));
  return show(env, chat, id, "🗂 امتحان‌های پیش‌رو:", kb([...rows.map((r) => [btn(`${r.subject} — ${shortDate(r.exam_date)}`, "ex:" + r.id)]), back]));
}
async function showExam(env, chat, exId, id) {
  const e = await env.DB.prepare("SELECT e.*, b.subject FROM exams e JOIN books b ON b.id=e.book_id WHERE e.id=? AND e.status='upcoming' AND e.exam_date>?").bind(exId, tehranToday()).first();
  if (!e) return menu(env, chat, "این امتحان دیگه فعال نیست.", id);
  const pages = e.page_from != null ? `\nصفحه‌ها: ${fa(e.page_from)} تا ${fa(e.page_to)}` : "";
  return show(env, chat, id, `🎓 ${e.subject}\nمبحث: ${e.covers}${pages}\nتاریخ: ${niceDate(e.exam_date)}`,
    kb([[btn("📅 تغییر تاریخ", "exd:" + e.id)], [btn("✔️ برگزار شد", "exok:" + e.id), btn("🚫 لغو امتحان", "exc:" + e.id)], [btn("🔙 برگشت", "m:exams")]]));
}
async function startExamAction(env, ctx, chat, kind, exId, id) {
  const e = await env.DB.prepare("SELECT e.*, b.subject FROM exams e JOIN books b ON b.id=e.book_id WHERE e.id=? AND e.status='upcoming' AND e.exam_date>?").bind(exId, tehranToday()).first();
  if (!e) return menu(env, chat, "این امتحان دیگه فعال نیست.", id);
  const st = { mode: kind, exam_id: e.id, book_id: e.book_id, label: `${e.subject}: ${trunc(e.covers, 60)}`, oldDate: e.exam_date };
  if (kind === "examdate") { st.date = e.exam_date; return askField(env, ctx, chat, st, "date", id); }
  return renderConfirm(env, ctx, chat, st, id);
}

// ───────────── commit ─────────────
async function commit(env, ctx, chat, st, mid) {
  const db = env.DB, today = tehranToday(), nowIso = new Date().toISOString();
  const b = st.book_id ? ctx.byId.get(st.book_id) : null;
  let note;
  if (st.mode === "teach") {
    const dup = await db.prepare("SELECT id FROM progress_log WHERE book_id=? AND report_date=? AND up_to_page=?").bind(b.id, st.date, st.page).first();
    if (dup) note = "این گزارش قبلاً ثبت شده بود؛ دوباره ثبتش نکردم.";
    else {
      const label = await tocLabel(db, b.id, st.page);
      await db.prepare("INSERT INTO progress_log(book_id,report_date,up_to_page,lesson_label,notes) VALUES(?,?,?,?,'telegram-bot')").bind(b.id, st.date, st.page, label).run();
      note = `✅ ثبت شد: ${b.subject} تا صفحهٔ ${fa(st.page)}`;
    }
  } else if (st.mode === "hw") {
    await db.prepare("INSERT INTO homework(book_id,description,due_date,status,assigned_date,notes) VALUES(?,?,?,'todo',?,'telegram-bot')").bind(b.id, st.text, st.due || null, st.date).run();
    note = `✅ تکلیف ثبت شد: ${b.subject}`;
  } else if (st.mode === "exam") {
    const dup = await db.prepare("SELECT id FROM exams WHERE book_id=? AND exam_date=? AND covers=? AND status='upcoming'").bind(b.id, st.date, st.covers).first();
    if (dup) note = "این امتحان قبلاً ثبت شده بود.";
    else {
      await db.prepare("INSERT INTO exams(book_id,exam_date,covers,page_from,page_to,status,notes) VALUES(?,?,?,?,?,'upcoming','telegram-bot')").bind(b.id, st.date, st.covers, st.pages?.[0] ?? null, st.pages?.[1] ?? null).run();
      note = `✅ امتحان ${b.subject} ثبت شد (${shortDate(st.date)})`;
    }
  } else if (st.mode === "done") note = await commitDone(db, st);
  else if (st.mode === "examdate") {
    await db.prepare("UPDATE exams SET exam_date=?, notes=COALESCE(notes||' | ','')||? WHERE id=?").bind(st.date, `تاریخ از ${st.oldDate} به ${st.date} تغییر کرد (bot)`, st.exam_id).run();
    // detach old plan rows so the replanner builds a fresh study plan for the new date
    await db.prepare("UPDATE plan SET status=CASE WHEN status='todo' THEN 'skipped' ELSE status END, closed_reason=CASE WHEN status='todo' THEN 'rescheduled' ELSE closed_reason END, closed_at=CASE WHEN status='todo' THEN ? ELSE closed_at END, source_type='exam_old' WHERE source_type='exam' AND source_id=?").bind(nowIso, st.exam_id).run();
    note = `✅ تاریخ امتحان شد ${shortDate(st.date)}`;
  } else if (st.mode === "examdone" || st.mode === "examcancel") {
    const done = st.mode === "examdone";
    await db.prepare("UPDATE exams SET status=?, closed_at=? WHERE id=?").bind(done ? "done" : "cancelled", done ? st.date : today, st.exam_id).run();
    await db.prepare("UPDATE plan SET status='skipped', closed_reason=?, closed_at=? WHERE source_type='exam' AND source_id=? AND status='todo'").bind(done ? "exam_done" : "exam_cancelled", nowIso, st.exam_id).run();
    note = done ? "✅ امتحان بسته شد." : "✅ امتحان لغو شد.";
  }
  await setState(db, chat, null);
  if (mid) await edit(env, chat, mid, note);
  return menu(env, chat, "برنامه تا چند دقیقهٔ دیگه خودکار به‌روز می‌شه. چیز دیگه‌ای؟");
}

async function commitDone(db, st) {
  const p = await db.prepare("SELECT * FROM plan WHERE id=?").bind(st.plan_id).first();
  if (!p || p.status !== "todo") return "این کار دیگه فعال نیست.";
  await db.prepare("UPDATE plan SET status='done', done_at=? WHERE id=?").bind(st.date, p.id).run();
  if (p.source_type === "homework" && p.source_id) {
    // the homework itself is done once none of its plan rows is still open
    const open = await db.prepare("SELECT count(*) n FROM plan WHERE source_type='homework' AND source_id=? AND status='todo'").bind(p.source_id).first();
    if (!open.n) await db.prepare("UPDATE homework SET status='done', done_at=? WHERE id=? AND status='todo'").bind(st.date, p.source_id).run();
  }
  return `✅ تیک خورد: ${trunc(st.desc, 80)}`;
}

// ───────────── routing ─────────────
async function onCallback(env, ctx, chat, mid, data) {
  const db = env.DB;
  const [cmd, arg] = [data.split(":")[0], data.slice(data.indexOf(":") + 1)];
  if (data === "x") { await setState(db, chat, null); return menu(env, chat, "لغو شد.", mid); }
  if (data === "menu") return menu(env, chat, "چی ثبت کنم؟", mid);
  if (cmd === "m") {
    if (["teach", "hw", "exam"].includes(arg)) return askSubject(env, ctx, chat, arg, mid);
    if (arg === "exams") return showExams(env, chat, mid);
    if (arg === "done") return show(env, chat, mid, "✅ کدوم کارها؟", kb([[btn("📅 امروز", "dl:today"), btn("🔜 بعدی‌ها", "dl:next")], [btn("🔙 منو", "menu")]]));
  }
  if (cmd === "dl") return showTaskList(env, chat, arg, mid);
  if (cmd === "t") return pickTask(env, ctx, chat, Number(arg), mid);
  if (cmd === "ex") return showExam(env, chat, Number(arg), mid);
  if (cmd === "exd") return startExamAction(env, ctx, chat, "examdate", Number(arg), mid);
  if (cmd === "exok") return startExamAction(env, ctx, chat, "examdone", Number(arg), mid);
  if (cmd === "exc") return startExamAction(env, ctx, chat, "examcancel", Number(arg), mid);
  if (cmd === "b") return pickBook(env, ctx, chat, Number(arg), mid);
  const st = await getState(db, chat);
  if (!st || !["confirm", "edit", "pages"].includes(st.step.split(":")[0])) return menu(env, chat, "این پیام منقضی شده؛ دوباره از منو شروع کن 👇");
  if (data === "np") { st.pages = null; return renderConfirm(env, ctx, chat, st, mid); }
  if (data === "ok") return st.step === "confirm" ? commit(env, ctx, chat, st, mid) : renderConfirm(env, ctx, chat, st, mid);
  if (data === "e") return renderEditMenu(env, chat, st, mid);
  if (data === "back") return renderConfirm(env, ctx, chat, st, mid);
  if (cmd === "f") return askField(env, ctx, chat, st, arg, mid);
  if (cmd === "d" && st.editField) {
    setField(st, st.editField, arg === "none" ? null : arg);
    return renderConfirm(env, ctx, chat, st, mid);
  }
}

async function onText(env, ctx, chat, text) {
  const db = env.DB;
  if (/^\/(start|menu|cancel)\b/.test(text)) { await setState(db, chat, null); return menu(env, chat); }
  if (/^\/today\b/.test(text)) { await setState(db, chat, null); return showTaskList(env, chat, "today"); }
  const st = await getState(db, chat);
  if (!st) return menu(env, chat, "یکی از گزینه‌ها رو انتخاب کن 👇");
  const step = st.step;
  if (step === "subject") {
    const hits = matchBooks(ctx, text);
    if (hits.length === 1) return pickBook(env, ctx, chat, hits[0].id);
    if (hits.length > 1) return send(env, chat, "کدوم‌یکی؟", kb([...chunk(hits.map((b) => btn(b.subject, "b:" + b.id)), 2), CANCEL]));
    return send(env, chat, "درسی با این اسم پیدا نکردم. از دکمه‌ها انتخاب کن:", subjectKb(ctx.books));
  }
  const field = step.startsWith("edit:") ? step.slice(5) : { page: "page", hw_text: "text", covers: "covers", pages: "pages" }[step];
  if (!field) return send(env, chat, "برای ادامه از دکمه‌ها استفاده کن یا /cancel بزن.");
  let value;
  if (field === "date" || field === "due") {
    value = parseDate(text, tehranToday(), dirOf(st.mode, field));
    if (!value) return send(env, chat, "تاریخ رو نفهمیدم. مثلاً ۱۴۰۵/۰۷/۲۷ یا امروز یا دیروز یا سه‌شنبه.");
  } else if (field === "page") {
    value = parseInt(toEn(text), 10);
    if (!(value > 0 && value < 2000)) return send(env, chat, "فقط شمارهٔ صفحه رو بنویس (مثلاً ۲۰).");
  } else if (field === "pages") value = parsePages(text);
  else {
    value = text;
    if (text.length < 2) return send(env, chat, "یه متن بنویس.");
  }
  setField(st, field, value);
  if (step === "covers") { st.step = "pages"; await setState(db, chat, st); return send(env, chat, "صفحه‌های امتحان؟ (مثلاً ۱-۲۰)", kb([[btn("ندارد", "np")], CANCEL])); }
  return renderConfirm(env, ctx, chat, st);
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
export { parseDate, j2g };
