import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { familyFormData, saveFamily } from "@/functions/families";
import { FamilyFormView } from "@/components/family-form";
import { PageHeader } from "@/components/ui";
import { firstIssue, SOMETHING_WRONG } from "@/lib/errors";

export const Route = createFileRoute("/app/families/$familyId/edit")({
  loader: async ({ params }) => {
    const data = await familyFormData({ data: { id: params.familyId } });
    if (!data?.family) throw notFound();
    return { ...data, family: data.family };
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Edit ${loaderData?.family.name ?? "family"} · Anqulas Folio` }] }),
  component: EditFamilyPage,
});

function EditFamilyPage() {
  const { family, clients } = Route.useLoaderData();
  const navigate = useNavigate();
  const back = () => navigate({ to: "/app/families/$familyId", params: { familyId: family.id } });
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={`Edit ${family.name}`} />
      <FamilyFormView
        familyId={family.id}
        initial={{
          name: family.name,
          memberIds: clients.filter((c) => c.familyId === family.id).map((c) => c.id),
          headId: clients.some((c) => c.id === family.headId) ? family.headId : null,
        }}
        clients={clients}
        submitLabel="Save changes"
        onCancel={() => void back()}
        onSubmit={async (f) => {
          try {
            const res = await saveFamily({ data: { id: family.id, family: f } });
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
