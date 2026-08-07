<!--
════════════════════════════════════════════════════════════════════════
OWNER FILL-IN CHECKLIST — complete before publishing (search for "[")
  [COMPANY LEGAL NAME]   — legal entity + form + state of organization
  [APP DOMAIN]           — production domain
  [LEGAL EMAIL]          — e.g. legal@territorydesk.com
  [PRIVACY EMAIL]        — same address used in the Privacy Policy
  [MAILING ADDRESS]      — business mailing address
  [GOVERNING STATE]      — governing-law state (appears twice, §17)
  [VENUE COUNTY/STATE]   — exclusive venue for disputes (§17)
  [EFFECTIVE DATE]       — the date you publish

INTEGRATION (see src/lib/legal/tos.ts):
  - Bump CURRENT_TOS_VERSION to this document's version string.
  - Publish at /tos; the signup checkbox and the partner first-login
    gate must link here and to /privacy.
This draft was prepared by an AI assistant from the actual codebase and
should be reviewed by a licensed attorney before publication.
════════════════════════════════════════════════════════════════════════
-->

# TerritoryDesk Terms of Service

**Version 2026-08-06 · Effective [EFFECTIVE DATE]**

These Terms of Service (the "**Terms**") are an agreement between [COMPANY LEGAL NAME] ("**TerritoryDesk**," "**we**," "**us**") and you. They govern your use of the TerritoryDesk platform at [APP DOMAIN], including the partner portal, exports, emails, and any related services (together, the "**Service**").

**By creating a workspace, accepting an invitation, clicking "I agree," or using the Service, you accept these Terms and our [Privacy Policy](/privacy).** If you accept on behalf of a company or other organization, you represent that you have authority to bind it, and "you" means that organization.

If you do not agree, do not use the Service.

---

## 1. Definitions

- "**Customer**" — the person or organization that owns a workspace (typically the operator of a real-estate joint-venture network). The person who creates a workspace is its first admin.
- "**Workspace**" — a Customer's isolated tenant within the Service: its leads, partners, territories, rules, settings, and history.
- "**Authorized User**" — anyone who accesses a workspace under a Customer's account: its admins and its invited Partner Users.
- "**Partner User**" — an investor or agent whom a Customer's admin invites into the Customer's workspace to receive and work leads. Partner Users cannot self-register; access exists at the Customer's pleasure and can be revoked by the Customer at any time.
- "**Customer Content**" — all data submitted to a workspace by or for a Customer, including uploaded lead files and every row in them, Lead Data, notes, territory rules, and settings.
- "**Lead Data**" — the portion of Customer Content that describes property sellers: names, phone numbers, email addresses, property addresses, and seller-provided free text.

## 2. The Service

TerritoryDesk is a deterministic lead-routing platform: a Customer uploads seller-lead files; the Service normalizes them, filters leads that appear to be on-market (MLS), assigns each remaining lead to the partner whose territory covers it, de-duplicates against the workspace's permanent history, and distributes results via colored spreadsheet exports, a partner portal, and email digests — recording a reason for every decision.

**Early access.** The Service is currently offered in an early-access phase. Features marked as beta, "coming soon," or roadmap (including AI features and billing) may change, be withdrawn, or never ship. We may modify the Service, and during early access we do not commit to uptime or support-response targets.

## 3. Accounts and access

- **Eligibility.** You must be at least 18 and using the Service for business purposes. The Service is offered for use in the United States.
- **Account creation.** Customers self-register with an email address, password, and workspace name, and must verify their email before first sign-in. Partner Users are created and invited by their Customer's admin and sign in with a one-time emailed code — Partner Users never have passwords.
- **Account security.** Keep your credentials and one-time codes confidential; "remember this device" should be used only on devices you control. You are responsible for all activity under your account, and Customers are responsible for the acts and omissions of their Authorized Users. Tell us immediately at [LEGAL EMAIL] if you suspect unauthorized access.
- **Accuracy.** Keep your account information accurate and current.

## 4. Workspaces, roles, and the Customer's authority

Within a workspace, the Customer (through its admins) controls everything: what is uploaded, how territories and rules are configured, which partners are invited or revoked, and how leads are assigned. We act on the instructions of the workspace's admins. Partner Users acknowledge that:

- their access, and the leads routed to them, are determined by their Customer, not by TerritoryDesk;
- an admin can revoke their access at any time;
- lead assignment history is permanent by design — a lead assigned to a partner remains part of the workspace's history even after that partner leaves; and
- notes they write are private from admins (and vice versa), but their status changes are visible to admins.

Any dispute between a Customer and its Partner Users (including over deal terms, territories, or lead ownership) is between them; TerritoryDesk is not a party to it.

## 5. Customer Content

- **You own it.** As between you and us, the Customer owns all Customer Content. We claim no rights in it beyond the license below.
- **Our license.** You grant us a worldwide, non-exclusive license to host, store, process, transmit, display, back up, and create routing decisions and exports from Customer Content — solely to provide, secure, and support the Service, and for no other purpose. We do not sell Customer Content, use it for advertising, or use it to train AI models.
- **Your responsibilities.** You represent and warrant that:
  - you have all rights, consents, and lawful bases required to upload the Customer Content — including Lead Data about property sellers — and to have it processed and distributed to your Authorized Users as the Service does;
  - you have provided any privacy notices to, and obtained any consents from, the individuals in your Lead Data that applicable law requires;
  - Customer Content does not include data you have no right to use, and does not include Social Security numbers, payment-card numbers, health records, biometric data, or information about children.
- **De-identified data.** We may use aggregate, de-identified data (counts, match rates, performance metrics) that does not identify you, any Authorized User, or any person in your Lead Data, to operate and improve the Service.

## 6. Contacting sellers is your responsibility (TCPA / DNC)

This section states a boundary plainly, because it matters:

**TerritoryDesk routes and records leads. It does not make leads lawful to contact.** The Service records provenance — where a lead came from and how it was routed — but nothing in the Service is, or may be treated as, a representation that any person consented to be contacted, that any number is not on a Do-Not-Call registry, or that any outreach complies with law.

**Customers and Partner Users are solely responsible for how they contact the people in Lead Data**, including compliance with the Telephone Consumer Protection Act (TCPA), federal and state Do-Not-Call rules, CAN-SPAM, state telemarketing and privacy laws, and every other law applicable to their outreach. Filters in the Service (such as on-market/MLS detection) are best-effort conveniences, not compliance determinations.

## 7. Acceptable use

You will not, and will not permit anyone to:

- use the Service in violation of law, or upload Customer Content in violation of §5;
- access another workspace's data, or probe, scan, or test the vulnerability of the Service, or circumvent authentication, rate limits, tenant isolation, or other security controls;
- resell, sublicense, or provide the Service to third parties outside your workspace, or scrape or bulk-extract data other than through the export features provided;
- reverse engineer the Service except to the extent a law says we can't stop you;
- misuse the Service to send spam, or upload malicious code;
- impersonate anyone or misrepresent your affiliation.

We may suspend access immediately where we reasonably believe there is a security risk, abuse, or a violation of law or these Terms, and will restore access when the issue is resolved. Where practical, we'll notify you.

## 8. AI features

If a workspace enables the optional AI assistant:

- It is a **read-only, informational** feature. AI output may be wrong, incomplete, or out of date — verify anything you rely on against the workspace's own screens and exports. AI output is not legal, financial, or investment advice.
- **You bring your own AI provider.** To use the assistant, a workspace supplies its own API key for an AI provider it selects (currently Google, OpenAI, or Anthropic). We store that key encrypted and use it only for that workspace's requests. Seller personal information is stripped before anything reaches the provider, and conversations are not stored (see the Privacy Policy, §5). Because the workspace uses its **own account with the provider**, that provider's terms — including data retention, model training, availability, and fees — are **between the workspace and the provider**; the workspace is responsible for its provider account and key, for any fees the provider charges, and for choosing a provider and tier consistent with these Terms and its own obligations. **TerritoryDesk never uses your data to train any model.**
- AI usage is metered and rate-limited; we may throttle or disable AI features at any time, particularly during early access.

## 9. Privacy and data protection

Our [Privacy Policy](/privacy) is part of these Terms and describes what we collect, how long we keep it, and the rights you have. In addition, with respect to personal information inside Customer Content, we commit that we:

- process it only to provide the Service under the Customer's instructions — acting as a "service provider" (CCPA) or processor;
- do not sell it, share it for advertising, or use it to train AI models;
- keep production data in the United States;
- use the subprocessors listed in the Privacy Policy, and update that list before adding one that touches Customer Content;
- maintain the technical and organizational security measures described in the Privacy Policy, and notify affected Customers without undue delay of any breach of security affecting their Customer Content;
- assist Customers, as they reasonably request, in responding to consumer rights requests concerning their Lead Data.

## 10. Data lifecycle — holds, voids, and permanence

You acknowledge three deliberate behaviors of the Service:

- **Distribution hold.** Newly imported leads are held from partners for a short window (currently 5 minutes) so a bad upload can be undone before anyone sees it.
- **Void is immediate and irreversible.** Voiding an import permanently redacts the seller personal information in that import's leads at the moment of the void. There is no "un-void." The Service does not retain your original uploaded file — if you void, re-importing your own source file is the only recovery path, so keep your source files.
- **History is permanent by design.** Routing history and assignment records are never rewritten; deduplication and "the returning lead stays with its original partner" depend on it.

Exports you download, and emails the Service sends at your direction, leave our systems; you are responsible for handling those copies in compliance with law.

## 11. Fees

The Service is currently provided **without charge** during early access. We may introduce paid plans; if we do, we will give Customers at least **30 days' notice**, and continued use after paid plans take effect (or after any pricing change) requires an active plan. Any fees will be stated at purchase, are exclusive of taxes, and — except where law requires otherwise — are non-refundable. Nothing in these Terms obligates us to keep any feature free.

## 12. Term, suspension, and termination

- **Term.** These Terms apply from your first acceptance until your account or workspace is closed.
- **By you.** A Customer may stop using the Service and request workspace closure at any time at [LEGAL EMAIL]. A Partner User's participation ends when their Customer revokes it or their account closes.
- **By us.** We may suspend or terminate access for material breach of these Terms, for the security/abuse reasons in §7, where required by law, or — during early access — for extended inactivity, with reasonable notice where practical. We may also discontinue the Service entirely on at least 60 days' notice to Customers.
- **Effect of termination.** For 30 days after a Customer's workspace closes, we will make the workspace's Customer Content available for export on request (the in-app export features remain the fastest path — use them before closing). After that window we delete Customer Content within 90 days, except as retained in encrypted backups (which roll off on the backup cycle) or as law requires. Sections that by their nature should survive (including §§5–6, 10, 13–18) survive termination.

## 13. Intellectual property

The Service — its software, design, documentation, and trademarks — is owned by TerritoryDesk and its licensors. We grant you a limited, non-exclusive, non-transferable right to use the Service under these Terms. If you send us feedback or suggestions, we may use them without restriction or obligation; we will not publicly name you as the source without permission.

## 14. Third-party services and links

The Service links to third-party websites (for example, a "search this property" link that opens a search engine) and depends on third-party providers (listed in the Privacy Policy). Third-party sites and services have their own terms, and we are not responsible for them.

## 15. Disclaimers

THE SERVICE IS PROVIDED "**AS IS**" AND "**AS AVAILABLE**." TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WITHOUT LIMITING THAT, WE DO NOT WARRANT THAT:

- LEAD DATA IS ACCURATE, CURRENT, OR CONTACTABLE — LEADS ARE YOUR DATA, FROM YOUR VENDORS;
- ON-MARKET/MLS FILTERING, DEDUPLICATION, OR ANY OTHER AUTOMATED CLASSIFICATION IS ERROR-FREE;
- AI OUTPUT IS ACCURATE OR COMPLETE;
- THE SERVICE WILL BE UNINTERRUPTED, TIMELY, OR ERROR-FREE, PARTICULARLY DURING EARLY ACCESS.

NOTHING IN THE SERVICE IS LEGAL, COMPLIANCE, FINANCIAL, OR INVESTMENT ADVICE.

## 16. Limitation of liability; indemnification

**Limitation.** TO THE MAXIMUM EXTENT PERMITTED BY LAW: (a) NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, OR DATA; AND (b) OUR TOTAL LIABILITY ARISING OUT OF OR RELATING TO THE SERVICE IS CAPPED AT THE GREATER OF (i) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE 12 MONTHS BEFORE THE CLAIM AND (ii) ONE HUNDRED US DOLLARS ($100). These limits do not apply to your breach of §§5–7, your indemnification obligations, or either party's fraud or willful misconduct, and nothing limits liability that cannot be limited by law.

**Indemnification.** The Customer will defend and indemnify TerritoryDesk against third-party claims (including regulatory actions) arising from: (a) Customer Content, including claims that its collection or upload violated law or third-party rights; (b) **how the Customer or its Authorized Users contacted, or attempted to contact, any person in Lead Data — including TCPA, Do-Not-Call, and telemarketing claims**; or (c) use of the Service in violation of these Terms — except to the extent a claim results from our breach of these Terms. We will promptly notify you of a claim and reasonably cooperate at your expense; you may not settle a claim that imposes obligations on us without our consent.

## 17. Governing law and disputes

These Terms are governed by the laws of the State of [GOVERNING STATE], excluding its conflict-of-laws rules. Before filing any claim, the parties will attempt in good faith to resolve the dispute informally: write to [LEGAL EMAIL] with a description of the dispute, and allow 30 days for resolution. Any claim not resolved informally must be brought exclusively in the state or federal courts located in [VENUE COUNTY/STATE], and each party consents to their jurisdiction. Either party may bring a qualifying claim in small-claims court instead. **Each party waives the right to a jury trial and to participate in a class action, to the extent permitted by law.**

## 18. General

- **Changes to these Terms.** These Terms are versioned. For material changes, we will notify you and the Service will require you to review and re-accept before continued use; non-material changes take effect when posted with an updated version string. Your continued use after the effective date of a change constitutes acceptance.
- **Notices.** We may give notice by email to your account address or in-app; notice to us goes to [LEGAL EMAIL] or the mailing address below.
- **Assignment.** You may not assign these Terms without our written consent; we may assign them in connection with a merger, acquisition, or sale of assets.
- **Force majeure.** Neither party is liable for delay or failure caused by events beyond its reasonable control.
- **Export and sanctions.** You may not use the Service in violation of US export-control or sanctions laws.
- **Severability; waiver.** If a provision is unenforceable, the rest remain in effect; a failure to enforce is not a waiver.
- **Entire agreement.** These Terms and the Privacy Policy are the entire agreement between you and us about the Service and supersede prior agreements on that subject. If you and we sign a separate written agreement covering the Service, that agreement controls where it conflicts.

---

**[COMPANY LEGAL NAME]**
[MAILING ADDRESS]
Questions about these Terms: **[LEGAL EMAIL]**
