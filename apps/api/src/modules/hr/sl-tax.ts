/**
 * SL statutory payroll math. All inputs and outputs are in cents (LKR × 100)
 * to avoid floating-point rounding errors on money.
 *
 * Sources:
 * - EPF Act: employee 8% of gross, employer 12% of gross
 * - ETF Act: employer 3% of gross (no employee contribution)
 * - PAYE: IRD progressive slab for 2024/25 monthly periods
 *
 * The PAYE slabs live in a single place so they can be swapped per tax year
 * later. Every 100,000 threshold rounds neatly so the boundaries line up
 * with the published IRD tables.
 */

export const EPF_EMPLOYEE_RATE_BPS = 800; // 8.00%
export const EPF_EMPLOYER_RATE_BPS = 1200; // 12.00%
export const ETF_EMPLOYER_RATE_BPS = 300; // 3.00%

export interface PayeBracket {
  /** Inclusive lower bound of monthly taxable cents in this slab. */
  fromCents: number;
  /** Inclusive upper bound; null means "and above". */
  toCents: number | null;
  /** Basis-points marginal rate inside this slab (600 = 6%). */
  rateBps: number;
}

/**
 * IRD monthly PAYE slab — 2024/25 published schedule. Taxable amount =
 * monthly gross, with the first LKR 100,000 relieved (the 0% first bracket).
 * Each subsequent slab is LKR 41,667 wide at rising marginal rates.
 */
export const PAYE_BRACKETS_2024_25: PayeBracket[] = [
  { fromCents: 0, toCents: 10_000_000, rateBps: 0 },
  { fromCents: 10_000_000, toCents: 14_166_700, rateBps: 600 },
  { fromCents: 14_166_700, toCents: 18_333_400, rateBps: 1_200 },
  { fromCents: 18_333_400, toCents: 22_500_100, rateBps: 1_800 },
  { fromCents: 22_500_100, toCents: 26_666_800, rateBps: 2_400 },
  { fromCents: 26_666_800, toCents: 30_833_500, rateBps: 3_000 },
  { fromCents: 30_833_500, toCents: null, rateBps: 3_600 },
];

export function computeEpfEmployee(grossCents: number): number {
  if (grossCents <= 0) return 0;
  return Math.round((grossCents * EPF_EMPLOYEE_RATE_BPS) / 10_000);
}

export function computeEpfEmployer(grossCents: number): number {
  if (grossCents <= 0) return 0;
  return Math.round((grossCents * EPF_EMPLOYER_RATE_BPS) / 10_000);
}

export function computeEtfEmployer(grossCents: number): number {
  if (grossCents <= 0) return 0;
  return Math.round((grossCents * ETF_EMPLOYER_RATE_BPS) / 10_000);
}

/**
 * Monthly PAYE using the progressive slab. Walks each bracket up to the
 * gross amount, applying the marginal rate to the portion within the
 * bracket.
 */
export function computePaye(
  grossCents: number,
  brackets: PayeBracket[] = PAYE_BRACKETS_2024_25,
): number {
  if (grossCents <= 0) return 0;
  let tax = 0;
  for (const b of brackets) {
    const upper = b.toCents ?? Number.MAX_SAFE_INTEGER;
    const inSlab = Math.max(0, Math.min(grossCents, upper) - b.fromCents);
    if (inSlab <= 0) continue;
    tax += Math.round((inSlab * b.rateBps) / 10_000);
  }
  return tax;
}

export interface PayrollLineComputation {
  grossCents: number;
  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;
  totalDeductionsCents: number;
  netPayCents: number;
}

export function computePayrollLine(input: {
  basicSalaryCents: number;
  epfEligible: boolean;
  etfEligible: boolean;
  payeApplicable: boolean;
  otherDeductionsCents?: number;
}): PayrollLineComputation {
  const gross = Math.max(0, input.basicSalaryCents);
  const epfEmployee = input.epfEligible ? computeEpfEmployee(gross) : 0;
  const epfEmployer = input.epfEligible ? computeEpfEmployer(gross) : 0;
  const etfEmployer = input.etfEligible ? computeEtfEmployer(gross) : 0;
  const paye = input.payeApplicable ? computePaye(gross) : 0;
  const other = input.otherDeductionsCents ?? 0;

  const totalDeductions = epfEmployee + paye + other;
  const net = Math.max(0, gross - totalDeductions);

  return {
    grossCents: gross,
    epfEmployeeCents: epfEmployee,
    epfEmployerCents: epfEmployer,
    etfEmployerCents: etfEmployer,
    payeCents: paye,
    totalDeductionsCents: totalDeductions,
    netPayCents: net,
  };
}
