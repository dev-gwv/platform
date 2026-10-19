# Open items (kept for the owner, 17 Oct 2026)

What is waiting, and on whom. Update this file when an item is done.

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
3. **Meta business verification and App Review** (Facebook dashboards): lead ads into the CRM
   for every studio, and WhatsApp from our own number. Check-prompt: `docs/meta-app-review.md`.
4. **Android release key**: add `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD` as
   GitHub repository secrets, so the APK opens full screen (`docs/apps.md`).
5. **Claude GitHub app** on the repository (https://github.com/apps/claude/installations/select_target),
   so Claude hears CI results and review comments on its pull requests.
6. **Decide**: WhatsApp from our own number through Meta directly (no reseller) -- yes or no.
7. **Enquiry form (0270), once live**: Leads → **Form & QR**. Check the WhatsApp number the
   chats open with (it falls back to the invoice phone, then the owner's), send yourself one
   enquiry from a phone, and tell studios their old vendor QR codes are now partners -- same
   printed code, same page link.

## On Claude (ready to build once the owner says)

1. **Email + WhatsApp message credits** in every plan (about two days; claim a migration
   number first). Needs items 2 and 6 above.
2. **Replies by email into the app** (Resend inbound), after the Resend upgrade.
