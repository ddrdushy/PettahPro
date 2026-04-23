"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Upload } from "lucide-react";
import {
  api,
  ApiError,
  type AttendanceDevice,
  type AttendanceImport,
} from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";

interface Props {
  devices: AttendanceDevice[];
  imports: AttendanceImport[];
}

type ParsedRow = {
  rowNumber: number;
  raw: string[];
};

type Mapping = {
  biometricId: number | null;
  punchAt: number | null;
  direction: number | null;
};

export function ImportClient({ devices, imports }: Props) {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string>(devices[0]?.id ?? "");
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({
    biometricId: null,
    punchAt: null,
    direction: null,
  });
  const [step, setStep] = useState<"pick" | "map" | "commit">("pick");
  const [result, setResult] = useState<AttendanceImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === deviceId),
    [devices, deviceId],
  );

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setFileSize(file.size);
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      setError("File is empty.");
      return;
    }
    const parse = (line: string): string[] =>
      line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const parsedHeaders = parse(lines[0]!);
    const rows: ParsedRow[] = lines.slice(1).map((line, i) => ({
      rowNumber: i + 2,
      raw: parse(line),
    }));
    setHeaders(parsedHeaders);
    setParsed(rows);

    // Try to pre-fill mapping from saved template.
    const tpl = selectedDevice?.columnTemplate as
      | Record<string, string | undefined>
      | undefined;
    if (tpl) {
      const idxOf = (col?: string): number | null => {
        if (!col) return null;
        const i = parsedHeaders.indexOf(col);
        return i >= 0 ? i : null;
      };
      setMapping({
        biometricId: idxOf(tpl.biometricId as string),
        punchAt: idxOf(tpl.punchAt as string),
        direction: idxOf(tpl.direction as string),
      });
    } else {
      // Heuristic defaults.
      const find = (re: RegExp) =>
        parsedHeaders.findIndex((h) => re.test(h.toLowerCase()));
      setMapping({
        biometricId:
          find(/emp.*id|user.*id|biometric|enroll/) !== -1
            ? find(/emp.*id|user.*id|biometric|enroll/)
            : null,
        punchAt:
          find(/time|date|punch/) !== -1 ? find(/time|date|punch/) : null,
        direction:
          find(/in.?out|status|direction/) !== -1
            ? find(/in.?out|status|direction/)
            : null,
      });
    }
    setStep("map");
  }

  async function commit() {
    if (!deviceId) {
      setError("Pick a device first.");
      return;
    }
    if (mapping.biometricId === null || mapping.punchAt === null) {
      setError("Map at least the Biometric ID and Time columns.");
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      const rows = parsed
        .map((r) => {
          const biometric = r.raw[mapping.biometricId!]?.trim() ?? "";
          const punch = r.raw[mapping.punchAt!]?.trim() ?? "";
          let direction: "in" | "out" | null = null;
          if (mapping.direction !== null) {
            const d = (r.raw[mapping.direction] ?? "").toLowerCase();
            if (/in|0|entry/.test(d)) direction = "in";
            else if (/out|1|exit/.test(d)) direction = "out";
          }
          return {
            biometricEmployeeId: biometric,
            punchAt: new Date(punch).toISOString(),
            direction,
          };
        })
        .filter(
          (r) =>
            r.biometricEmployeeId &&
            r.punchAt &&
            !Number.isNaN(new Date(r.punchAt).getTime()),
        );
      if (rows.length === 0) {
        setError("No valid rows to import. Check your column mapping.");
        setCommitting(false);
        return;
      }
      const template = {
        biometricId: headers[mapping.biometricId!],
        punchAt: headers[mapping.punchAt!],
        direction:
          mapping.direction !== null ? headers[mapping.direction] : null,
      };
      const res = await api.createAttendanceImport({
        attendanceDeviceId: deviceId,
        fileName,
        fileSizeBytes: fileSize,
        columnTemplate: template,
        rows,
      });
      setResult(res.import);
      setStep("commit");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setCommitting(false);
    }
  }

  function reset() {
    setFileName("");
    setFileSize(0);
    setHeaders([]);
    setParsed([]);
    setMapping({ biometricId: null, punchAt: null, direction: null });
    setResult(null);
    setError(null);
    setStep("pick");
  }

  return (
    <main className="container-p py-10">
      <Link
        href="/app/attendance"
        className="inline-flex items-center gap-1.5 text-small text-text-secondary hover:text-charcoal"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to attendance
      </Link>

      <PageHeader
        eyebrow="HR · Attendance"
        title="Import from biometric device"
        description="Upload the CSV export. Map the columns once — the device remembers the layout for next time. Unmapped employee IDs are skipped and listed in the error log."
      />

      {step !== "commit" && devices.length === 0 && (
        <div className="mt-6 rounded-card border-hairline border-warning/40 bg-warning-bg/40 p-4 text-small text-charcoal">
          No devices yet.{" "}
          <Link
            href="/app/attendance/devices"
            className="underline underline-offset-4"
          >
            Register a device first
          </Link>{" "}
          — the import groups punches against a device so the mapping learns
          over time.
        </div>
      )}

      {step === "pick" && devices.length > 0 && (
        <div className="mt-6 grid gap-6 rounded-card border-hairline border-border bg-surface-elevated p-6">
          <label className="flex flex-col gap-1">
            <span className="text-small text-text-secondary">Device</span>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="input"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-small text-text-secondary">CSV file</span>
            <input
              type="file"
              accept=".csv,.txt,text/csv"
              onChange={onFileChange}
              className="text-small"
            />
            <span className="text-small text-text-secondary">
              CSV only for v1. XLSX support is a follow-up — for now open your
              Excel export, Save As → CSV.
            </span>
          </label>
          {error && (
            <p className="rounded border border-danger/40 bg-danger-bg/40 px-3 py-2 text-small text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      {step === "map" && (
        <div className="mt-6 grid gap-4 rounded-card border-hairline border-border bg-surface-elevated p-6">
          <p className="text-small text-text-secondary">
            {parsed.length} row{parsed.length === 1 ? "" : "s"} parsed from{" "}
            <span className="font-medium text-charcoal">{fileName}</span>. Map
            each column below.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">
                Biometric ID column
              </span>
              <select
                value={mapping.biometricId ?? ""}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    biometricId:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="input"
              >
                <option value="">—</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">
                Timestamp column
              </span>
              <select
                value={mapping.punchAt ?? ""}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    punchAt:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="input"
              >
                <option value="">—</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small text-text-secondary">
                Direction column (optional)
              </span>
              <select
                value={mapping.direction ?? ""}
                onChange={(e) =>
                  setMapping({
                    ...mapping,
                    direction:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="input"
              >
                <option value="">—</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="max-h-72 overflow-auto rounded-card border-hairline border-border">
            <table className="w-full text-small">
              <thead className="bg-surface-recessed">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className="px-3 py-2 text-left font-medium text-text-secondary"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 20).map((r) => (
                  <tr key={r.rowNumber} className="border-t border-border">
                    {r.raw.map((c, i) => (
                      <td key={i} className="px-3 py-1.5">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <p className="rounded border border-danger/40 bg-danger-bg/40 px-3 py-2 text-small text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={reset}
              disabled={committing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={commit}
              disabled={committing}
            >
              {committing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              Import {parsed.length} row{parsed.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {step === "commit" && result && (
        <div className="mt-6 grid gap-4 rounded-card border-hairline border-border bg-surface-elevated p-6">
          <div className="flex items-center gap-2 text-charcoal">
            <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
            <span className="font-medium">Import complete</span>
          </div>
          <dl className="grid gap-2 text-small sm:grid-cols-4">
            <div>
              <dt className="text-text-secondary">Total rows</dt>
              <dd>{result.rowsTotal}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Imported</dt>
              <dd className="font-medium text-success">
                {result.rowsImported}
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary">Skipped</dt>
              <dd>{result.rowsSkipped}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Errors</dt>
              <dd className={result.rowsErrored > 0 ? "text-danger" : ""}>
                {result.rowsErrored}
              </dd>
            </div>
          </dl>
          {result.errors.length > 0 && (
            <details className="rounded border border-danger/30 bg-danger-bg/30 p-3">
              <summary className="cursor-pointer text-small text-charcoal">
                Row-level errors ({result.errors.length})
              </summary>
              <ul className="mt-2 space-y-1 text-small text-text-secondary">
                {result.errors.slice(0, 50).map((er, i) => (
                  <li key={i}>
                    Row {er.row}
                    {er.biometricEmployeeId
                      ? ` (id: ${er.biometricEmployeeId})`
                      : ""}
                    : {er.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={reset}>
              Import another
            </button>
            <Link href="/app/attendance" className="btn-primary">
              View records
            </Link>
          </div>
        </div>
      )}

      <section className="mt-10">
        <h3 className="text-h6 font-medium text-charcoal">Recent imports</h3>
        <div className="mt-3 rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-small text-text-secondary">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Imported</th>
                <th className="px-4 py-3 font-medium">Skipped</th>
                <th className="px-4 py-3 font-medium">Errors</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {imports.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-small text-text-secondary"
                  >
                    No imports yet.
                  </td>
                </tr>
              )}
              {imports.map((imp) => (
                <tr
                  key={imp.id}
                  className="border-b border-border last:border-0 text-body"
                >
                  <td className="px-4 py-3 text-small text-text-secondary">
                    {formatDate(imp.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-small">{imp.fileName}</td>
                  <td className="px-4 py-3 text-small text-success">
                    {imp.rowsImported}
                  </td>
                  <td className="px-4 py-3 text-small">{imp.rowsSkipped}</td>
                  <td
                    className={
                      "px-4 py-3 text-small " +
                      (imp.rowsErrored > 0 ? "text-danger" : "")
                    }
                  >
                    {imp.rowsErrored}
                  </td>
                  <td className="px-4 py-3 text-small">{imp.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
