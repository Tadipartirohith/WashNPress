import type { Metadata } from "next";
import { OperationsPortal } from "@/components/operations/operations-portal";

export const metadata: Metadata = {
  title: "Operations",
};

export default function OperationsPage() {
  return <OperationsPortal />;
}
