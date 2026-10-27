import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { saveClient } from "@/functions/clients";
import { ClientFormView } from "@/components/client-form";
import { PageHeader } from "@/components/ui";
import { EMPTY_CLIENT } from "@/lib/records";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/clients/new")({
  head: () => ({ meta: [{ title: "Add client · Anqulas Folio" }] }),
  component: NewClientPage,
});

function NewClientPage() {
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Add client" />
      <ClientFormView
        initial={EMPTY_CLIENT}
        submitLabel="Save client"
        onCancel={() => void navigate({ to: "/app/clients" })}
        onSubmit={async (client) => {
          try {
            const res = await saveClient({ data: { client } });
            if (!res.ok) return res.error;
            await navigate({ to: "/app/clients/$clientId", params: { clientId: res.id } });
            return null;
          } catch (err) {
            return firstIssue(err) ?? SOMETHING_WRONG;
          }
        }}
      />
    </div>
  );
}
