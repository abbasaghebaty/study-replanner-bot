// Telegram API wrappers + keyboard helpers + main menu.

export const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then((r) => r.json());

export const send = (env, chat, text, kb) => tg(env, "sendMessage", { chat_id: chat, text, ...(kb ? { reply_markup: kb } : {}) });
export const edit = (env, chat, id, text, kb) => tg(env, "editMessageText", { chat_id: chat, message_id: id, text, ...(kb ? { reply_markup: kb } : {}) });
export const show = (env, chat, id, text, kb) => (id ? edit(env, chat, id, text, kb) : send(env, chat, text, kb)); // edit if we have a message, else send

export const btn = (text, data) => ({ text, callback_data: data });
export const kb = (rows) => ({ inline_keyboard: rows });
export const chunk = (a, n) => a.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);
export const CANCEL = [btn("❌ لغو", "x")];

export const MENU = kb([
  [btn("📚 ثبت تدریس", "m:teach"), btn("📝 ثبت تکلیف", "m:hw")],
  [btn("🎓 امتحان جدید", "m:exam")],
  [btn("📋 تکالیف", "m:hwlist"), btn("🗂 امتحان‌ها", "m:exams")]
]);
export const menu = (env, chat, text = "چی ثبت کنم؟", id) => show(env, chat, id, text, MENU);
export const subjectKb = (books) => kb([...chunk(books.map((b) => btn(b.subject, "b:" + b.id)), 2), CANCEL]);

// visitor (read-only) menu
export const VISITOR_MENU = kb([[btn("📋 تکالیف", "m:hwlist"), btn("🗂 امتحان‌ها", "m:exams")]]);
export const visitorMenu = (env, chat, text = "سلام 👋 اینجا می‌تونی تکالیف و امتحان‌های پیش‌رو رو ببینی:", id) => show(env, chat, id, text, VISITOR_MENU);
