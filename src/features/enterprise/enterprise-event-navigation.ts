export function alreadyRegisteredEventDestination(input: {
  registrationRequired: boolean;
  canOpenEvent: boolean;
}): "event" | "my-events" {
  return input.registrationRequired || input.canOpenEvent
    ? "event"
    : "my-events";
}
