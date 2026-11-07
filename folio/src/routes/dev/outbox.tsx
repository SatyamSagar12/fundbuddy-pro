import { createFileRoute } from "@tanstack/react-router";
import { getDevOutbox } from "@/functions/dev";

export const Route = createFileRoute("/dev/outbox")({
  loader: () => getDevOutbox(),
  component: () => {
    const mails = Route.useLoaderData();
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Dev outbox (local only)</h1>
        {mails.map((m, i) => (
          <article key={i} className="rounded-lg border border-line bg-card p-4">
            <p className="text-sm text-muted">
              {m.at} · to {m.to}
            </p>
            <p className="font-semibold">{m.subject}</p>
            <pre className="mt-2 text-sm whitespace-pre-wrap" data-testid="mail-body">
              {m.text}
            </pre>
          </article>
        ))}
      </main>
    );
  },
});
