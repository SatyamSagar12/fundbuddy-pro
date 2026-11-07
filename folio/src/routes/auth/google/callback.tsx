import { createFileRoute } from "@tanstack/react-router";
import { finishGoogle } from "@/server/google";

export const Route = createFileRoute("/auth/google/callback")({
  server: { handlers: { GET: ({ request }) => finishGoogle(request) } },
});
