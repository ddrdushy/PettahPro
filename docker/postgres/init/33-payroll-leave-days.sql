-- Informational leave-days snapshot on payroll run lines.
-- paid_leave_days   = approved paid leave (AL, CL, SL, ...) consumed in period
-- unpaid_leave_days = approved no-pay leave consumed in period
-- Both are purely informational — the actual NP deduction is already booked
-- via the auto-injected NOPAY-LV component. Paid leave doesn't reduce salary
-- by construction, but employees want to see their consumption on the slip.

ALTER TABLE payroll_run_lines
  ADD COLUMN IF NOT EXISTS paid_leave_days   numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_run_lines
  ADD COLUMN IF NOT EXISTS unpaid_leave_days numeric(6,2) NOT NULL DEFAULT 0;
