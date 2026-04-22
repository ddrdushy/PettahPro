import nodemailer, { type Transporter } from "nodemailer";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
};

export type SendEmailResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
  transport: "smtp" | "console";
};

let cachedTransport: Transporter | null = null;
let cachedTransportKind: "smtp" | "console" | null = null;

function getTransport(): { transport: Transporter; kind: "smtp" | "console" } {
  if (cachedTransport && cachedTransportKind) {
    return { transport: cachedTransport, kind: cachedTransportKind };
  }

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === "true";

  if (host && port) {
    cachedTransport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
    cachedTransportKind = "smtp";
    return { transport: cachedTransport, kind: "smtp" };
  }

  // Dev fallback — JSON transport that just serializes the message instead of
  // actually sending. Safe for local dev and tests; production must set SMTP_*.
  cachedTransport = nodemailer.createTransport({ jsonTransport: true });
  cachedTransportKind = "console";
  return { transport: cachedTransport, kind: "console" };
}

function normalizeRecipients(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { transport, kind } = getTransport();
  const from =
    process.env.EMAIL_FROM ??
    process.env.SMTP_FROM ??
    "PettahPro <no-reply@pettahpro.lk>";

  const info = await transport.sendMail({
    from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    replyTo: input.replyTo,
    subject: input.subject,
    html: input.html,
    text: input.text ?? stripHtml(input.html),
    attachments: input.attachments,
  });

  if (kind === "console") {
    // eslint-disable-next-line no-console
    console.log(
      "[email:console]",
      JSON.stringify({
        to: input.to,
        subject: input.subject,
        preview: (input.text ?? stripHtml(input.html)).slice(0, 200),
      }),
    );
  }

  const accepted = normalizeRecipients(
    (info as { accepted?: string[] }).accepted ?? input.to,
  );
  const rejected = normalizeRecipients(
    (info as { rejected?: string[] }).rejected ?? [],
  );

  return {
    messageId: info.messageId ?? "console-" + Date.now(),
    accepted,
    rejected,
    transport: kind,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
