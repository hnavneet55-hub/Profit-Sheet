"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Store sheets" },
  { href: "/business", label: "Whole business" },
  { href: "/daily", label: "Daily check" },
  { href: "/ask", label: "Ask" },
  { href: "/orders", label: "Orders" },
  { href: "/refunds", label: "Refunds" },
  { href: "/ad-spend", label: "Ad spend" },
  { href: "/expenses", label: "Business expenses" },
  { href: "/products", label: "Products & costs" },
  { href: "/invoices", label: "Supplier invoices" },
  { href: "/quotes", label: "Supplier quotes" },
  { href: "/stores", label: "Stores" },
  { href: "/import", label: "Import old sheets" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-text"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
