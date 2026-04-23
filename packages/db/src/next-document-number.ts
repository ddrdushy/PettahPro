import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/**
 * Kinds accepted by the `next_document_number(kind)` Postgres function.
 * Kept in sync with the function body in `packages/db/init/*.sql`.
 */
export type DocumentKind =
  | "invoice"
  | "bill"
  | "payment"
  | "journal"
  | "payroll"
  | "credit_note"
  | "debit_note"
  | "quotation"
  | "sales_order"
  | "delivery_note"
  | "purchase_order"
  | "grn"
  | "stock_transfer"
  | "bonus_run"
  | "staff_loan"
  | "final_settlement"
  | "expense_claim"
  | "purchase_requisition";

/**
 * Allocate the next document number for the current tenant.
 *
 * The `next_document_number(kind)` SQL function always returns exactly
 * one row. Before this helper existed the call pattern was repeated in
 * ~15 places with two competing shapes:
 *
 *   const [{ number }] = (await tx.execute(…)) as …;     // crashes on undefined
 *   const rows = (…) as …; if (!rows[0]?.number) return { error: "…" };
 *
 * Every call site using the destructure form was a latent `TypeError`
 * waiting to fire on the happy path that never lost to race conditions
 * — but they tripped TypeScript's `noUncheckedIndexedAccess`, accumulating
 * debt in `_status.md`.
 *
 * This helper normalises the pattern: always returns a string, throws
 * with a descriptive message if allocation ever fails (net-zero behaviour
 * change — the destructure was also a throw, just a worse one).
 */
export async function nextDocumentNumber(
  tx: Database,
  kind: DocumentKind,
): Promise<string> {
  const rows = (await tx.execute(
    sql`SELECT next_document_number(${kind}) AS number`,
  )) as unknown as Array<{ number: string }>;
  const number = rows[0]?.number;
  if (!number) throw new Error(`Failed to allocate ${kind} number`);
  return number;
}
