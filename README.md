# study-bot

ربات تلگرام برای ثبت تدریس و تکلیف در دیتابیس D1 `study-planner`.
ربات فقط در `progress_log` و `homework` ردیف **اضافه** می‌کند؛ مرور، پیش‌مطالعه و چیدن برنامه با ورکر `study-replanner` است
(کرون ۵ دقیقه‌ای تغییر دیتابیس را تشخیص می‌دهد).

## کار با ربات
1. `/start` → «📚 ثبت تدریس» یا «📝 ثبت تکلیف»
2. درس را با دکمه بزن یا اسمش را بنویس (تطبیق خودکار؛ اگر مبهم بود دکمه نشان می‌دهد)
3. تدریس: شمارهٔ صفحه — تکلیف: متن تکلیف
4. ربات تاریخ را از برنامهٔ هفتگی حدس می‌زند (آخرین روزی که آن درس کلاس داشتی) و خلاصه را نشان می‌دهد.
   «⏪ جلسهٔ قبل‌تر» تاریخ را یک جلسه عقب می‌برد. مهلت تکلیف = جلسهٔ بعدی همان درس.
5. «✅ تأیید» → ثبت در دیتابیس. تمام.

اشتباه ثبت کردی؟ دوباره گزارش درست را ثبت کن (برای تدریس، جدیدترین گزارش ملاک است).

## راه‌اندازی
```bash
cd study-bot
npx wrangler secret put TELEGRAM_TOKEN     # توکن BotFather
npx wrangler secret put WEBHOOK_SECRET     # یک رشتهٔ تصادفی دلخواه
npx wrangler secret put OWNER_CHAT_ID      # اول یک عدد الکی بگذار؛ بعد از /start عدد واقعی را ربات می‌گوید
npx wrangler deploy

curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://study-bot.<subdomain>.workers.dev/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```
بعد به ربات `/start` بده؛ Chat ID را نشان می‌دهد، آن را در `OWNER_CHAT_ID` بگذار و دوباره deploy کن.
جدول `bot_state` خودش ساخته می‌شود.

## پچ ورکر برنامه‌ریز
فایل `planner-preview.patch` را در `study-replanner/src/planner.js` اعمال کن و deploy کن.
