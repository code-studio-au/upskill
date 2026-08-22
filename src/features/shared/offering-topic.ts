import { z } from "#/validation/zod";

export const offeringTopicSchema = z.string().check(
  z.trim(),
  z.minLength(2, "Enter a topic."),
  z.maxLength(80),
  z.refine(
    (topic) => topic.toLocaleLowerCase("en-AU") !== "all",
    'The topic name "All" is reserved for catalogue filtering.',
  ),
);

export function topicLabel(topic: string): string {
  return topic.trim();
}
