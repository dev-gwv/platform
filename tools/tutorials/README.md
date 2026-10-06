# Tutorial recorder

Every video in `apps/web/public/help/` (English) and `apps/web/public/help/hi/`
(Hindi) is made here, from the real app with real clicks. **When a screen a
video shows changes (a button renamed, a step moved, a page redesigned), its
video is re-recorded in the same pull request**, in both languages.

## What is here
- `lib.mjs` — the recorder: spotlight, pointer, step counter, captions, title
  and end cards, music (`bed.ogg`) and the voice-over.
- `t-<key>.mjs` — one script per tutorial; `<key>` is its key in
  `apps/web/src/features/help/tutorials.ts` and its file name in `public/help/`.
- `seed-*.mjs`, `seeds.mjs`, `helpers.mjs`, `wiz.mjs` — sample data and shared steps.
- `hi.mjs` — the Hindi caption for every English caption (a missing one throws).
- `vo.mjs` — the spoken script for every tutorial, English and Hindi: a title
  line, one line per step, an end line.
- `tts/` — Google Cloud Text-to-Speech, Chirp 3 HD *Aoede* (`en-IN`, `hi-IN`).
  Needs `GOOGLE_SA_EMAIL` and `GOOGLE_SA_PRIVATE_KEY` in the environment (a
  service account on the owner's Google project with the API on). Never print
  or commit them. Spoken clips are cached in `tts/clips/` (not committed).

## Rules (the owner reviews these)
- 4–6 steps, 30–60 seconds. Plain captions under ~55 characters.
- Indian sample data (Priya Sharma, Ravi Kumar, ₹, Haldi / Wedding / Reception).
- Every step's spotlight on the right control; the result shown working, never
  an error toast.
- Each step waits for the voice to finish; the video ends ~2.5 s after the last word.

## Recording one
1. Run the API and web app locally against a fresh database (`bun run dev`, or
   the API on a spare port with `API=http://localhost:<port>`).
2. `TZ=Asia/Kolkata node t-<key>.mjs` → `final/<key>.mp4` + `.jpg`.
   `TUT_LANG=hi` records the Hindi one into `final/hi/`.
   Set `FFMPEG` if `ffmpeg` is not on the PATH, and `PLAYWRIGHT_MODULE` to
   Playwright's `index.mjs` if it is not at the default path.
3. Check it: a contact sheet, read frame by frame:
   `ffmpeg -i final/<key>.mp4 -vf "fps=1/3,scale=640:-1,tile=4x4" -frames:v 1 sheet.png`
4. Copy `final/<key>.mp4/.jpg` (and `final/hi/…`) into `apps/web/public/help/`
   (`…/help/hi/`) and set `seconds` in `TUTORIALS` to the new length.

## Adding one
Write `t-<key>.mjs` (copy a close one), add its lines to `vo.mjs` and its
captions to `hi.mjs`, record both languages, then add the key to `TUTORIALS`
(with `hi: { title, blurb }`), `SHIPPED`, and — if it belongs in the guide — a
chapter in `features/help/guide.ts`.
