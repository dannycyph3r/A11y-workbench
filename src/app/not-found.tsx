import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel max-w-xl p-8">
      <h1 tabIndex={-1} className="text-2xl">Page not found</h1>
      <p className="mt-2 text-ink-2">That address is not part of A11y.</p>
      <Link href="/" className="btn btn-primary mt-4">Go to the overview</Link>
    </div>
  );
}
