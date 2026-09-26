export function createOfflineScormMessageQueue<Message>(input: {
  handle(message: Message): Promise<void>;
  onError(error: unknown): void;
}): (message: Message) => void {
  let failed = false;
  let tail = Promise.resolve();
  return (message) => {
    tail = tail
      .then(async () => {
        if (!failed) await input.handle(message);
      })
      .catch((error: unknown) => {
        failed = true;
        input.onError(error);
      });
  };
}
