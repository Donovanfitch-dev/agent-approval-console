"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Approval queue" },
  { href: "/audit", label: "Audit log" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary">
      <ul className="flex gap-1">
        {LINKS.map((link) => {
          const current = link.href === "/" ? pathname === "/" || pathname.startsWith("/proposals") : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link href={link.href} className="chip" aria-current={current ? "true" : undefined}>
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
