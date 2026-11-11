"use client";

import { use } from "react";
import { FinanceCategory } from "../../../../components/FinanceCategory";

export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <FinanceCategory slug={decodeURIComponent(slug)} />;
}
