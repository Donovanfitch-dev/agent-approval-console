import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { currentRole } from "@/server/actors";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Agent Approval Console", template: "%s · Agent Approval Console" },
  description:
    "A human-in-the-loop approval gate for side-effecting actions proposed by AI agents, with a tamper-evident audit trail. Independent demonstration application; all data synthetic.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const role = await currentRole();
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader role={role} />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="px-4 py-6 text-center text-xs muted" style={{ borderTop: "1px solid var(--border)" }}>
          <p>
            An independent demonstration application, written from scratch; not extracted from any production system;
            all data synthetic. Larkspur Trail Supply is a fictional retailer. State is held in memory and resets when the
            server restarts.
          </p>
        </footer>
      </body>
    </html>
  );
}
