# לוח הכפל

משחק לתרגול לוח הכפל (1×1 עד 10×10) בעברית, לילדה בת 8. תשובות מוקלדות, בלי רמזים, מטבעות על כל שאלה, אוסף מדבקות, פרסים אמיתיים שההורים מגדירים, מצב אתגר עם צב שהולך לדגל (אופציונלי, לעולם לא מעניש), ציור של נקודות אחרי טעות, ומפת מסע עם 10 תחנות — תחנה לכל לוח (×1 → ×2 → ×10 → ×5 → ×3 → ×4 → ×6 → ×9 → ×8 → ×7) שנדלקת כשכל 10 התרגילים שלה נלמדו לגמרי; תחנה שהושגה לא נכבית. מסך הורים נעול בקוד עם סטטיסטיקות, ניהול פרסים וגיבוי.

🔗 **המשחק חי כאן:** https://marvol26.github.io/math-tables/

## מספרים נופלים 🎈 (מצב משחק נוסף)

מצב אופציונלי: במקום להקליד, מספר תרגיל מוצג למעלה ותשובות אפשריות "נופלות" מלמעלה בבועות — לוחצים על התשובה הנכונה (או מקישים 1–4/5/6 במחשב). תשובה נכונה לפני שהבועה נוחתת = מטבעות כפולים; אם הבועות נוחתות לפני שבוחרים, אפשר עדיין ללחוץ בנחת ולקבל מטבעות רגילים — אף תשובה לא נספרת כטעות. תשובה לא נכונה מציגה את אותו ציור-נקודות שמסביר את התרגיל, והוא נשאל שוב בסוף הסבב. המצב כבוי כברירת מחדל; ההורים מפעילים אותו במסך ההורים ← הגדרות (מתג הפעלה, זמן נפילה 3–20 שניות, ומספר בועות 4–6). מטבעות ומדבקות כן נספרים; **המצב הזה לא משפיע על "נלמד לגמרי", על מפת המסע, ועל התרגילים שחוזרים בין סבבים** — הוא אימון זיהוי, לא תרגול שינון.

## בונים קיר 🧱 (מצב משחק שלישי)

מצב שלישי, «בונים קיר»: התרגיל הוא מלבן שנופל לתוך קיר; בוחרים עמודה ותשובה, וכשהקיר מתמלא בונים קיר חדש. כבוי כברירת מחדל.

## תרגול בשני הכיוונים (V2-DESIGN §8)

כל תרגיל חדש נשאל מיד גם הפוך (4×5 ואז 5×4); עובדה נחשבת "נלמדה לגמרי" רק כששני הכיוונים נענו נכון ומהר.

## התקנה על iPad / iPhone

1. פתחו את הכתובת של המשחק ב**Safari** (לא בדפדפן אחר — רק Safari תומך בהוספה למסך הבית באייפד/אייפון).
2. לחצו על כפתור השיתוף ⬆️.
3. בחרו **"הוספה למסך הבית"**.
4. בפעם הראשונה תתבקשו להגדיר שם, קוד הורים בן 4 ספרות, וקוד שחזור (כתבו אותו במקום בטוח!).

**⚠️ חשוב: הסרת האפליקציה ממסך הבית מוחקת את כל ההתקדמות** (מטבעות, מדבקות, סטטיסטיקות) — אין אחסון בענן. גבו באופן קבוע דרך מסך ההורים (ראו למטה).

## גיבוי, שחזור וביטול

במסך ההורים (הקוד שהגדרתם בהתקנה):
- **ייצוא גיבוי** — מוריד קובץ `math-progress-YYYY-MM-DD.json`. שמרו אותו במקום בטוח (Google Drive, iCloud וכו').
- **ייבוא מקובץ** — משחזר מקובץ גיבוי. יוצג תצוגה מקדימה (כמה סבבים, כמה מטבעות) לפני האישור, ותידרש הקלדת קוד ההורים.
- **ביטול הפעולה האחרונה** — משחזר את המצב שהיה קיים ממש לפני הייבוא או האיפוס האחרון (שלב אחד בלבד לאחור).
- **איפוס כל הנתונים** — מוחק את כל ההתקדמות אך שומר את קוד ההורים. דורש הקלדת המילה "מחק" בדיוק, בנוסף לקוד.

## גיבוי אוטומטי לענן (מומלץ)
האפליקציה יכולה לשמור אחרי כל סבב עותק ב-Gist **פרטי** בחשבון GitHub שלכם — בלי שרת ובלי סיסמאות בקוד.
1. ב-GitHub: Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token. סמנו **רק** את ההרשאה `gist`. בחרו תפוגה ארוכה (או No expiration).
2. באפליקציה: הורים → קוד → **גיבוי אוטומטי לענן** → הדביקו את ה-Token → **שמירה ובדיקה**. מעכשיו כל סבב שמסתיים מגובה אוטומטית.
3. במכשיר חדש: במסך ההגדרה הראשון הדביקו את אותו Token → **שחזור מהענן**, ואז בחרו שם וקוד.
ה-Token נשמר רק על המכשיר (לא בקובץ הייצוא ולא בקוד). אם ה-Token דלף — מחקו אותו ב-GitHub וצרו חדש. ה-Gist הוא "סודי" (secret): לא מופיע בפרופיל, אבל מי שמחזיק בקישור יכול לקרוא אותו — אין בו קוד הורים. חשבון אחד = ילדה אחת (הגיבוי האוטומטי משתמש ב-Gist האחרון שנמצא בחשבון).

## ייצוא ידני ב-iPad
לחיצה על **ייצוא גיבוי** פותחת את חלון השיתוף של iOS — בחרו **Save to Files / שמירה בקבצים** ושמרו ב-iCloud Drive. (פתיחה רגילה של הקובץ בדפדפן מציגה אותו בלבד ואינה שומרת.)

## שכחתי קוד הורים

במסך הכניסה להורים לחצו על **"שכחתי קוד"**, הקלידו את קוד השחזור בן 6 התווים שקיבלתם בהתקנה, ותוכלו לבחור קוד חדש. **בלי קוד השחזור אין דרך לשחזר קוד שכוח** — לכן חשוב לשמור אותו.

## עדכון האפליקציה

כשמעדכנים את קבצי האפליקציה, מריצים **`node tools/bump-version.js <x.y.z>`** ודוחפים (push) לריפו. הכלי קובע את גרסת האפליקציה, מחשב חתימת תוכן לכל קובץ שמוגש ומעדכן את שם המטמון של ה-Service Worker — בלי זה `npm test` נכשל. בלי הריצה הזו ה-Service Worker לא יזהה גרסה חדשה והמכשירים ימשיכו להציג את הגרסה הישנה מהמטמון.

## פיתוח מקומי

```bash
npm install --ignore-scripts   # שתי תלויות פיתוח בלבד: `fake-indexeddb` ו-`linkedom`
npm test                        # מריץ את כל הבדיקות (node --test)
python3 -m http.server 8766     # מריץ שרת מקומי מתיקיית הפרויקט
```
פתחו `http://localhost:8766/index.html` בדפדפן. אין שלב build — הקבצים מוגשים כמות שהם.

---

# Math Tables (לוח הכפל)

A Hebrew multiplication-tables (1×1–10×10) practice game for an 8-year-old girl. Typed answers, no hints, coins per question, a two-album, 48-sticker collection (a second album unlocks once the first is complete; some stickers turn "golden" as journey-map stations are reached), parent-defined real rewards, an optional never-punishing Challenge Mode (a turtle walking to a flag), a dot-array picture after a wrong answer, a small cheering "audience" of unlocked stickers on the question screen, a parent-adjustable session length (10–20 questions per round), and a journey map of 10 stations — one per table in learning order (×1 → ×2 → ×10 → ×5 → ×3 → ×4 → ×6 → ×9 → ×8 → ×7) — that light up when all 10 facts of a table are mastered and never go dark again. A PIN-locked parent view has stats, a rewards editor, and backup tools.

🔗 **Live at:** https://marvol26.github.io/math-tables/

## Falling numbers 🎈 (a second game mode)

An optional mode: instead of typing, the expression is shown at the top and candidate answers fall from the top in bubbles — tap the correct one (or press keys 1–4/5/6 on a computer). A correct answer before the bubble lands doubles the coins; if the bubbles land first you can still tap calmly for regular coins — landing is never counted as a miss. A wrong tap shows the same dot-picture explanation as typed mode and the fact is re-asked at the end of that session. Off by default; parents enable it from the parent view → settings (an enable switch, fall time 3–20 seconds, and 4–6 bubbles). Coins and stickers count, and since 2026-08-28 correct taps also count towards "mastered" and the journey map, exactly like typed answers; the only difference is that facts missed in this mode are not carried over into the next typed session.

## Build the wall 🧱 (a third game mode)

A third mode, "build the wall": the exercise is a rectangle falling into a well; you pick a column and an answer, and when the wall fills up you build a fresh one. Off by default.

## Practising both directions (V2-DESIGN §8)

Every brand-new fact is immediately asked in its mirror direction too (4×5, then 5×4), and a fact only counts as "mastered" once both directions have been answered correctly and quickly.

## Install on iPad / iPhone

1. Open the game's URL in **Safari** (required — only Safari supports Add to Home Screen on iOS).
2. Tap the Share button ⬆️.
3. Choose **"Add to Home Screen"**.
4. On first launch you'll set a name, a 4-digit parent PIN, and a recovery code (write it down somewhere safe!).

**⚠️ Important: uninstalling the Home-Screen app deletes all progress** (coins, stickers, stats) — there is no cloud storage. Back up regularly from the parent view (see below).

## Backup, restore, and undo

In the parent view (the PIN you set at install):
- **Export backup** — downloads a `math-progress-YYYY-MM-DD.json` file. Keep it somewhere safe.
- **Import from file** — restores from a backup file. Shows a preview (session count, coin total) before confirming, and requires the parent PIN.
- **Undo last action** — restores the state from immediately before the last import or reset (one level back only).
- **Reset all data** — wipes all progress but keeps the parent PIN. Requires typing the exact word "מחק" (delete) plus the PIN.

## Automatic cloud backup (recommended)
After every session the app can save a copy to a **private Gist** in your GitHub account — no server, no secrets in the code.
1. GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token with **only** the `gist` scope (long or no expiration).
2. In the app: parents → PIN → **גיבוי אוטומטי לענן** → paste the token → **שמירה ובדיקה**. Every completed session is then backed up automatically.
3. On a new device: on the first setup screen paste the same token → **שחזור מהענן**, then choose a name and PIN.
The token lives only on the device (never in export files or the code). If it leaks, revoke it on GitHub and create a new one. The gist is *secret* (unlisted, readable by anyone with the link; it contains no PIN). One GitHub account = one child (auto-backup uses the newest backup gist in the account).

## Manual export on iPad
**ייצוא גיבוי** opens the iOS share sheet — choose **Save to Files** (iCloud Drive). Opening the file in the browser only previews it and does not save.

## Forgot the parent PIN

On the parent entry screen, tap **"שכחתי קוד"** ("forgot PIN"), enter the 6-character recovery code from installation, and set a new PIN. **Without the recovery code there is no way to recover a forgotten PIN** — keep it safe.

## Updating the app

When deploying updated files, run **`node tools/bump-version.js <x.y.z>`** and push. It sets the app version, content-hashes every deployable asset, and rewrites the Service Worker's cache name — `npm test` fails otherwise. Without this, the Service Worker won't detect a new version and devices will keep serving the stale cached version.

## Local development

```bash
npm install --ignore-scripts   # two dev dependencies, both test-only: fake-indexeddb and linkedom
npm test                        # runs the full test suite (node --test)
python3 -m http.server 8766     # serves the project root locally
```
Open `http://localhost:8766/index.html`. No build step — files are served as-is.
