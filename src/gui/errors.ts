export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (typeof error === "object" && error !== null) {
    const message = (error as { readonly message?: unknown }).message
    if (typeof message === "string" && message.length > 0) return message
    const type = (error as { readonly type?: unknown }).type
    if (typeof type === "string" && type.length > 0) return type
    try {
      const json = JSON.stringify(error)
      if (json && json !== "{}") return json
    } catch {
      // Fall through to String().
    }
  }
  return String(error)
}
