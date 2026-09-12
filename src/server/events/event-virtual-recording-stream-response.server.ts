import "@tanstack/react-start/server-only";

const MAXIMUM_TIMER_DELAY_MILLISECONDS = 2_147_000_000;

export function limitRecordingStreamToAuthorization(
  source: ReadableStream<Uint8Array>,
  expiresAt: Date,
  isAuthorized: () => Promise<boolean>,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  let timeout: ReturnType<typeof setTimeout>;
  let terminated = false;
  const clearDeadline = () => {
    clearTimeout(timeout);
  };
  const hasTerminated = () => terminated;
  const terminate = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    reason: string,
  ) => {
    if (terminated) return;
    terminated = true;
    clearDeadline();
    void reader.cancel(reason).catch(() => {});
    controller.error(new Error(reason));
  };
  const scheduleDeadline = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    const remainingMilliseconds = expiresAt.getTime() - Date.now();
    if (remainingMilliseconds <= 0) {
      terminate(controller, "Recording authorization expired");
      return;
    }
    timeout = setTimeout(
      () => {
        scheduleDeadline(controller);
      },
      Math.min(remainingMilliseconds, MAXIMUM_TIMER_DELAY_MILLISECONDS),
    );
    (timeout as { unref?: () => void }).unref?.();
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader = source.getReader();
      scheduleDeadline(controller);
    },
    async pull(controller) {
      if (terminated) return;
      try {
        if (!(await isAuthorized())) {
          terminate(controller, "Recording authorization revoked");
          return;
        }
        const result = await reader.read();
        if (hasTerminated()) return;
        if (result.done) {
          terminated = true;
          clearDeadline();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (hasTerminated()) return;
        terminated = true;
        clearDeadline();
        void reader.cancel(error).catch(() => {});
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (terminated) return;
      terminated = true;
      clearDeadline();
      await reader.cancel(reason);
    },
  });
}
