export interface SectionPublicationIssue {
  reason: "no_sections" | "empty_sections";
  sectionTitles: Array<string>;
}

export function sectionHasPublicationContent<Item>(
  section: { items: ReadonlyArray<Item> },
  isContentItem: (item: Item) => boolean = () => true,
): boolean {
  return section.items.some(isContentItem);
}

export function findSectionPublicationIssue<Item>(
  sections: ReadonlyArray<{
    title: string;
    items: ReadonlyArray<Item>;
  }>,
  isContentItem: (item: Item) => boolean = () => true,
): SectionPublicationIssue | null {
  if (sections.length === 0)
    return { reason: "no_sections", sectionTitles: [] };
  const sectionTitles = sections
    .filter((section) => !sectionHasPublicationContent(section, isContentItem))
    .map((section) => section.title.trim() || "Untitled section");
  return sectionTitles.length
    ? { reason: "empty_sections", sectionTitles }
    : null;
}

export function sectionPublicationMessage(
  issue: SectionPublicationIssue,
  contentLabel: string,
): string {
  if (issue.reason === "no_sections")
    return "Add at least one section before publishing.";
  if (issue.sectionTitles.length === 1)
    return `Add at least one ${contentLabel} to “${issue.sectionTitles[0] ?? "Untitled section"}” or remove that empty section before publishing.`;
  return `Add at least one ${contentLabel} to each empty section (${issue.sectionTitles
    .map((title) => `“${title}”`)
    .join(", ")}) or remove those empty sections before publishing.`;
}
