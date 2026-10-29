// Writes the confirmed entry to D1.
import { tehranToday, fa, shortDate, trunc } from "../lib/util.js";
import { edit, menu } from "../telegram.js";
import { setState, tocLabel } from "../db.js";

export async function commit(env, ctx, chat, st, mid) {
  const db = env.DB, today = tehranToday();
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
    await db.prepare("UPDATE toc SET taught=1 WHERE book_id=? AND kind='lesson' AND start_page>0 AND start_page<=? AND taught=0").bind(b.id, st.page).run();
  } else if (st.mode === "hw") {
    await db.prepare("INSERT INTO homework(book_id,description,due_date,status,assigned_date,notes) VALUES(?,?,?,'todo',?,'telegram-bot')").bind(b.id, st.text, st.due || null, st.date).run();
    note = `✅ تکلیف ثبت شد: ${b.subject}`;
  } else if (st.mode === "exam") {
    const dup = await db.prepare("SELECT id FROM exams WHERE book_id=? AND exam_date=? AND covers=? AND status='upcoming'").bind(b.id, st.date, st.covers).first();
    if (dup) note = "این امتحان قبلاً ثبت شده بود.";
    else {
      await db.prepare("INSERT INTO exams(book_id,exam_date,covers,page_from,page_to,details,status,notes) VALUES(?,?,?,?,?,?,'upcoming','telegram-bot')").bind(b.id, st.date, st.covers, st.pages?.[0] ?? null, st.pages?.[1] ?? null, st.details || null).run();
      note = `✅ امتحان ${b.subject} ثبت شد (${shortDate(st.date)})`;
    }
  } else if (st.mode === "done") {
    const r = await db.prepare("UPDATE homework SET status='done', done_at=? WHERE id=? AND status='todo'").bind(st.date, st.hw_id).run();
    note = r.meta?.changes ? `✅ تیک خورد: ${trunc(st.desc, 80)}` : "این تکلیف دیگه فعال نیست.";
  } else if (st.mode === "examdate") {
    // Changing the date of an exam archived today means it was postponed: reopen it.
    await db.prepare("UPDATE exams SET exam_date=?, status=CASE WHEN status='done' THEN 'upcoming' ELSE status END, closed_at=CASE WHEN status='done' THEN NULL ELSE closed_at END, notes=COALESCE(notes||' | ','')||? WHERE id=? AND (status='upcoming' OR (status='done' AND closed_at=?))")
      .bind(st.date, `تاریخ از ${st.oldDate} به ${st.date} تغییر کرد (bot)`, st.exam_id, today).run();
    note = `✅ تاریخ امتحان شد ${shortDate(st.date)}${st.reopenArchived ? "\nامتحان دوباره به فهرست فعال برگشت." : ""}`;
  } else if (st.mode === "exampages") {
    await db.prepare("UPDATE exams SET page_from=?, page_to=? WHERE id=?").bind(st.pages?.[0] ?? null, st.pages?.[1] ?? null, st.exam_id).run();
    note = st.pages ? `✅ صفحه‌های امتحان شد ${fa(st.pages[0])} تا ${fa(st.pages[1])}` : "✅ صفحه‌های امتحان پاک شد.";
  } else if (st.mode === "examnote") {
    await db.prepare("UPDATE exams SET details=? WHERE id=?").bind(st.details || null, st.exam_id).run();
    note = st.details ? "✅ توضیحات امتحان ذخیره شد." : "✅ توضیحات امتحان پاک شد.";
  } else if (st.mode === "examdone" || st.mode === "examcancel") {
    const done = st.mode === "examdone";
    await db.prepare("UPDATE exams SET status=?, closed_at=? WHERE id=?").bind(done ? "done" : "cancelled", done ? st.date : today, st.exam_id).run();
    note = done ? "✅ امتحان بسته شد." : "✅ امتحان لغو شد.";
  }
  await setState(db, chat, null);
  if (mid) await edit(env, chat, mid, note);
  return menu(env, chat, "چیز دیگه‌ای؟");
}
