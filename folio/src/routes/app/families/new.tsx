import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { familyFormData, saveFamily } from "@/functions/families";
import { FamilyFormView } from "@/components/family-form";
import { PageHeader } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/families/new")({
  // ?with=<client id>: started from a client's page, with that client as the head.
  validateSearch: z.object({ with: z.uuid().optional() }),
  loader: () => familyFormData({ data: {} }),
  head: () => ({ meta: [{ title: "New family · Anqulas Folio" }] }),
  component: NewFamilyPage,
});

function NewFamilyPage() {
  const data = Route.useLoaderData();
  const { with: first } = Route.useSearch();
  const navigate = useNavigate();
  const start = data?.clients.find((c) => c.id === first);
  const surname = start?.name.trim().split(/\s+/).slice(-1)[0];
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="New family" subtitle="Tick the clients who belong to this family and choose its head." />
      <FamilyFormView
        familyId={null}
        initial={{ name: start && surname ? `${surname} family` : "", memberIds: start ? [start.id] : [], headId: start?.id ?? null }}
        clients={data?.clients ?? []}
        submitLabel="Save family"
        onCancel={() => void (start ? navigate({ to: "/app/clients/$clientId", params: { clientId: start.id } }) : navigate({ to: "/app/families" }))}
        onSubmit={async (family) => {
          try {
            const res = await saveFamily({ data: { family } });
            if (!res.ok) return res.error;
            await navigate({ to: "/app/families/$familyId", params: { familyId: res.id } });
            return null;
          } catch (err) {
            return firstIssue(err) ?? SOMETHING_WRONG;
          }
        }}
      />
    </div>
  );
}
