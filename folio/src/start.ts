import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

// Server functions accept only same-origin requests (checked via Sec-Fetch-Site / Origin), so another
// website cannot make a signed-in browser call them.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
}));
