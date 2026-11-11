"use client";

import { useParams } from "next/navigation";
import { FinanceBills } from "../../../../components/FinanceBills";

export default function BillDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  return <FinanceBills selectedId={id} />;
}
