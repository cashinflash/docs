# Debit Card Disbursement Authorization (CDDTL Push-to-Card)

Compliance + architecture reference for the instant-debit-card funding flow
at Cash in Flash. Authoritative code + UI lives in the `cif-apply` repo;
this document exists so compliance, legal, and on-call engineers can find
the full picture without spelunking through source.

> **Regulatory regime:** California Deferred Deposit Transaction Law
> (CDDTL), Financial Code §§ 23000–23106. DFPI-licensed lender. The
> authorization form is specifically scoped to a CDDTL payday loan.

---

## 1. What this authorization does — and what it does NOT

The authorization gives Cash in Flash (and its payment service providers,
currently Vergent LMS / Repay) permission to execute **one** push-to-card
credit for the loan proceeds shown in the borrower's loan agreement.

**Does NOT authorize:**
- Any debit from the borrower's card (repayment, fees, anything else)
- Recurring pushes
- Any transfer after the borrower revokes the authorization (so long as
  the revocation arrives before initiation)

**Optional + revocable:** CDDTL allows borrowers to pick any lawful
disbursement method. The authorization must be presented as OPTIONAL and
must be revocable before initiation. Both facts are surfaced in the UI
header, not buried in fine print.

---

## 2. Source of truth for the authorization text

The legally-reviewed text lives at:

> `cashinflash/cif-apply` — `frontend/authorize-card.html`

Four sections, rendered verbatim:

1. Purpose of Authorization
2. How Instant Debit Card Funding Works
3. Fees and Limits
4. Cancellation Rights

Plus the acknowledgment sentence (also verbatim): "I acknowledge that I
have received a complete copy of this Authorization at the time I signed
it, and that it was provided in the language primarily used during the
transaction."

If the text ever changes, bump `AUTHORIZATION_VERSION` in
`cif-apply/card_authorization.py`. Existing signed records reference the
version string so audit can trace any record back to the exact wording
the borrower saw.

---

## 3. System architecture

```
 Applicant                apply.cashinflash.com            cif-portal / Vergent       Repay Instant Funding
     |                        (Render)                   (AWS Lambda + APIM)               (3rd party)
     |                             |                              |                              |
     |--- apply form (Step 2) -->  |                              |                              |
     |    checks instant-debit     |                              |                              |
     |    opt-in box               |                              |                              |
     |                             | /submit -> decision_engine   |                              |
     |<-- approval + auth URL  --- | issue_authorization_token()  |                              |
     |                             | (HMAC, 15m TTL, single use)  |                              |
     |                             |                              |                              |
     |--- opens /authorize-card -->| token validated, page served |                              |
     |    (reads 4 legal sections) |                              |                              |
     |--- submits form + ack ----->| validates; POST              |                              |
     |                             | /V1/PostCustomerCard   ----> | Repay tokenizes (server-side)|
     |                             | <-------- cardId ----------- | card data persisted only as  |
     |                             |                              | token + last4                |
     |                             | Repay Instant Funding push   |                              |
     |                             | call w/ cardId + amt_cents --|------------------------------>
     |                             | <----------- txn_id -------- |----- push-to-card credit ----|
     |                             |                              |                              |
     |<-- success screen (last 4) -|                              |                              |
     |<-- email w/ signed PDF ---- | (Firebase record + PDF)      |                              |
```

---

## 4. PCI scope

**Current posture (v1):** SAQ-D.

- Raw PAN + CVV are POSTed over HTTPS to the cif-apply backend and
  forwarded server-to-server to Vergent's `PostCustomerCard`, which
  tokenizes via Repay (PCI-DSS Level 1 certified). The cif-apply process
  touches card data in memory for the duration of a single request.
- Nothing is persisted locally: no Firebase card field, no log line, no
  disk, no analytics, no localStorage. `card_authorization.py` logs
  only `{applicant_id, brand, last4, exp_mm, exp_yy, amount_cents,
  outcome}`; PAN/CVV are explicitly dropped after the upstream call.
- PDF copies and email deliveries contain masked PAN only
  (`•••• •••• •••• 1234`).
- TLS 1.2+ enforced at Render ingress. `X-Forwarded-Proto=https` guard
  in the handler rejects non-HTTPS submits (except localhost in dev).

**Planned upgrade (v2, tracked separately):** migrate the PAN/CVV fields
to a Repay Secure Fields iframe (or equivalent processor-hosted
tokenization surface) so raw card data never hits the cif-apply process.
That drops us to SAQ-A and substantially shrinks the attestation +
scan surface.

---

## 5. Data we store (per authorization)

Firebase path: `card_authorizations/{applicant_id}`

| Field | Example | Notes |
| --- | --- | --- |
| `applicant_id` | `app_2026_04_0042` | Our internal id |
| `vergent_customer_id` | `1234567` | Required for card to attach |
| `card_id` | `CARD-7f3...` | Token from Vergent / Repay |
| `brand` | `Visa` | Detected + confirmed at tokenize |
| `last4` | `1234` | Displayed back; never PAN |
| `exp_month` | `04` | |
| `exp_year` | `2028` | |
| `amount_cents` | `25500` | Loan proceeds amount |
| `borrower_name` | `Jane Q Public` | From form |
| `cardholder_name` | `Jane Q Public` | From form |
| `signature` | `Jane Q Public` | Typed signature |
| `acknowledgment` | `true` | The "received a complete copy" checkbox |
| `signed_at` | `2026-04-22T14:03:01Z` | Server-side timestamp |
| `remote_addr` | `203.0.113.14` | For audit |
| `user_agent` | `Mozilla/5.0 ...` | For audit |
| `authorization_version` | `2026-04-CDDTL-v1` | Pins to exact text rendered |
| `status` | `pending` → `completed` / `reversed` / `revoked` | |
| `nonce` | `a0b1c2d3...` | Single-use token id |

Explicitly **NOT** stored anywhere: `pan`, `cvv`, `track_data`.

---

## 6. Retention

- Authorization record + signed PDF: **7 years** (California DFPI
  retention for CDDTL loans).
- HTTP access logs: per existing apply log retention (currently 30 days
  at Render; rotate into long-term storage with PAN scrubbing).
- Short-lived authorization tokens: Firebase `authorization_nonces/{nonce}`
  retains `{issued_at, expires_at, used_at}` for **30 days** for fraud
  debugging, then deleted.

---

## 7. Revocation procedure

Section 4 of the authorization allows revocation before initiation.

Staff procedure (dashboard UI):

1. Locate the applicant's `card_authorizations/{applicant_id}` record.
2. If `status == 'pending'` and the Repay push has not been initiated:
   set `status = 'revoked'` with `revoked_at` timestamp. This blocks the
   downstream push.
3. If the push has been initiated (`status == 'initiated'` or later):
   revocation cannot stop the transfer. Contact the borrower to explain
   and, if needed, initiate a separate reversal workflow.
4. Revocation does not cancel the loan — proceeds still owed, just
   delivered by an alternate lawful method (store cash, ACH, etc.).

---

## 8. What to do when a push is rejected or reversed

From the authorization text: "If that occurs, Lender will contact me to
arrange an alternate lawful disbursement method."

Implementation:

- `disbursements/{applicant_id}.status` flips to `rejected` or
  `reversed`.
- Staff dashboard queue picks it up as a follow-up task.
- Borrower is contacted within 1 business day to offer an alternate
  disbursement method (store cash, ACH, check at branch).
- The original authorization record is preserved for audit; a fresh
  authorization is required if the borrower later wants to try a
  different debit card.

---

## 9. Related files

- Source-of-truth UI / legal copy: `cashinflash/cif-apply/frontend/authorize-card.html`
- Client-side validation + PCI guardrails: `cashinflash/cif-apply/frontend/authorize-card.js`
- Server-side handler + token system: `cashinflash/cif-apply/card_authorization.py`
- Wiring, env vars, test procedures: `cashinflash/cif-apply/TESTING.md`
- Existing customer-portal Vergent card tokenization (pattern we port from):
  `cashinflash/cif-portal/backend/handlers/payments.py::post_card`
- Opt-in entry point on the apply form:
  `cashinflash/cif-apply/frontend/index.html` (Step 2, "Instant Debit
  Card Funding" card)

---

## 10. Open items before production enablement

Tracked in detail in `cif-apply/TESTING.md`. Summary:

- [ ] Vergent customer creation at approval time (prerequisite for
      `PostCustomerCard`)
- [ ] Port Vergent v1 auth + PostCustomerCard pattern from cif-portal
      into cif-apply
- [ ] Wire Repay Instant Funding push-to-card call + merchant
      credentials in Render env
- [ ] Firebase persistence of authorization + nonce records
- [ ] PDF generation + email delivery of signed authorization
- [ ] Legal review of rendered page vs. approved text
- [ ] End-to-end staging pass with Repay test-card matrix
- [ ] Log + DB grep for raw PAN — zero hits before flipping prod env
