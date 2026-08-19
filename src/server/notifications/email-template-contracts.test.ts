import { describe, expect, it } from "vitest";
import {
  fixtureEmailContext,
  getEmailTemplateContract,
  referencedEmailVariables,
  renderEmailTemplate,
  validateEmailTemplate,
} from "./email-template-contracts";

describe("governed email template contracts", () => {
  it("rejects missing mandatory and unknown variables", () => {
    expect(
      validateEmailTemplate({
        contractKey: "system.account_setup_requested",
        contractVersion: 1,
        subject: "Set up your account",
        textBody: "Hello {{user.fullName}}",
      }),
    ).toEqual({ valid: false });
    expect(
      validateEmailTemplate({
        contractKey: "offering.event",
        contractVersion: 1,
        subject: "{{user.unknown}}",
        textBody: "Event update",
      }),
    ).toEqual({ valid: false });
  });

  it("renders typed fixture variables and escapes generated HTML", () => {
    const rendered = renderEmailTemplate({
      contractKey: "offering.event",
      contractVersion: 1,
      subject: "Update: {{event.title}}",
      textBody: "Hello {{user.fullName}}\n\n{{event.title}}",
      variables: {
        ...fixtureEmailContext("offering.event", 1),
        "event.title": "Workshop <script>alert(1)</script>",
      },
    });
    expect(rendered.subject).toContain("Workshop <script>");
    expect(rendered.htmlBody).toContain("&lt;script&gt;");
    expect(rendered.htmlBody).not.toContain("<script>");
  });

  it("returns stable unique variable keys", () => {
    expect(
      referencedEmailVariables({
        subject: "{{event.title}}",
        textBody: "{{user.fullName}} {{event.title}}",
      }),
    ).toEqual(["event.title", "user.fullName"]);
  });

  it("exposes extensive, distinct course and event variable catalogues", () => {
    const course = getEmailTemplateContract("offering.course", 1);
    const event = getEmailTemplateContract("offering.event", 1);
    const courseKeys = course.variables.map((variable) => variable.key);
    const eventKeys = event.variables.map((variable) => variable.key);

    expect(course.variables.length).toBeGreaterThanOrEqual(50);
    expect(event.variables.length).toBeGreaterThanOrEqual(65);
    expect(new Set(courseKeys).size).toBe(courseKeys.length);
    expect(new Set(eventKeys).size).toBe(eventKeys.length);
    expect(courseKeys).toEqual(
      expect.arrayContaining([
        "course.certificateUrl",
        "enrolment.progressPercent",
        "order.receiptUrl",
        "user.operationalRegionName",
      ]),
    );
    expect(eventKeys).toEqual(
      expect.arrayContaining([
        "attendance.status",
        "event.registrationClosesAt",
        "registration.regionGroupCode",
        "session.virtualJoinUrl",
      ]),
    );
    expect(courseKeys).not.toContain("event.title");
    expect(eventKeys).not.toContain("course.title");
  });

  it("provides valid fixture values for every governed variable", () => {
    for (const contractKey of ["offering.course", "offering.event"]) {
      const contract = getEmailTemplateContract(contractKey, 1);
      const fixtures = fixtureEmailContext(contractKey, 1);
      for (const variable of contract.variables) {
        expect(variable.category.length).toBeGreaterThan(0);
        expect(fixtures[variable.key]).toBe(variable.fixtureValue);
        expect(variable.fixtureValue.length).toBeGreaterThan(0);
        if (variable.type === "url") {
          const url = new URL(variable.fixtureValue);
          expect(["http:", "https:"]).toContain(url.protocol);
        }
      }
    }
  });
});
