/** Validation errors from a server function arrive as a JSON list of issues; returns the first message. */
export function firstIssue(err: unknown): string | null {
  const message = err instanceof Error ? err.message : "";
  try {
    const issues = JSON.parse(message) as { message?: string }[];
    return Array.isArray(issues) && issues[0]?.message ? issues[0].message : null;
  } catch {
    return null;
  }
}

export const SOMETHING_WRONG = "Something went wrong. Please try again.";
