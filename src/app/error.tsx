"use client";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="panel max-w-xl p-8" role="alert">
      <h1 tabIndex={-1} className="text-2xl">This view could not be shown</h1>
      <p className="mt-2 text-ink-2">Something in the session data could not be displayed. Your audits are still in this tab. Try again, or clear session data in Settings if it keeps happening.</p>
      <button type="button" className="btn btn-primary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
