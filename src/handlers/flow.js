// The shared "collect fields → confirm / edit → save" flow used by teaching, homework and exams.
import { tehranToday, addDays, fa, niceDate, shortDate, pagesText } from "../lib/util.js";
import { lastSessions, nextSession } from "../lib/schedule.js";
import { show, btn, kb, chunk, CANCEL, subjectKb, menu } from "../telegram.js";
import { getState, setState, lastLog, tocLabel } from "../db.js";

export const PAST_MODES = new Set(["teach", "hw", "done", "examdone"]);
export const FIELDS = {
  teach: ["date", "page"],
  hw: ["date", "due", "text"],
  exam: ["date", "covers", "pages", "details"],
  done: ["date"],
  examdate: ["date"],
  exampages: ["pages"],
  examnote: ["details"],
  examdone: ["date"],
  examcancel: []
};
const dateLabel = (mode, f) =>
  f === "due" ? "⏰ مهلت تحویل" : { teach: "📅 تاریخ جلسه", hw: "📅 تاریخ دادن", exam: "📅 تاریخ امتحان", done: "📅 تاریخ انجام", examdate: "📅 تاریخ جدید", examdone: "📅 تاریخ برگزاری" }[mode];
const fieldLabel = (mode, f) => ({ page: "📄 شمارهٔ صفحه", text: "📝 متن تکلیف", covers: "📖 مبحث", pages: "📄 صفحه‌های امتحان", details: "📌 توضیحات" }[f] || dateLabel(mode, f));
export const dirOf = (mode, f) => (f === "due" || mode === "exam" || mode === "examdate" ? 1 : -1);

const lastLogText = (l) => (!l ? "" : l.page != null ? `\nآخرین ثبت: صفحهٔ ${fa(l.page)}` : `\nآخرین ثبت: ${l.label || "—"} (بدون شمارهٔ صفحه)`);

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
    const last = await lastLog(env.DB, b.id);
    t = `📚 ثبت تدریس\nدرس: ${b.subject}\nتا صفحهٔ ${fa(st.page)}${label ? ` — ${label}` : ""}\nتاریخ جلسه: ${niceDate(st.date)}`;
    if (last && last.page != null && st.page < last.page) warn.push(`از آخرین ثبت (صفحهٔ ${fa(last.page)}) کمتره.`);
    if (!days.length) warn.push("این درس توی برنامهٔ هفتگی نیست.");
  } else if (st.mode === "hw") {
    t = `📝 ثبت تکلیف\nدرس: ${b.subject}\nتکلیف: ${st.text}\nتاریخ دادن: ${niceDate(st.date)}\nمهلت تحویل: ${st.due ? niceDate(st.due) : "بدون مهلت"}`;
  } else if (st.mode === "exam") {
    t = `🎓 امتحان جدید\nدرس: ${b.subject}\nمبحث: ${st.covers}\nصفحه‌ها: ${pagesText(st.pages)}\nتاریخ امتحان: ${niceDate(st.date)}\n📌 توضیحات: ${st.details || "ندارد"}`;
    if (!days.length) warn.push("این درس توی برنامهٔ هفتگی نیست؛ تاریخ رو دستی بزن.");
    if (st.date < today) warn.push("تاریخ امتحان گذشته است.");
  } else if (st.mode === "done") {
    t = `✅ انجام تکلیف\n${st.desc}\nتاریخ انجام: ${niceDate(st.date)}`;
  } else if (st.mode === "examdate") {
    t = `📅 تغییر تاریخ امتحان\n${st.label}\nاز: ${niceDate(st.oldDate)}\nبه: ${niceDate(st.date)}`;
    if (st.date === st.oldDate) warn.push("تاریخ تغییری نکرده.");
  } else if (st.mode === "exampages") {
    t = `📄 ویرایش صفحه‌های امتحان\n${st.label}\nاز: ${pagesText(st.oldPages)}\nبه: ${pagesText(st.pages)}`;
    if (JSON.stringify(st.pages) === JSON.stringify(st.oldPages)) warn.push("صفحه‌ها تغییری نکرده.");
  } else if (st.mode === "examnote") {
    t = `📌 توضیحات امتحان\n${st.label}\nقبلی: ${st.oldDetails || "ندارد"}\nجدید: ${st.details || "ندارد (پاک می‌شه)"}`;
    if ((st.details || null) === (st.oldDetails || null)) warn.push("توضیحات تغییری نکرده.");
  } else if (st.mode === "examdone") {
    t = `✔️ امتحان برگزار شد\n${st.label}\nتاریخ: ${niceDate(st.date)}`;
  } else if (st.mode === "examcancel") {
    t = `🚫 لغو امتحان\n${st.label}`;
  }
  if (PAST_MODES.has(st.mode) && st.mode !== "examdone" && st.date > today) warn.push("تاریخ آینده است.");
  return t + warn.map((w) => `\n⚠️ ${w}`).join("");
}

// confirmation screen: ✅ تأیید / ✏️ ویرایش / ❌ لغو
export async function renderConfirm(env, ctx, chat, st, editId) {
  fill(ctx, st);
  st.step = "confirm";
  await setState(env.DB, chat, st);
  const row = [btn("✅ تأیید", "ok")];
  if (FIELDS[st.mode].length) row.push(btn("✏️ ویرایش", "e"));
  return show(env, chat, editId, await summary(env, ctx, st), kb([row, CANCEL]));
}
export const renderEditMenu = (env, chat, st, id) =>
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

export async function askField(env, ctx, chat, st, field, id) {
  st.step = "edit:" + field;
  st.editField = field;
  await setState(env.DB, chat, st);
  if (field === "date" || field === "due") {
    const rows = chunk(dateChoices(ctx, st, field).map((d) => btn(shortDate(d), "d:" + d)), 2);
    if (field === "due") rows.push([btn("بدون مهلت", "d:none")]);
    return show(env, chat, id, `${fieldLabel(st.mode, field)} رو انتخاب کن یا بنویس\n(مثلاً ۱۴۰۵/۰۷/۲۷، امروز، دیروز، سه‌شنبه)`, kb([...rows, [btn("🔙 برگشت", "back")]]));
  }
  const hint = {
    page: "شمارهٔ صفحه رو بنویس (مثلاً ۲۰).",
    text: "متن جدید تکلیف:",
    covers: "مبحث امتحان:",
    pages: "صفحه‌ها (مثلاً ۱-۲۰) یا «ندارد»:",
    details: "توضیحات امتحان رو بنویس (مثلاً سخت‌گیری معلم، املا، گرامر و …):"
  }[field];
  const rows = [[btn("🔙 برگشت", "back")], CANCEL];
  if (field === "pages") rows.unshift([btn("ندارد", "np")]);
  if (field === "details") rows.unshift([btn("🗑 پاک کردن توضیحات", "nd")]);
  return show(env, chat, id, hint, kb(rows));
}

export function setField(st, field, value) {
  if (field === "due") st.dueCustom = true;
  st[field] = value;
}

// ───────────── subject picking ─────────────
export async function askSubject(env, ctx, chat, mode, id) {
  await setState(env.DB, chat, { mode, step: "subject" });
  const title = { teach: "📚 تدریس", hw: "📝 تکلیف", exam: "🎓 امتحان جدید" }[mode];
  return show(env, chat, id, `${title} — کدوم درس؟ دکمه بزن یا اسمش رو بنویس`, subjectKb(ctx.books));
}

export async function pickBook(env, ctx, chat, bookId, id) {
  const b = ctx.byId.get(bookId);
  const st = await getState(env.DB, chat);
  if (!b || !st) return menu(env, chat);
  st.book_id = b.id;
  st.step = { teach: "page", hw: "hw_text", exam: "covers" }[st.mode];
  await setState(env.DB, chat, st);
  let t;
  if (st.mode === "teach") {
    const last = await lastLog(env.DB, b.id);
    t = `${b.subject}\nمعلم تا چه صفحه‌ای درس داد؟ (فقط عدد)${lastLogText(last)}`;
  } else if (st.mode === "hw") t = `${b.subject}\nتکلیف چیه؟ (متن رو بنویس)`;
  else t = `${b.subject}\nامتحان از چه مبحثی؟ (متن، مثلاً «فصل ۲ و ۳»)`;
  return show(env, chat, id, t, kb([CANCEL]));
}
