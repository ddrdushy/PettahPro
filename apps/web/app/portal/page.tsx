import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Landing hit for /portal — send authenticated customers straight to
// their invoices, unauthenticated ones to the sign-in page. Kept on
// the server so we don't render and then flash-redirect.
export default async function PortalRoot() {
  const cookieHeader = cookies().toString();
  if (cookieHeader) {
    try {
      const res = await fetch(
        `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/portal/auth/me`,
        { headers: { cookie: cookieHeader }, cache: "no-store" },
      );
      if (res.ok) redirect("/portal/invoices");
    } catch {
      /* fall through to login */
    }
  }
  redirect("/portal/login");
}
