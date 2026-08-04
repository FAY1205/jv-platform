# How to test the app (no coding required)

Your job here is simple: **use the app like a real user and confirm it does the right
thing.** You don't need to read any code — the code is checked automatically (258
passing tests). This guide is a click-through checklist. For each step: *do the action*,
then check *what you should see*.

**Open:** http://localhost:4000
**Log in with:**
- Email: `dev-admin@dev-jv.test`
- Password: `Dev-Admin-Pass-2026!x`

> If the site isn't loading, the app may have stopped — just ask me to start it again.

---

## Test 1 — Sign in
1. Go to http://localhost:4000/login
2. Enter the email and password above → click **Sign in**.
- ✅ **You should see:** you land on the **Runs** page (a list). If you type the wrong
  password, you get a generic "Invalid email or password" — that's intentional.

## Test 2 — The main product: a routed weekly run  ⭐ (most important)
This is the heart of the product — a weekly lead file turned into a partner-routed result.
1. On the **Runs** list, click **UP-2026-001**.
- ✅ **You should see:** a summary (uploaded / matched / removed / unmatched counts), a
  **colored bar** showing how leads split across partners, and each partner's leads with a
  **colored stripe + the partner's name + a JV-### reference**. Lower down: a **Removed**
  section (leads filtered out because they're already listed on MLS) and an **Unmatched**
  section (leads with no partner for that area).
2. Click **Download** (top of the page).
- ✅ **You should see:** an Excel file downloads. Open it → leads are **grouped by partner
  with color fills**, plus a color legend sheet and a summary sheet. *This is the file a
  partner would receive.*

## Test 3 — Upload a real week  ⭐ (this is the pending "real week" sign-off)
1. Click **Upload** (or go to http://localhost:4000/upload).
2. Drag in one of your real InvestorFuse export files (e.g. from your Downloads:
   `investorfuse-opportunity-export (27).xlsx`).
- ✅ **You should see:** it recognizes the file format, shows honest step-by-step progress,
  then takes you to a results page just like Test 2 — a routed ledger you can download.
- ℹ️ **Expected quirk:** your real files are **national**. Leads in areas we have coverage
  for get routed to partners; the rest land in **Unmatched** (that's correct — we haven't
  loaded your real territory map yet; that's a later step). So seeing a lot of "unmatched"
  is normal for now.
- **This is the Phase-1 sign-off:** if the routed result + downloaded Excel match what you'd
  expect to send partners for that week, Phase 1 is confirmed.

## Test 4 — Void a run (undo a mistake)
1. Open any run (e.g. UP-2026-001) → click **Void** → type a short reason → confirm.
- ✅ **You should see:** the run gets a **"voided"** badge and shows your reason. (Voided
  runs are excluded from future duplicate-checking but nothing is deleted.)

## Test 5 — Change your password
1. Go to http://localhost:4000/account/password
2. Enter your current password + a new one (try a weak one first, like `password123`).
- ✅ **You should see:** weak passwords are rejected with a reason; a strong one succeeds.
  Next time you sign in, use the new password.

## Test 6 — "Forgot password"
1. On the login page click **Forgot password?** → enter any email → submit.
- ✅ **You should see:** "If an account exists, we've sent a reset link." (Same message for
  any email — that's intentional, so nobody can fish for which emails have accounts.)
- ℹ️ In this test setup, emails are **caught by a safety net** and not actually delivered
  (so we can never email real people by accident). Real email delivery is a later step.

## Test 7 — Too many wrong logins
1. On the login page, try signing in with a wrong password ~6 times quickly.
- ✅ **You should see:** after a few tries it stops you with a "too many attempts, please
  wait" message (protection against password guessing).

---

## The partner portal (leads for partners)
The partner side (a partner signs in with a 6-digit emailed code, sees only *their* leads,
updates statuses, exports their own list) is built and tested — but because test emails are
caught by the safety net, you can't receive the login code in a real inbox yet.
**Ask me and I'll set you up to walk through the partner portal** (I'll get you a working
code), or I can add a small dev-only "sent emails" viewer so you can self-test it.

## When you're done
Tell me what worked and what felt off (wording, layout, anything confusing). Bugs and
polish are easy to fix. This *is* the review — your eyes on the real product.
