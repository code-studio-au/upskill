interface MessageError {
  message?: unknown;
}

export function firstFormError(
  errors: ReadonlyArray<unknown>,
): string | undefined {
  for (const error of errors) {
    if (typeof error === "string") return error;
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as MessageError).message === "string"
    ) {
      const message = (error as MessageError).message;
      if (typeof message === "string") return message;
    }
    if (Array.isArray(error)) {
      const nested = firstFormError(error);
      if (nested) return nested;
    }
    if (error && typeof error === "object") {
      const nested = firstFormError(Object.values(error));
      if (nested) return nested;
    }
  }
  return undefined;
}
