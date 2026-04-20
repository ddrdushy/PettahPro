/**
 * SL statutory payroll math. All inputs and outputs are in cents (LKR × 100)
 * to avoid floating-point rounding errors on money.
 *
 * Sources:
 * - EPF Act: employee 8% of EPF basis, employer 12% of EPF basis
 * - ETF Act: employer 3% of ETF basis (no employee contribution)
 * - PAYE: IRD progressive slab for 2024/25 monthly periods, applied to
 *         PAYE basis (taxable gross)
 *
 * Every basis is computed by walking the employee's salary components:
 *   EPF basis  = sum(earning.amount where counts_for_epf)
 *              - sum(deduction.amount where counts_for_epf)
 *   ETF basis  = sum(earning.amount where counts_for_etf)
 *              - sum(deduction.amount where counts_for_etf)
 *   PAYE basis = sum(earning.amount where counts_for_paye)
 *              - sum(deduction.amount where counts_for_paye)
 *
 * A deduction with counts_for_epf=true means it REDUCES the EPF basis — e.g.
 * no-pay leave. A deduction that's post-tax (salary advance recovery) leaves
 * every basis alone and just trims take-home.
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

export function computeEpfEmployee(basisCents: number): number {
  if (basisCents <= 0) return 0;
  return Math.round((basisCents * EPF_EMPLOYEE_RATE_BPS) / 10_000);
}

export function computeEpfEmployer(basisCents: number): number {
  if (basisCents <= 0) return 0;
  return Math.round((basisCents * EPF_EMPLOYER_RATE_BPS) / 10_000);
}

export function computeEtfEmployer(basisCents: number): number {
  if (basisCents <= 0) return 0;
  return Math.round((basisCents * ETF_EMPLOYER_RATE_BPS) / 10_000);
}

/**
 * Monthly PAYE using the progressive slab. Walks each bracket up to the
 * gross amount, applying the marginal rate to the portion within the
 * bracket.
 */
export function computePaye(
  basisCents: number,
  brackets: PayeBracket[] = PAYE_BRACKETS_2024_25,
): number {
  if (basisCents <= 0) return 0;
  let tax = 0;
  for (const b of brackets) {
    const upper = b.toCents ?? Number.MAX_SAFE_INTEGER;
    const inSlab = Math.max(0, Math.min(basisCents, upper) - b.fromCents);
    if (inSlab <= 0) continue;
    tax += Math.round((inSlab * b.rateBps) / 10_000);
  }
  return tax;
}

// ------------------------------------------------------------------------------
// Component-aware payroll compute.
// ------------------------------------------------------------------------------

export type ComponentKind = "earning" | "deduction";

export interface ResolvedComponent {
  code: string;
  name: string;
  kind: ComponentKind;
  amountCents: number;
  countsForEpf: boolean;
  countsForEtf: boolean;
  countsForPaye: boolean;
  sortOrder: number;
}

export interface PayrollLineComputation {
  /** Sum of earnings (what the employee "earns" pre-deduction). */
  earningsCents: number;
  /**
   * Backwards-compat: grossCents == earningsCents. Kept so callers that used
   * v1 fields keep working; real basis figures are epfBasis/paye-basis below.
   */
  grossCents: number;
  /** EPF/ETF/PAYE bases (earnings filtered − deductions filtered). */
  epfBasisCents: number;
  etfBasisCents: number;
  payeBasisCents: number;
  /** Post-tax non-statutory deductions (advance recovery, etc.). */
  nonStatutoryDeductionsCents: number;
  /** Statutory amounts. */
  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;
  /** Sum of ALL deductions taken from take-home = EPF employee + PAYE + non-stat. */
  totalDeductionsCents: number;
  netPayCents: number;
}

/**
 * Compute an employee's payroll line from their resolved component list and
 * their statutory flags (employee-level overrides like epfEligible=false).
 *
 * - `earningsCents` is every earning summed.
 * - `epfBasisCents` = sum(earning where counts_for_epf) − sum(deduction where counts_for_epf).
 *   Negative bases are clamped to zero.
 * - `payeBasisCents` is the same shape but filtered on counts_for_paye.
 * - Non-statutory deductions (e.g. advance recovery, where every counts_* flag
 *   is false) come out of take-home only — they don't reduce any basis.
 */
export function computePayrollFromComponents(input: {
  components: ResolvedComponent[];
  epfEligible: boolean;
  etfEligible: boolean;
  payeApplicable: boolean;
}): PayrollLineComputation {
  let earnings = 0;
  let epfBasis = 0;
  let etfBasis = 0;
  let payeBasis = 0;
  let nonStatDed = 0;

  for (const c of input.components) {
    const a = Math.max(0, c.amountCents);
    if (a === 0) continue;
    if (c.kind === "earning") {
      earnings += a;
      if (c.countsForEpf) epfBasis += a;
      if (c.countsForEtf) etfBasis += a;
      if (c.countsForPaye) payeBasis += a;
    } else {
      // Deduction: reduces matching bases; if it hits NO basis flag, it's a
      // post-tax take-home deduction (captured in nonStatDed).
      if (c.countsForEpf) epfBasis -= a;
      if (c.countsForEtf) etfBasis -= a;
      if (c.countsForPaye) payeBasis -= a;
      if (!c.countsForEpf && !c.countsForEtf && !c.countsForPaye) {
        nonStatDed += a;
      }
    }
  }

  epfBasis = Math.max(0, epfBasis);
  etfBasis = Math.max(0, etfBasis);
  payeBasis = Math.max(0, payeBasis);

  const epfEmployee = input.epfEligible ? computeEpfEmployee(epfBasis) : 0;
  const epfEmployer = input.epfEligible ? computeEpfEmployer(epfBasis) : 0;
  const etfEmployer = input.etfEligible ? computeEtfEmployer(etfBasis) : 0;
  const paye = input.payeApplicable ? computePaye(payeBasis) : 0;

  const totalDeductions = epfEmployee + paye + nonStatDed;
  // Net = earnings − pre-tax basis-reducers (already baked into bases) is wrong.
  // The employee actually receives: earnings − (pre-tax deductions on take-home)
  //   − (EPF employee) − PAYE − (post-tax deductions)
  // Pre-tax basis-reducers (no-pay leave) ARE also real cash reductions from
  // what the employee takes home — they're earnings that weren't earned. We
  // model that as: subtract every deduction's amount from earnings to get
  // "cash earnings", then subtract EPF employee + PAYE.
  let cashEarnings = earnings;
  for (const c of input.components) {
    if (c.kind === "deduction") cashEarnings -= Math.max(0, c.amountCents);
  }
  const net = Math.max(0, cashEarnings - epfEmployee - paye);

  return {
    earningsCents: earnings,
    grossCents: earnings,
    epfBasisCents: epfBasis,
    etfBasisCents: etfBasis,
    payeBasisCents: payeBasis,
    nonStatutoryDeductionsCents: nonStatDed,
    epfEmployeeCents: epfEmployee,
    epfEmployerCents: epfEmployer,
    etfEmployerCents: etfEmployer,
    payeCents: paye,
    totalDeductionsCents: totalDeductions,
    netPayCents: net,
  };
}

/**
 * Legacy one-component-from-basic-salary path. Used by any caller that hasn't
 * migrated to component lists yet, and by tests. Internally this just builds
 * a single "basic" earning and calls the component-aware path, so the numbers
 * stay identical.
 */
export function computePayrollLine(input: {
  basicSalaryCents: number;
  epfEligible: boolean;
  etfEligible: boolean;
  payeApplicable: boolean;
  otherDeductionsCents?: number;
}): PayrollLineComputation {
  const components: ResolvedComponent[] = [
    {
      code: "BASIC",
      name: "Basic salary",
      kind: "earning",
      amountCents: Math.max(0, input.basicSalaryCents),
      countsForEpf: true,
      countsForEtf: true,
      countsForPaye: true,
      sortOrder: 10,
    },
  ];
  if (input.otherDeductionsCents && input.otherDeductionsCents > 0) {
    components.push({
      code: "OTHER",
      name: "Other deductions",
      kind: "deduction",
      amountCents: input.otherDeductionsCents,
      countsForEpf: false,
      countsForEtf: false,
      countsForPaye: false,
      sortOrder: 100,
    });
  }
  return computePayrollFromComponents({
    components,
    epfEligible: input.epfEligible,
    etfEligible: input.etfEligible,
    payeApplicable: input.payeApplicable,
  });
}
