<!--
Before submitting:
  1. Read docs/_status.md § 2 (typecheck debt) — don't blame your own code for a baseline error.
  2. Read docs/_status.md § 3 (fragile areas) — note anything relevant to modules you touched.
  3. Fill every section below. Short answers are fine. "N/A" is fine if truly N/A.
  4. Update docs/_status.md at the bottom (§ 5 last-touched PR; §§ 1 / 3 / 4 if relevant) and bump "Last updated".
-->

## Summary

<!-- 1-3 sentences on what this does and why. -->

## Modules touched

<!-- List by name (e.g. "Invoices, Stock ledger, Period lock"). Helps reviewers know where to look. -->

## Regression surface

<!-- What else could this break? Think about: shared helpers used by other modules, choke points (postJournal, next_document_number, WAVG propagation, RLS via current_tenant_id), PDF routes, cron jobs, state-machine transitions. List the surfaces you considered, not just "nothing". -->

## Test plan

<!-- Concrete manual steps you ran. Not "should work". Check each box as you verified it. -->

- [ ]
- [ ]
- [ ]

## `_status.md` updates

<!-- Did this PR:
     - Fix a known bug (§1)? Remove the entry.
     - Surface a new one you're NOT fixing here (§1)? Add it.
     - Harden a fragile area (§3)? Downgrade or remove.
     - Discover a new fragile area (§3)? Add it.
     - Fix a post-merge regression (§4)? Log the one-liner.
     - Touch a module (§5)? Bump its Last PR.
     Say "none" if truly none — but actually check. -->

---

🤖 If you used Claude Code to open this PR, you can delete this footer or leave it.
