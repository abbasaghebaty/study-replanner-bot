// Read-only access for everyone who is not the owner: only view homework + exams.
import { visitorMenu } from "../telegram.js";
import { showHomework } from "./homework.js";
import { showExams } from "./exams.js";

export async function onVisitorCallback(env, chat, mid, data) {
  if (data === "menu") return visitorMenu(env, chat, undefined, mid);
  if (data === "m:hwlist") return showHomework(env, chat, mid, 0, true);
  if (data === "m:exams") return showExams(env, chat, mid, true);
  if (data.startsWith("hp:")) return showHomework(env, chat, mid, Number(data.slice(3)) || 0, true);
}

// in groups only commands get an answer (no spam on normal messages); in private chat any text shows the menu
export async function onVisitorText(env, chat, text, isPrivate) {
  if (/^\/(hw|homework|today)\b/.test(text)) return showHomework(env, chat, undefined, 0, true);
  if (/^\/exams?\b/.test(text)) return showExams(env, chat, undefined, true);
  if (/^\/(start|menu)\b/.test(text) || isPrivate) return visitorMenu(env, chat);
}
