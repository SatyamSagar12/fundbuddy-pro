import { createFileRoute, redirect } from "@tanstack/react-router";
import { getMe } from "@/functions/auth";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const me = await getMe();
    throw redirect({ to: me?.mfaPassed ? "/app" : "/login" });
  },
});
