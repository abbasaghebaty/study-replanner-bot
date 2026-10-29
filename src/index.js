// study-replanner-bot — entry point only: webhook auth + dispatch.
// Features live in: router.js, handlers/*.js, db.js, telegram.js, lib/*.js
// Needs D1 column: exams.details (already added).
import { send, tg, MENU } from "./telegram.js";
import { loadCtx } from "./db.js";
import { onCallback, onText } from "./router.js";
import { onInlineQuery } from "./handlers/inline.js";

async function handle(env, u) {
  if (u.inline_query) return onInlineQuery(env, u.inline_query);

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
    let u = null;
    try {
      u = await request.json();
      await handle(env, u);
    } catch (e) {
      console.error("bot error", e); // always answer 200 so Telegram doesn't retry-storm
      const chat = u?.callback_query?.message?.chat?.id ?? u?.message?.chat?.id;
      if (chat && env.OWNER_CHAT_ID && String(chat) === String(env.OWNER_CHAT_ID)) {
        await send(env, chat, "⚠️ خطایی پیش اومد و این مورد ثبت نشد. دوباره از منو امتحان کن.", MENU).catch(() => {});
      }
    }
    return new Response("ok");
  }
};
export { parseDate, j2g } from "./lib/dates.js";
