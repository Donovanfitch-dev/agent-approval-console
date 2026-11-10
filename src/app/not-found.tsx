import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: { absolute: "Not found · Agent Approval Console" } };

export default function NotFound() {
  return (
    <div className="card">
      <h1 className="text-xl font-bold">Not found</h1>
      <p className="muted mt-1">That page or proposal does not exist (the demo data may have been reset).</p>
      <p className="mt-3">
        <Link href="/" className="tap">Back to the approval queue</Link>
      </p>
    </div>
  );
}
