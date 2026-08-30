import { describe, expect, it } from "vitest";
import {
  findSectionPublicationIssue,
  sectionHasPublicationContent,
  sectionPublicationMessage,
} from "./section-publication";

describe("section publication validation", () => {
  it("reports a missing section collection", () => {
    const issue = findSectionPublicationIssue([]);

    expect(issue).toEqual({ reason: "no_sections", sectionTitles: [] });
    if (!issue) throw new Error("Expected a publication issue");
    expect(sectionPublicationMessage(issue, "learning item")).toBe(
      "Add at least one section before publishing.",
    );
  });

  it("names one empty section with a direct correction", () => {
    const issue = findSectionPublicationIssue([
      { title: "Pre-event", items: [] },
      { title: "Workshop", items: [{ kind: "session" }] },
    ]);

    if (!issue) throw new Error("Expected a publication issue");
    expect(sectionPublicationMessage(issue, "learning item")).toBe(
      "Add at least one learning item to “Pre-event” or remove that empty section before publishing.",
    );
  });

  it("names every empty section and can exclude administrative items", () => {
    const isLearningItem = (item: { kind: string }) =>
      item.kind !== "automated_email";
    const sections = [
      { title: "Pre-event", items: [{ kind: "automated_email" }] },
      { title: "Workshop", items: [{ kind: "session" }] },
      { title: "Follow-up", items: [] },
    ];
    const issue = findSectionPublicationIssue(sections, isLearningItem);
    const emailOnlySection = sections[0];
    if (!issue || !emailOnlySection)
      throw new Error("Expected empty publication sections");

    expect(sectionHasPublicationContent(emailOnlySection, isLearningItem)).toBe(
      false,
    );
    expect(sectionPublicationMessage(issue, "learning item")).toBe(
      "Add at least one learning item to each empty section (“Pre-event”, “Follow-up”) or remove those empty sections before publishing.",
    );
  });
});
