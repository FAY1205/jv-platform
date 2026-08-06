<!--
════════════════════════════════════════════════════════════════════════
OWNER FILL-IN CHECKLIST — complete before publishing (search for "[")
  [COMPANY LEGAL NAME]   — the legal entity that operates TerritoryDesk
                           (e.g. "TerritoryDesk LLC, a Michigan limited
                           liability company"). Used in §1.
  [APP DOMAIN]           — production domain (e.g. app.territorydesk.com)
  [PRIVACY EMAIL]        — e.g. privacy@territorydesk.com (must be a
                           monitored inbox; rights requests arrive here)
  [MAILING ADDRESS]      — business mailing address
  [EFFECTIVE DATE]       — the date you publish this policy
  [PRODUCTION DATA REGION] — §9 + §12 Supabase row: the ACTUAL live
                           Supabase region (do NOT assert "United States"
                           unless prod really is US; memory indicates the
                           prod DB may be in Frankfurt/EU — confirm first).

INTEGRATION (see src/lib/legal/tos.ts):
  - Bump CURRENT_TOS_VERSION to this document's version string.
  - Publish at /privacy and link from /signup, the portal ToS gate,
    and the marketing-site footer.
This draft was prepared by an AI assistant from the actual codebase and
should be reviewed by a licensed attorney before publication.
════════════════════════════════════════════════════════════════════════
-->

# TerritoryDesk Privacy Policy

**Version 2026-08-06 · Effective [EFFECTIVE DATE]**

TerritoryDesk is operated by [COMPANY LEGAL NAME] ("**TerritoryDesk**," "**we**," "**us**"). TerritoryDesk is a lead-routing platform for real-estate joint-venture networks: a network operator uploads seller-lead files, and the platform filters, routes, and distributes those leads to the operator's partners by territory.

This policy explains what personal information we collect, how we use it, who we share it with, and the choices and rights you have. It applies to the TerritoryDesk application at [APP DOMAIN], our marketing website, and the emails we send ("the **Service**").

We have tried to write this in plain words. If anything is unclear, ask us at [PRIVACY EMAIL].

---

## 1. The two roles we play

TerritoryDesk handles personal information in two distinct capacities, and your rights differ depending on which bucket your information falls into:

**a. Information about our users (we are the "business" / controller).** When you create a workspace, sign in, or are invited as a partner, we collect your account information for our own purposes — operating, securing, and improving the Service. This policy governs that information directly.

**b. Information inside Customer Content (we are a "service provider" / processor).** The lead files our customers upload contain personal information about **property sellers** — people who are not our users and have no account with us. Our customer (the network operator who runs the workspace) decides what to upload, who receives each lead, and how sellers are contacted. We process that information **only on the customer's behalf and instructions** to provide the Service. We do not use it for our own purposes, we do not sell it, and we do not use it to train AI models.

> **If you are a property seller** whose information appears in TerritoryDesk: your information was uploaded by one of our customers (a real-estate network operator), not collected by us from you. Requests about that information are best directed to the business that has your relationship. If you contact us at [PRIVACY EMAIL], we will identify the responsible customer where we can, forward your request to them, and assist them in honoring it.

---

## 2. Information we collect

### 2.1 Information you give us

- **Workspace signup (operators):** your email address, a password, and a workspace name. Your password is hashed by our authentication provider and is never stored or visible in readable form. We also record your acceptance of our Terms and this policy (which version, and when).
- **Partner accounts:** partner users don't self-register — a workspace admin creates them and provides the partner's name, email address, phone number, deal terms, and any admin notes about the partner. Partners sign in with a one-time emailed code; **partners never have passwords**.
- **Customer Content (lead data):** the rows of the lead files an admin uploads. A typical row includes the seller's first and last name, phone number, email address, the property street address, city, state, and ZIP, seller-provided free text (notes, reason for selling, motivation, timeline), the campaign, and the original source row as received. Notes that admins and partners write about leads are also Customer Content.
- **Communications:** anything you send us in support or feedback messages, including the optional short note on AI-answer feedback.
- **Early-access waitlist (marketing site):** if you join the waitlist, your email address and, optionally, your role and a note. We use it only to contact you about access to TerritoryDesk, and delete it on request.

### 2.2 Information collected automatically

- **Security and sign-in records:** for every sign-in, one-time-code, password-reset, and signup attempt we record the email address used, the IP address, and whether the attempt succeeded. We use these records for rate limiting, lockout, and abuse detection. If you choose "remember this device," we store a device record (a device label, IP address, last-seen time, and a hashed token — never the token itself).
- **Activity and audit records:** the Service keeps an append-only audit log of significant actions (who did what, when). Seller personal information is **masked before it is written** to this log — an auditor can see that a field changed, never its value.
- **Email records:** a record of each email we sent you (recipient address, subject, and the message content), used for delivery, retry, and troubleshooting.
- **AI usage metering:** if your workspace enables the AI assistant, we record token counts and cost per question — **never the content** of your conversations (see §5).
- **Cookies and local storage:** described in §3. We do **not** use analytics scripts, advertising trackers, session-replay tools, or third-party cookies — anywhere in the Service.

### 2.3 Information from other sources

We do not buy, enrich, or otherwise obtain personal information about you from data brokers or third parties. Two narrow technical exceptions:

- **Bot protection:** the signup page uses Cloudflare Turnstile, which analyzes interaction signals on that page to distinguish humans from bots. Your email and password are not shared with Cloudflare.
- **Password safety check:** when you set a password we check it against known breach corpuses using a k-anonymity API (Have I Been Pwned). Only the first five characters of a one-way hash ever leave our systems — never your password or anything that identifies you.

---

## 3. Cookies and local storage

We use exactly two cookies, both first-party, strictly necessary, and hardened (HttpOnly, Secure, host-locked):

| Name | Purpose | Lifetime |
|---|---|---|
| `__Host-jv-auth` | Keeps you signed in (session) | Session |
| `__Host-jv-trust` | "Remember this device" — lets a partner skip the emailed code on a device they chose to trust | 30 days |

Your browser's local storage holds only display preferences (theme and navigation state) — never tokens, personal information, or identifiers.

Because we use no advertising or analytics cookies, there is nothing to opt out of, and browser signals such as **Global Privacy Control** and **Do Not Track** are honored by design: there is no tracking to disable.

---

## 4. How we use information

We use the information above to:

- **Provide the Service** — authenticate you, route and display leads, generate exports, send lead digests and notifications, and keep each workspace's data isolated from every other workspace;
- **Secure the Service** — rate limiting, lockout, enumeration and abuse prevention, session and device management, audit trails, and incident investigation;
- **Communicate with you** — transactional email only: one-time codes, invitations, verification links, security alerts, lead digests, and run summaries. We do not send marketing email to users of the app, and every message is sent because the Service needs to send it;
- **Meter AI usage** — counts and costs only;
- **Improve the Service** — using aggregate, de-identified information (counts, rates, performance), never the content of your leads;
- **Comply with law** — respond to lawful requests and enforce our Terms.

**We do not sell personal information. We do not share it for cross-context behavioral advertising. We do not use Customer Content to train AI models.** These are unconditional.

---

## 5. The AI assistant

Workspaces can optionally enable a read-only AI assistant for admins. It is **off by default**; a workspace turns it on and supplies its own AI-provider API key ("bring your own key"). If enabled:

- The assistant answers questions using read-only tools scoped to your own workspace. Tool results are **masked before anything reaches the AI provider**: seller names, phone numbers, email addresses, street addresses, and all free-text fields are stripped. The provider receives aggregate statistics and coarse location (city/state/ZIP) only.
- Conversations are **not stored** on our servers. A request carries only the recent messages of your current chat, and what we persist is token counts and cost — never the content.
- The workspace chooses its AI provider (currently Google, OpenAI, or Anthropic) and connects it using the **workspace's own API key**, which we store **encrypted** and use only to make that workspace's own requests. Because the workspace uses its own account with the provider, that provider's handling of a request — including any data-retention or model-training terms — is governed by the **workspace's own agreement with that provider**, not by us; we do not control it. We recommend enabling the assistant only on a provider tier whose terms prohibit training on submitted content. **TerritoryDesk never uses your data to train any model.**

---

## 6. When information is shared

- **Inside your workspace:** workspace admins can see the workspace's leads, partners, and activity. A partner sees **only the leads routed to them** — including, for those leads, the seller's contact details and property information — and never another partner's leads. Admin notes and partner notes are mutually invisible.
- **Service providers (subprocessors):** the vendors in §12, each bound to process personal information only to provide their service to us.
- **Legal:** if required by law, subpoena, or to protect the rights, safety, or property of TerritoryDesk, our customers, or others — and, where lawful, we will tell the affected customer before disclosing Customer Content.
- **Business transfers:** if we are involved in a merger, acquisition, or sale of assets, personal information may transfer with the business; this policy would continue to apply and we would notify you of any change in ownership or use.

We share personal information with **no one else**. There are no advertising partners, data brokers, or "marketing affiliates."

---

## 7. How long we keep information

| Information | Retention |
|---|---|
| Account information (users, partners) | For the life of the account, then deleted or de-identified on verified request or workspace closure |
| Lead data (Customer Content) | For as long as your workspace keeps it. Permanent lead history is a core function of the Service — deduplication and "the returning lead stays with its original partner" depend on it — so lead records persist until deleted by the customer or on verified request |
| Voided imports | If an admin voids an import, the seller personal information in that import's leads (names, phone, email, street address, free text, and the raw source row) is **redacted immediately, in the same transaction** — and a daily sweep re-checks that nothing was missed. What survives redaction: the reference ID, city/state/ZIP, and the routing-decision record |
| Audit log | Append-only, retained for the life of the workspace; seller personal information is masked before writing, so the log never holds it |
| Security records (sign-in attempts, device records) | Only as long as needed for security monitoring and abuse prevention; one-time codes and tokens are stored only as hashes and expire in minutes to hours (codes: 10 minutes; reset links: 30 minutes; verification links: 24 hours; trusted devices: 30 days) |
| Email records | As long as needed for delivery assurance and troubleshooting |
| Generated export files | Excel exports generated by the Service are kept in access-controlled storage so authorized users can re-download them; we delete them on request and when the associated workspace data is deleted |

On workspace termination we honor a data-export window and then delete Customer Content, as described in the Terms of Service. Residual copies in encrypted backups roll off on the backup cycle.

---

## 8. Security

Security measures in the Service include, in plain words:

- **Encryption in transit** (TLS everywhere, HTTPS enforced with HSTS) and **encryption at rest** on our infrastructure providers;
- **Tenant isolation, twice over** — every database query is scoped to your workspace at the application layer, *and* the database enforces row-level security as an independent backstop;
- **Hardened authentication** — hashed passwords with breach checking, hashed one-time codes and tokens, constant-time secret comparison, uniform responses that don't reveal whether an account exists, rate limiting and progressive lockout, revocable per-device sessions, and server-side sign-out;
- **Hardened cookies and headers** — HttpOnly/Secure host-locked cookies (no tokens in browser storage), a restrictive Content-Security-Policy, frame-embedding denied;
- **Export hygiene** — every user-originated cell in generated spreadsheets is sanitized against formula injection;
- **Logs without PII** — error reports and audit records are scrubbed or masked so seller contact information never lands in a log;
- **Environment separation** — non-production environments run on separate infrastructure, contain synthetic data only, and are physically incapable of emailing real users.

No system is perfectly secure, and we can't guarantee absolute security. If we learn of a breach affecting your personal information, we will notify affected customers and users without undue delay, consistent with applicable law, and we maintain a breach-response runbook and encrypted backups.

---

## 9. Where information is stored

Production data — including all Customer Content — is stored and processed in **[PRODUCTION DATA REGION]** (our database, authentication, and file-storage provider — Supabase — is pinned to that region, as is error monitoring). Our development and testing environments are separate, contain **synthetic data only**, and never hold real personal information.

> **Owner: this region MUST match the live Supabase project's actual region.** State the true region — do not assert "United States" unless the production database is in fact in a US region. (If production data lives in the EU, say so and get counsel on the added obligations that brings.)

The Service is offered to customers in the United States. If you access it from elsewhere, you understand your information will be processed in the region stated above.

---

## 10. Your rights and choices

We honor the following rights for **all** users, wherever you live (they are shaped by the California Consumer Privacy Act, as amended):

- **Know / access** — ask what personal information we hold about you and receive a copy;
- **Correct** — ask us to fix inaccurate personal information;
- **Delete** — ask us to delete your personal information, subject to legal retention needs;
- **Portability** — receive your information in a usable format (workspace data is also self-serve exportable in-app);
- **No sale, no sharing** — we don't sell or share personal information, so there is nothing to opt out of;
- **Non-discrimination** — we will never degrade the Service because you exercised a right.

To exercise a right, email **[PRIVACY EMAIL]** from the address associated with your account (or with enough information for us to verify you — we must verify identity before acting). You may use an authorized agent; we will verify the agent's authority. We respond within the time required by law (generally 45 days). If we deny a request, we'll say why, and you may appeal by replying to our decision.

**If the request concerns seller information inside Customer Content** (§1.b), the workspace operator controls that data: we will forward your request to them and assist them in honoring it. Deletion requests we're instructed to execute follow the redaction process in §7.

---

## 11. Children

The Service is a business tool, is not directed to children, and may not be used by anyone under 18. We do not knowingly collect personal information from children; if you believe a child's information has reached us, contact [PRIVACY EMAIL] and we will delete it.

---

## 12. Subprocessors

We use these vendors to provide the Service. Each processes personal information only as needed to provide its service to us:

| Vendor | Purpose | Personal information involved | Location |
|---|---|---|---|
| Supabase | Database, authentication, and file storage | All Service data, including Customer Content | [CONFIRM REGION — see §9] |
| Vercel | Application hosting and scheduled jobs | Data in transit through the application | United States |
| Resend | Transactional email delivery | Recipient email addresses and message content (codes, invites, digests) | United States |
| Cloudflare | Bot protection (Turnstile) on the signup page only | Interaction signals on the signup form and IP address; never your email or password | Global edge network |
| Sentry (Functional Software, Inc.) | Server-side error monitoring | Error reports scrubbed of query strings, cookies, headers, and personal information | United States |

**AI provider (workspace-selected).** If a workspace enables the AI assistant, its **PII-stripped** requests go to the AI provider the **workspace itself selects and connects** — currently Google, OpenAI, or Anthropic — under the **workspace's own account and API key**. That provider acts as the **workspace's** own subprocessor under the workspace's agreement with it, and is not a TerritoryDesk subprocessor; its data-handling and training terms are between the workspace and the provider (see §5).

We will update this list before adding a subprocessor that handles Customer Content, and material changes to this policy trigger the notice-and-re-acceptance process in §13.

---

## 13. Changes to this policy

This policy is versioned (see the version string at the top). If we make a material change, we will notify you — by email or in-app — and the Service will ask you to review and re-accept before you continue using it. Non-material clarifications may be posted with an updated version string.

---

## 14. Contact us

**[COMPANY LEGAL NAME]**
[MAILING ADDRESS]
**[PRIVACY EMAIL]**

We're a small team and we read everything sent to that address.
