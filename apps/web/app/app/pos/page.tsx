import type { Metadata } from "next";
import { PosTerminal } from "./terminal";

export const metadata: Metadata = { title: "POS terminal" };

export default function PosPage() {
  return <PosTerminal />;
}
