// Routes button presses (callback data) and typed text to the right handler.
import { tehranToday, toEn } from "./lib/util.js";
import { parseDate, parsePages } from "./lib/dates.js";
import { send, menu, btn, kb, chunk, CANCEL, subjectKb } from "./telegram.js";
import { getState, setState, matchBooks } from "./db.js";
import { askSubject, pickBook, renderConfirm, renderEditMenu, askField, setField, dirOf } from "./handlers/flow.js";
import { commit } from "./handlers/commit.js";
import { showHomework, pickHw } from "./handlers/homework.js";
import { showExams, showExam, startExamAction } from "./handlers/exams.js";

export async function onCallback(env, ctx, chat, mid, data) {
  const db = env.DB;
  const [cmd, arg] = [data.split(":")[0], data.slice(data.indexOf(":") + 1)];
  if (data === "x") { await setState(db, chat, null); return menu(env, chat, "لغو شد.", mid); }
  if (data === "menu") return menu(env, chat, "چی ثبت کنم؟", mid);
  if (cmd === "m") {
    if (["teach", "hw", "exam"].includes(arg)) return askSubject(env, ctx, chat, arg, mid);
    if (arg === "hwlist") return showHomework(env, chat, mid);
    if (arg === "exams") return showExams(env, chat, mid);
  }
  if (cmd === "hp") return showHomework(env, chat, mid, Number(arg));
  if (cmd === "h") return pickHw(env, ctx, chat, Number(arg), mid);
  if (cmd === "ex") return showExam(env, chat, Number(arg), mid);
  if (cmd === "exd") return startExamAction(env, ctx, chat, "examdate", Number(arg), mid);
  if (cmd === "exp") return startExamAction(env, ctx, chat, "exampages", Number(arg), mid);
  if (cmd === "exn") return startExamAction(env, ctx, chat, "examnote", Number(arg), mid);
  if (cmd === "exok") return startExamAction(env, ctx, chat, "examdone", Number(arg), mid);
  if (cmd === "exc") return startExamAction(env, ctx, chat, "examcancel", Number(arg), mid);
  if (cmd === "b") return pickBook(env, ctx, chat, Number(arg), mid);
  const st = await getState(db, chat);
  if (!st || !["confirm", "edit", "pages"].includes(st.step.split(":")[0])) return menu(env, chat, "این پیام منقضی شده؛ دوباره از منو شروع کن 👇");
  if (data === "np") { st.pages = null; return renderConfirm(env, ctx, chat, st, mid); }
  if (data === "nd") { st.details = null; return renderConfirm(env, ctx, chat, st, mid); }
  if (data === "ok") return st.step === "confirm" ? commit(env, ctx, chat, st, mid) : renderConfirm(env, ctx, chat, st, mid);
  if (data === "e") return renderEditMenu(env, chat, st, mid);
  if (data === "back") return renderConfirm(env, ctx, chat, st, mid);
  if (cmd === "f") return askField(env, ctx, chat, st, arg, mid);
  if (cmd === "d" && st.editField) {
    setField(st, st.editField, arg === "none" ? null : arg);
    return renderConfirm(env, ctx, chat, st, mid);
  }
}

export async function onText(env, ctx, chat, text) {
  const db = env.DB;
  if (/^\/(start|menu|cancel)\b/.test(text)) { await setState(db, chat, null); return menu(env, chat); }
  if (/^\/(hw|homework|today)\b/.test(text)) { await setState(db, chat, null); return showHomework(env, chat); }
  if (/^\/exams?\b/.test(text)) { await setState(db, chat, null); return showExams(env, chat); }
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
    if (field === "details" && text.length > 800) return send(env, chat, "توضیحات خیلی طولانیه؛ کوتاه‌تر بنویس (حداکثر ۸۰۰ حرف).");
  }
  setField(st, field, value);
  if (step === "covers") { st.step = "pages"; await setState(db, chat, st); return send(env, chat, "صفحه‌های امتحان؟ (مثلاً ۱-۲۰)", kb([[btn("ندارد", "np")], CANCEL])); }
  return renderConfirm(env, ctx, chat, st);
}
