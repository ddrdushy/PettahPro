---
title: Attendance
sidebar_position: 8
---

# Attendance

## What it does

Attendance tracks each employee's daily presence — when they came in, when they left, whether they were absent, late, or on approved leave. For most office-based salaried businesses, this is informational. For businesses with hourly workers, shift work, factories, or strict attendance policies, attendance feeds directly into payroll.

The Attendance module is **optional** — many SL SMEs run payroll without it (they trust salaried staff are working unless told otherwise, and use Leave for tracked time off). If you don't have hourly or shift workers and don't deduct for late arrivals, you might not need this module at all.

## Setting up

**HR → Attendance → Settings.**

### Working hours

Define the standard working day:

- **Start time** — e.g. 09:00.
- **End time** — e.g. 18:00.
- **Lunch break** — typically 1 hour, unpaid.
- **Working days** — Mon-Fri, Mon-Sat, etc.

Per-employee variations possible (some staff on night shift, part-timers).

### Late and short-time policy

Configure how lateness affects pay:

- **Grace period** — typically 10–15 minutes; arrivals within grace don't count as late.
- **Penalty** — none (just record), or wage deduction (per-minute or fixed), or absent (after some threshold).
- **Half-day rule** — e.g. arriving after 12:00 = half-day absent.

Set this carefully — strict policies create friction, lax policies make attendance pointless.

### Capture method

How attendance gets into the system:

- **Manual** — HR enters daily.
- **Time clock app** — employees log in/out via the employee portal or a phone app.
- **Biometric integration** — fingerprint or face-recognition device feeds in.
- **Card swipe / RFID** — door-access system feeds in.

The right method depends on your team — biometric devices are common in factories; portal apps suit office staff.

## Walkthrough

### Daily attendance (manual)

For small teams, an HR or admin person can enter attendance daily. **HR → Attendance → Today**:

- See the list of expected employees.
- Mark each Present / Late / Absent / On leave.
- Save.

The day's attendance is locked at end-of-day; corrections need a separate "amendment" flow.

### Self-service punch in/out

If using the portal app:

1. Employee opens the portal at start of day, clicks **Punch in**. The time records.
2. At end of day, **Punch out**. Total hours computed.

Can be configured to require GPS check (employee must be at the workplace), photo (selfie at punch-in), or both. For remote workers, GPS / photo can be skipped.

### Reviewing attendance

**HR → Attendance → Calendar** shows the team in calendar format — green for present, yellow for late, red for absent, blue for leave. Useful for spotting patterns.

**HR → Attendance → Variance** highlights anomalies — employees who were late 5+ times in a month, or had unexplained absences. Worth investigating.

### Attendance feed to payroll

For hourly employees, total hours from attendance × hourly rate = base pay for the period. Auto-feeds into the next payroll run.

For salaried employees with no-pay-deduction policy, attendance lateness can deduct from gross pay according to the policy.

For salaried employees with no deduction policy, attendance is informational — payroll runs at full salary regardless.

## Common tasks

### Public holiday handling

Public holidays are pre-marked on the calendar. Employees expected to work get marked **On holiday — paid**. Employees who do work (e.g. retail open on holidays) get **On holiday — worked** with overtime applied per your policy.

### Overtime

If an employee works beyond the standard end time, the excess is overtime. PettahPro calculates: regular hours up to standard end + overtime hours after. Overtime rate (typically 1.5× or 2× regular) feeds payroll.

Configurable: which employees are eligible for overtime (often only hourly staff, not salaried managers), what the rate is, what counts as overtime (only after standard end time, or any hours over 8/day, etc.).

### Shift schedules

For shift-based businesses (hospital, factory, hotel), the attendance schedule isn't 9-to-5; each employee has assigned shifts (Morning / Evening / Night). PettahPro supports shift schedules with per-shift start/end times, shift differentials (night shift pays more), and shift-rotation patterns.

Set up in **HR → Attendance → Shifts**.

### Reconcile against leave

If an employee is on approved leave, attendance auto-marks them **On leave** (no further action). If marked **Absent** when they should have been on leave, HR can reconcile after the fact.

### Bulk-correct a day

Power outage / system down on the 14th, no attendance recorded. **HR → Attendance → Bulk update** lets HR mark all employees Present (or whatever the situation was) for that day in one go.

### Generate attendance reports

**Reports → HR → Attendance summary** by employee, by department, by date range. Punctuality scores, overtime hours, absent days. Useful for performance reviews.

## What gets posted

Attendance itself doesn't post to your books — it's tracking, not transactions.

What posts:

- For hourly employees, the attendance feeds the **payroll run** — hours × rate.
- For salaried employees with deduction policy, late-arrival deductions reduce gross in the payroll run.
- Overtime adds to gross with the appropriate multiplier.

So attendance affects payroll posting, but doesn't post on its own.

## FAQ

**Do I need attendance if I only have monthly-salaried staff with no penalty for lateness?**
Probably not. The module's value comes from feeding payroll calculations or from triggering management action on poor attendance. If neither applies, skip it.

**How do I record sick days mid-day?**
Employee was at work in the morning, fell ill, left at 14:00. Two ways: (a) record half-day attendance + half-day medical leave; (b) mark full-day medical leave (if your policy is generous). The choice affects leave balance and payroll; pick what matches your policy.

**Working from home — how do I track?**
For trusted remote workers, just configure the WFH policy (no GPS check, optional punch-in). For stricter remote tracking, require punch-in/out via the portal app, with photo or screen monitoring (the latter is a privacy / culture decision).

**An employee disputes their attendance record — they say they were on time but the system says late.**
Each attendance record links to its source — the punch-in time, the device or location it came from, etc. Pull up the record, show the timestamps. If the device clock was wrong, correct and adjust. If there's no plausible explanation, the record stands.

**Biometric integration is unreliable.**
Common — devices have hardware issues, network glitches. Always have a fallback (manual entry by HR, portal punch-in). Don't run a strict-deduction policy on a flaky capture method; staff get frustrated.

**Public holiday mid-week — does it count as attendance?**
By default yes — paid holiday. PettahPro auto-marks. If staff work on the holiday, mark them as **Worked on holiday** which feeds the holiday-pay calculation in payroll.

## Related

- [Leave](./leave.md) — leave overrides attendance.
- [Payroll](./payroll.md) — attendance feeds the run.
- [Salary components](./salary-components.md) — overtime and lateness deductions.
