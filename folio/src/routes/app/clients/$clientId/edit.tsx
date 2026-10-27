import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { getClient, saveClient } from "@/functions/clients";
import { ClientFormView } from "@/components/client-form";
import { PageHeader } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/clients/$clientId/edit")({
  loader: async ({ params }) => {
    const c = await getClient({ data: { id: params.clientId } });
    if (!c) throw notFound();
    return c;
  },
  head: () => ({ meta: [{ title: "Edit client · Anqulas Folio" }] }),
  component: EditClientPage,
});

function EditClientPage() {
  const c = Route.useLoaderData();
  const navigate = useNavigate();
  const back = () => navigate({ to: "/app/clients/$clientId", params: { clientId: c.id } });
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={`Edit ${c.form.name}`} />
      <ClientFormView
        initial={c.form}
        submitLabel="Save changes"
        onCancel={() => void back()}
        onSubmit={async (client) => {
          try {
            const res = await saveClient({ data: { id: c.id, client } });
            if (!res.ok) return res.error;
            await back();
            return null;
          } catch (err) {
            return firstIssue(err) ?? SOMETHING_WRONG;
          }
        }}
      />
    </div>
  );
}
