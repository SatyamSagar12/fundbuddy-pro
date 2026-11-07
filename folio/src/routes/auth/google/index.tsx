import { createFileRoute } from "@tanstack/react-router";
import { startGoogle } from "@/server/google";

export const Route = createFileRoute("/auth/google/")({
  server: { handlers: { GET: () => startGoogle() } },
});
