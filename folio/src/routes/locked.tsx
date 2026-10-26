import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { logout } from "@/functions/auth";
import { AuthFrame, Button } from "@/components/ui";

export const Route = createFileRoute("/locked")({
  head: () => ({ meta: [{ title: "Plan ended · Anqulas Folio" }] }),
  component: () => {
    const navigate = useNavigate();
    return (
      <AuthFrame title="Your practice's plan has ended">
        <p className="text-muted">Nothing has been deleted. Ask your practice owner to renew the plan, then sign in again.</p>
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
