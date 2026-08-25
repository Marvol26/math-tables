# לוח הכפל

משחק לתרגול לוח הכפל (1×1 עד 10×10) בעברית, לילדה בת 8. תשובות מוקלדות, בלי רמזים, מטבעות על כל שאלה, אוסף מדבקות, פרסים אמיתיים שההורים מגדירים, ומצב אתגר עם שעון (אופציונלי, לעולם לא מעניש). מסך הורים נעול בקוד עם סטטיסטיקות, ניהול פרסים וגיבוי.

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

## שכחתי קוד הורים

במסך הכניסה להורים לחצו על **"שכחתי קוד"**, הקלידו את קוד השחזור בן 6 התווים שקיבלתם בהתקנה, ותוכלו לבחור קוד חדש. **בלי קוד השחזור אין דרך לשחזר קוד שכוח** — לכן חשוב לשמור אותו.

## עדכון האפליקציה

כשמעדכנים את קבצי האפליקציה בשרת, יש **לשנות את הקבוע `VERSION` ב-`sw.js`** ולדחוף (push) לריפו. בלי זה, ה-Service Worker לא יזהה גרסה חדשה והמכשירים ימשיכו להציג את הגרסה הישנה מהמטמון.

## פיתוח מקומי

```bash
npm install --ignore-scripts   # תלות פיתוח יחידה: fake-indexeddb (לבדיקות בלבד)
npm test                        # מריץ את כל הבדיקות (node --test)
python3 -m http.server 8766     # מריץ שרת מקומי מתיקיית הפרויקט
```
פתחו `http://localhost:8766/index.html` בדפדפן. אין שלב build — הקבצים מוגשים כמות שהם.

---

# Math Tables (לוח הכפל)

A Hebrew multiplication-tables (1×1–10×10) practice game for an 8-year-old girl. Typed answers, no hints, coins per question, a sticker collection, parent-defined real rewards, and an optional never-punishing Challenge Mode timer. A PIN-locked parent view has stats, a rewards editor, and backup tools.

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

## Forgot the parent PIN

On the parent entry screen, tap **"שכחתי קוד"** ("forgot PIN"), enter the 6-character recovery code from installation, and set a new PIN. **Without the recovery code there is no way to recover a forgotten PIN** — keep it safe.

## Updating the app

When deploying updated files, **bump the `VERSION` constant in `sw.js`** and push. Without this, the Service Worker won't detect a new version and devices will keep serving the stale cached version.

## Local development

```bash
npm install --ignore-scripts   # single dev dependency: fake-indexeddb (tests only)
npm test                        # runs the full test suite (node --test)
python3 -m http.server 8766     # serves the project root locally
```
Open `http://localhost:8766/index.html`. No build step — files are served as-is.
