// Exam list, exam detail screen, edit actions (date / pages / notes / done / cancel).
import { tehranToday, fa, niceDate, shortDate, daysLeft, trunc } from "../lib/util.js";
import { show, btn, kb, menu } from "../telegram.js";
import { renderConfirm, askField } from "./flow.js";

async function getExam(env, exId) {
  return env.DB.prepare("SELECT e.*, b.subject FROM exams e JOIN books b ON b.id=e.book_id WHERE e.id=? AND e.status='upcoming' AND e.exam_date>=?").bind(exId, tehranToday()).first();
}

export async function showExams(env, chat, id, readonly = false) {
  const today = tehranToday();
  const rows = (await env.DB.prepare(
    "SELECT e.id, e.exam_date, e.covers, e.page_from, e.page_to, e.details, b.subject FROM exams e JOIN books b ON b.id=e.book_id WHERE e.status='upcoming' AND e.exam_date>=? ORDER BY e.exam_date, e.id"
  ).bind(today).all()).results;
  const back = [btn("🔙 منو", "menu")];
  if (!rows.length) return show(env, chat, id, "🗂 امتحان فعالی نیست.", kb([back]));
  const lines = rows.map((r, i) => {
    let s = `${fa(i + 1)}. ${r.subject} — ${shortDate(r.exam_date)} (${daysLeft(r.exam_date, today)})\n   📖 ${trunc(r.covers, 80)}`;
    s += r.page_from != null ? `\n   📄 صفحه‌های ${fa(r.page_from)} تا ${fa(r.page_to)}` : "\n   📄 صفحه‌ها: هنوز ثبت نشده";
    if (!readonly && r.details) s += `\n   📌 ${trunc(r.details, 100)}`; // teacher notes are private: owner only
    return s;
  });
  const text = `🗂 امتحان‌های پیش‌رو (${fa(rows.length)})\n\n${lines.join("\n\n")}${readonly ? "" : "\n\nبرای ویرایش (تاریخ، صفحه‌ها، توضیحات) روی امتحان بزن:"}`;
  const buttons = readonly ? [] : rows.map((r, i) => [btn(`${fa(i + 1)}. ${r.subject} — ${shortDate(r.exam_date)}`, "ex:" + r.id)]);
  return show(env, chat, id, text, kb([...buttons, back]));
}

export async function showExam(env, chat, exId, id) {
  const e = await getExam(env, exId);
  if (!e) return menu(env, chat, "این امتحان دیگه فعال نیست.", id);
  const pages = e.page_from != null ? `${fa(e.page_from)} تا ${fa(e.page_to)}` : "هنوز ثبت نشده";
  return show(
    env, chat, id,
    `🎓 ${e.subject}\nمبحث: ${e.covers}\nصفحه‌ها: ${pages}\nتاریخ: ${niceDate(e.exam_date)}\n📌 توضیحات: ${e.details || "ندارد"}`,
    kb([
      [btn("📅 تغییر تاریخ", "exd:" + e.id), btn("📄 ویرایش صفحه‌ها", "exp:" + e.id)],
      [btn("📌 توضیحات", "exn:" + e.id)],
      [btn("✔️ برگزار شد", "exok:" + e.id), btn("🚫 لغو امتحان", "exc:" + e.id)],
      [btn("🔙 برگشت", "m:exams")]
    ])
  );
}

export async function startExamAction(env, ctx, chat, kind, exId, id) {
  const e = await getExam(env, exId);
  if (!e) return menu(env, chat, "این امتحان دیگه فعال نیست.", id);
  const pages = e.page_from != null ? [e.page_from, e.page_to] : null;
  const st = { mode: kind, exam_id: e.id, book_id: e.book_id, label: `${e.subject}: ${trunc(e.covers, 60)}`, oldDate: e.exam_date, oldPages: pages, oldDetails: e.details || null };
  if (kind === "examdate") { st.date = e.exam_date; return askField(env, ctx, chat, st, "date", id); }
  if (kind === "exampages") { st.pages = pages; return askField(env, ctx, chat, st, "pages", id); }
  if (kind === "examnote") { st.details = e.details || null; return askField(env, ctx, chat, st, "details", id); }
  return renderConfirm(env, ctx, chat, st, id);
}
