import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { logout } from "@/functions/auth";
import { AuthFrame, Button } from "@/components/ui";

export const Route = createFileRoute("/no-access")({
  head: () => ({ meta: [{ title: "No access · Anqulas Folio" }] }),
  component: () => {
    const navigate = useNavigate();
    return (
      <AuthFrame title="No practice to open">
        <p className="text-muted">
          Your access to the practice was switched off, or the practice is suspended. Ask the practice owner to switch
          you back on.
        </p>
        <Button
          className="mt-6 w-full"
          variant="secondary"
          onClick={async () => {
            await logout();
            await navigate({ to: "/login" });
          }}
        >
          Sign out
        </Button>
      </AuthFrame>
    );
  },
});
