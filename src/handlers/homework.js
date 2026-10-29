// Homework list (paginated) + tick-as-done.
import { tehranToday, fa, shortDate, daysLeft, trunc } from "../lib/util.js";
import { show, btn, kb, menu } from "../telegram.js";
import { renderConfirm } from "./flow.js";

const HW_PAGE = 10;

export async function showHomework(env, chat, id, page = 0, readonly = false) {
  const today = tehranToday();
  const where = "h.status='todo' AND (h.due_date IS NULL OR h.due_date>=?)";
  const total = (await env.DB.prepare(`SELECT count(*) n FROM homework h WHERE ${where}`).bind(today).first()).n;
  const back = [btn("🔙 منو", "menu")];
  if (!total) return show(env, chat, id, readonly ? "📋 تکالیف\nتکلیف بازی نیست 🎉" : "📋 تکالیف\nتکلیف بازی نداری 🎉", kb([back]));
  const pages = Math.ceil(total / HW_PAGE);
  page = Math.max(0, Math.min(page, pages - 1));
  const rows = (await env.DB.prepare(
    `SELECT h.id, h.description, h.due_date, b.subject FROM homework h JOIN books b ON b.id=h.book_id WHERE ${where} ORDER BY h.due_date IS NULL, h.due_date, h.id LIMIT ? OFFSET ?`
  ).bind(today, HW_PAGE, page * HW_PAGE).all()).results;
  const base = page * HW_PAGE;
  const lines = rows.map((r, i) =>
    `${fa(base + i + 1)}. ${r.subject}\n   ${trunc(r.description, 120)}\n   ⏰ ${r.due_date ? `${shortDate(r.due_date)} (${daysLeft(r.due_date, today)})` : "بدون مهلت"}`
  );
  const head = `📋 تکالیف پیش‌رو (${fa(total)})${pages > 1 ? ` — صفحهٔ ${fa(page + 1)} از ${fa(pages)}` : ""}`;
  const text = `${head}\n\n${lines.join("\n\n")}${readonly ? "" : "\n\nبرای تیک‌زدن، دکمهٔ تکلیف رو بزن:"}`;
  const buttons = readonly ? [] : rows.map((r, i) => [btn(`✅ ${fa(base + i + 1)}. ${r.subject}: ${trunc(r.description, 28)}`, "h:" + r.id)]);
  const nav = [];
  if (page > 0) nav.push(btn("⬅️ قبلی", "hp:" + (page - 1)));
  if (page < pages - 1) nav.push(btn("بعدی ➡️", "hp:" + (page + 1)));
  return show(env, chat, id, text, kb([...buttons, ...(nav.length ? [nav] : []), back]));
}

export async function pickHw(env, ctx, chat, hwId, id) {
  const h = await env.DB.prepare("SELECT h.id, h.description, b.subject FROM homework h JOIN books b ON b.id=h.book_id WHERE h.id=? AND h.status='todo'").bind(hwId).first();
  if (!h) return menu(env, chat, "این تکلیف دیگه فعال نیست.", id);
  const st = { mode: "done", hw_id: h.id, desc: `${h.subject}: ${trunc(h.description, 200)}`, date: tehranToday() };
  return renderConfirm(env, ctx, chat, st, id);
}
