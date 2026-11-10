# Open items (kept for the owner, 17 Oct 2026)

What is waiting, and on whom. Update this file when an item is done.

## Morning checklist (10 Nov) -- everything that waits on the owner, in order

1. **Claude GitHub app** on the repository: https://github.com/apps/claude/installations/select_target
   (so Claude hears CI results and review comments on its pull requests).
2. **Meta Access Verification** -- deadline **26 Dec 2026**. Ask Meta developer support, quoting
   App ID 4492691704338819 and the 29 Sept submission (item 3 below has the detail).
3. **Sample photos** for the Quotation Designer: 8-10 wedding photos you are happy to show every studio.
4. **Aditya's login**: Studio Access Manager → **Find a login** → adityaagarwal843113@gmail.com (item 1 below).
5. **Support call alerts**: the iCal address, `WA_BOT_SECRET`, the bot QR, the appointment-schedule
   link -- step by step in `docs/support-calls.md` (item 8 below).
6. **Android release key**: `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD` as GitHub secrets.
7. **Decide**: the Resend paid plan (automatic emails), and WhatsApp from our own number via Meta.
8. **Decide** the five open points from the 6 Nov bug sweep (item 10 below).
9. **After referral cards ship**: Settings → Referrals → **Defaults** -- what a friend gets and what
   your client gets for each friend who books.

The AI key (`AI_API_KEY`) is already on the server (owner, 10 Nov): the assistant, the designer's
Write it for me, Reply with AI and the sequence maker all use that one key. To confirm, Platform →
Help console shows the assistant as ready.

## On the owner (needs a dashboard, money or a key Claude cannot reach)

1. **Aditya (adityaagarwal843113@gmail.com) cannot open his studio.** OMS Wedding Studio
   shows Active to 17 Nov in Studio Access Manager, yet his sign-in lands on "Plan expired".
   Once 0269 is live: Studio Access Manager → **Find a login** → his email. It lists every
   studio his login opens. Give the expired one 30 days, or press **Open this one first** on
   OMS, then ask him to sign out and in. If "No login signs in with …" shows, ask him which
   email he types on the sign-in page.
2. **Resend paid plan** (about $20 a month, 50,000 emails). Then add `EMAIL_EVERY_KIND=on` to
   `/root/ipc/platform/.env` on the VPS and run `sh deploy/deploy.sh` (never a bare
   `docker compose`). Decided 17 Oct: email work comes later.
3. **Meta Access Verification, pending since 29 Sept** (checked 27 Oct). App Review for
   Studio AutoPilot (App ID 4492691704338819) was **approved on 16 Oct**: leads_retrieval,
   pages_manage_metadata, pages_read_engagement, pages_show_list, business_management. The app
   is Live and the business (Grateful World Ventures, ID 822350745034082) is verified. Only
   **Access Verification** is still "In review" (Meta says about 5 business days; it has been
   four weeks), with no request for anything from us and a deadline: **must be completed by
   26 Dec 2026** or one app is restricted. It may be what lets studios outside our business
   connect their Pages. To do: have one outside studio press **Connect with Facebook** on
   Leads → Setup and send a test lead; and ask Meta developer support now, quoting the App ID
   and the 29 Sept submission. Not this app, but seen on the same check: 15 inactive ad
   accounts close on 9 Nov (Security Centre). WhatsApp from our own number is separate
   (item 6). Check-prompt: `docs/meta-app-review.md`.
4. **Android release key**: add `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD` as
   GitHub repository secrets, so the APK opens full screen (`docs/apps.md`).
5. **Claude GitHub app** on the repository (https://github.com/apps/claude/installations/select_target),
   so Claude hears CI results and review comments on its pull requests.
6. **Decide**: WhatsApp from our own number through Meta directly (no reseller) -- yes or no.
7. **Enquiry form (0274), once live**: Leads → **Form & QR**. Check the WhatsApp number the
   chats open with (it falls back to the invoice phone, then the owner's), send yourself one
   enquiry from a phone, and tell studios their old vendor QR codes are now partners -- same
   printed code, same page link.
8. **Support call alerts** -- step by step in `docs/support-calls.md`: (a) make a Google Calendar
   that holds only support calls, and paste its **Secret address in
   iCal format** on Platform → **Support calls**; (b) add `WA_BOT_SECRET` (`openssl rand -hex 32`)
   to `/root/ipc/platform/.env` and run `sh deploy/deploy.sh`; (c) scan the QR (your own number to
   test, a **spare SIM** for real), add it to the support group, pick the group, switch it on, send a
   test and **Try a sample booking**; (d) make a Google Calendar **appointment schedule** that books
   into that calendar and paste its booking link on Platform → Help → "Where Book a support call
   goes" (it still points at the old booking app until then).
   Messages to the person who booked wait for Meta's API.

9. **Sample photos for the Quotation Designer**: send 8-10 wedding photos you are happy to
   show every studio (stock photo sites cannot be reached from Claude's machine).
10. **Decide (from the 6 Nov bug sweep)**: the refresh-token window, the database grants the
    API alone guards today, phone numbers typed with a leading 0, a no-login member using
    Forgot password, a server-side seat count on bookings.

## On Claude (ready to build once the owner says)

0. **AI tools live (9 Nov)**: the Quotation Designer (steps 1-5), Reply with AI and the
   Follow-up sequence maker. **Building now (10 Nov): referral cards** (0298) -- a WhatsApp
   card per booked client with the friend's offer, code and QR; the friend's offer on their
   invoice by itself; the client's reward due when the friend books. Next: a review collector.

1. **Email + WhatsApp message credits** in every plan (about two days; claim a migration
   number first). Needs items 2 and 6 above.
2. **Replies by email into the app** (Resend inbound), after the Resend upgrade.
