// Inline mode: type @bot_username in ANY chat → two options (exams / homework).
// Tapping one sends that list into the chat as a message from you (via @bot).
import { tehranToday, fa, norm, shortDate, daysLeft, trunc } from "../lib/util.js";
import { tg } from "../telegram.js";

// Teacher/notes (exams.details) are personal; set to true if you want them in the message sent to friends.
const INCLUDE_DETAILS = false;

const ALIASES = {
  hw: ["تکالیف", "تکلیف", "hw", "homework"],
  exams: ["امتحانها", "امتحان", "exam", "exams"]
};
const wanted = (key, q) => !q || ALIASES[key].some((a) => norm(a).includes(q));
const fit = (s) => (s.length > 4000 ? s.slice(0, 3999) + "…" : s); // Telegram limit 4096

async function homeworkList(env) {
  const today = tehranToday();
  const rows = (await env.DB.prepare(
    "SELECT h.description, h.due_date, b.subject FROM homework h JOIN books b ON b.id=h.book_id WHERE h.status='todo' AND (h.due_date IS NULL OR h.due_date>=?) ORDER BY h.due_date IS NULL, h.due_date, h.id"
  ).bind(today).all()).results;
  if (!rows.length) return { count: 0, text: "📋 تکالیف\nتکلیف بازی نیست 🎉" };
  const lines = rows.map((r, i) =>
    `${fa(i + 1)}. ${r.subject}\n   ${trunc(r.description, 200)}\n   ⏰ ${r.due_date ? `${shortDate(r.due_date)} (${daysLeft(r.due_date, today)})` : "بدون مهلت"}`
  );
  return { count: rows.length, text: fit(`📋 تکالیف پیش‌رو (${fa(rows.length)})\n\n${lines.join("\n\n")}`) };
}

async function examList(env) {
  const today = tehranToday();
  const rows = (await env.DB.prepare(
    "SELECT e.exam_date, e.covers, e.page_from, e.page_to, e.details, b.subject FROM exams e JOIN books b ON b.id=e.book_id WHERE e.status='upcoming' AND e.exam_date>=? ORDER BY e.exam_date, e.id"
  ).bind(today).all()).results;
  if (!rows.length) return { count: 0, text: "🗂 امتحان فعالی نیست." };
  const lines = rows.map((r, i) => {
    let s = `${fa(i + 1)}. ${r.subject} — ${shortDate(r.exam_date)} (${daysLeft(r.exam_date, today)})\n   📖 ${trunc(r.covers, 120)}`;
    s += r.page_from != null ? `\n   📄 صفحه‌های ${fa(r.page_from)} تا ${fa(r.page_to)}` : "\n   📄 صفحه‌ها: هنوز مشخص نیست";
    if (INCLUDE_DETAILS && r.details) s += `\n   📌 ${trunc(r.details, 150)}`;
    return s;
  });
  return { count: rows.length, text: fit(`🗂 امتحان‌های پیش‌رو (${fa(rows.length)})\n\n${lines.join("\n\n")}`) };
}

export async function onInlineQuery(env, iq) {
  const answer = (results) =>
    tg(env, "answerInlineQuery", { inline_query_id: iq.id, results, cache_time: 0, is_personal: true });

  // only the owner gets results (user id == private chat id)
  if (!env.OWNER_CHAT_ID || String(iq.from.id) !== String(env.OWNER_CHAT_ID)) return answer([]);

  const q = norm(iq.query || "");
  const results = [];
  if (wanted("exams", q)) {
    const r = await examList(env);
    results.push({
      type: "article",
      id: "exams",
      title: "🗂 امتحان‌ها",
      description: r.count ? `ارسال لیست ${fa(r.count)} امتحان پیش‌رو` : "امتحان فعالی نیست",
      input_message_content: { message_text: r.text }
    });
  }
  if (wanted("hw", q)) {
    const r = await homeworkList(env);
    results.push({
      type: "article",
      id: "hw",
      title: "📋 تکالیف",
      description: r.count ? `ارسال لیست ${fa(r.count)} تکلیف باز` : "تکلیف بازی نیست",
      input_message_content: { message_text: r.text }
    });
  }
  return answer(results);
}
