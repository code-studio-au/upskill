import "@tanstack/react-start/server-only";

import type {
  EmailTemplateVariableCategory,
  EmailTemplateVariableDefinition,
  EmailTemplateVariableGroup,
} from "#/features/admin-email/admin-email.schema";

const TOKEN_PATTERN = /\{\{\s*([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)\s*\}\}/gu;

export interface EmailTemplateContract {
  key: string;
  version: number;
  variables: Array<EmailTemplateVariableDefinition>;
}

function emailVariable(
  category: EmailTemplateVariableCategory,
  key: string,
  label: string,
  fixtureValue: string,
  type: EmailTemplateVariableDefinition["type"] = "text",
  required = false,
): EmailTemplateVariableDefinition {
  return { category, key, label, type, required, fixtureValue };
}

const recipientVariables = [
  emailVariable("Recipient", "user.fullName", "Full name", "Alex Learner"),
  emailVariable("Recipient", "user.firstName", "First name", "Alex"),
  emailVariable(
    "Recipient",
    "user.email",
    "Email address",
    "alex.learner@example.com",
  ),
  emailVariable(
    "Recipient",
    "user.phoneNumber",
    "Phone number",
    "+61 400 000 000",
  ),
  emailVariable(
    "Recipient",
    "user.operationalRegionName",
    "Operational region name",
    "Test North",
  ),
  emailVariable(
    "Recipient",
    "user.operationalRegionCode",
    "Operational region code",
    "TEST-NORTH",
  ),
  emailVariable(
    "Recipient",
    "user.regionGroupName",
    "Region group name",
    "NSW Health",
  ),
  emailVariable(
    "Recipient",
    "user.regionGroupCode",
    "Region group code",
    "NSW-HEALTH",
  ),
  emailVariable(
    "Recipient",
    "user.profileUrl",
    "Profile link",
    "https://upskill.example/profile",
    "url",
  ),
];

const platformVariables = [
  emailVariable("Platform", "platform.name", "Platform name", "Upskill"),
  emailVariable(
    "Platform",
    "platform.homeUrl",
    "Home link",
    "https://upskill.example",
    "url",
  ),
  emailVariable(
    "Platform",
    "platform.learningUrl",
    "My learning link",
    "https://upskill.example/dashboard",
    "url",
  ),
  emailVariable(
    "Platform",
    "platform.eventsUrl",
    "My events link",
    "https://upskill.example/my-events",
    "url",
  ),
  emailVariable(
    "Platform",
    "platform.supportEmail",
    "Support email",
    "support@upskill.example",
  ),
];

const courseVariables = [
  emailVariable(
    "Course",
    "course.title",
    "Course title",
    "Psychological safety at work",
  ),
  emailVariable(
    "Course",
    "course.summary",
    "Course summary",
    "Build practical skills for psychologically safe teams.",
  ),
  emailVariable(
    "Course",
    "course.description",
    "Course description",
    "A self-paced course with practical activities and reflection.",
  ),
  emailVariable("Course", "course.topic", "Course topic", "Safety"),
  emailVariable("Course", "course.version", "Course version", "3"),
  emailVariable("Course", "course.duration", "Course duration", "90 minutes"),
  emailVariable("Course", "course.standardPrice", "Standard price", "$179.00"),
  emailVariable("Course", "course.currentPrice", "Current price", "$149.00"),
  emailVariable("Course", "course.currency", "Currency", "AUD"),
  emailVariable("Course", "course.sectionCount", "Section count", "4"),
  emailVariable("Course", "course.activityCount", "Activity count", "8"),
  emailVariable(
    "Course",
    "course.prerequisites",
    "Prerequisites",
    "Complete the introductory module",
  ),
  emailVariable(
    "Course",
    "course.accreditations",
    "Accreditations",
    "Example Professional Body",
  ),
  emailVariable("Course", "course.cpdPoints", "CPD points", "3"),
  emailVariable(
    "Course",
    "course.certificateAvailable",
    "Certificate availability",
    "Available after completion",
  ),
  emailVariable(
    "Course",
    "course.catalogueUrl",
    "Catalogue link",
    "https://upskill.example/courses/psychological-safety-at-work",
    "url",
  ),
  emailVariable(
    "Course",
    "course.dashboardUrl",
    "Course workspace link",
    "https://upskill.example/learn/example",
    "url",
  ),
  emailVariable(
    "Course",
    "course.certificateUrl",
    "Certificate download link",
    "https://upskill.example/api/learning/certificates/example",
    "url",
  ),
];

const purchaseVariables = [
  emailVariable(
    "Purchase",
    "order.reference",
    "Order reference",
    "UP-2026-000123",
  ),
  emailVariable(
    "Purchase",
    "order.purchasedAt",
    "Purchase date",
    "18 August 2026",
  ),
  emailVariable("Purchase", "order.quantity", "Quantity", "1"),
  emailVariable("Purchase", "order.unitPrice", "Unit price", "$149.00"),
  emailVariable("Purchase", "order.total", "Order total", "$149.00"),
  emailVariable("Purchase", "order.currency", "Order currency", "AUD"),
  emailVariable(
    "Purchase",
    "order.receiptUrl",
    "Receipt link",
    "https://payments.example.com/receipts/example",
    "url",
  ),
];

const enrolmentVariables = [
  emailVariable(
    "Enrolment",
    "enrolment.status",
    "Enrolment status",
    "In progress",
  ),
  emailVariable(
    "Enrolment",
    "enrolment.enrolledAt",
    "Enrolled date",
    "18 August 2026",
  ),
  emailVariable(
    "Enrolment",
    "enrolment.expiresAt",
    "Expiry date",
    "18 August 2027",
  ),
  emailVariable(
    "Enrolment",
    "enrolment.completedAt",
    "Completion date",
    "24 August 2026",
  ),
  emailVariable(
    "Enrolment",
    "enrolment.progressPercent",
    "Progress percentage",
    "75%",
  ),
  emailVariable(
    "Enrolment",
    "enrolment.completedItemCount",
    "Completed activity count",
    "6",
  ),
  emailVariable(
    "Enrolment",
    "enrolment.totalItemCount",
    "Total activity count",
    "8",
  ),
  emailVariable(
    "Enrolment",
    "enrolment.remainingItemCount",
    "Remaining activity count",
    "2",
  ),
];

const eventVariables = [
  emailVariable(
    "Event",
    "event.title",
    "Event title",
    "Regional learning workshop",
  ),
  emailVariable(
    "Event",
    "event.summary",
    "Event summary",
    "A practical regional workshop.",
  ),
  emailVariable(
    "Event",
    "event.description",
    "Event description",
    "Interactive learning, discussion and applied activities.",
  ),
  emailVariable(
    "Event",
    "event.startsAt",
    "Event start",
    "24 August 2026 at 9:00 am",
  ),
  emailVariable(
    "Event",
    "event.endsAt",
    "Event end",
    "24 August 2026 at 4:30 pm",
  ),
  emailVariable("Event", "event.date", "Event date", "24 August 2026"),
  emailVariable("Event", "event.startTime", "Event start time", "9:00 am"),
  emailVariable("Event", "event.endTime", "Event end time", "4:30 pm"),
  emailVariable(
    "Event",
    "event.timezone",
    "Event timezone",
    "Australia/Sydney",
  ),
  emailVariable("Event", "event.deliveryMode", "Delivery mode", "In person"),
  emailVariable(
    "Event",
    "event.duration",
    "Event duration",
    "7 hours 30 minutes",
  ),
  emailVariable("Event", "event.sessionCount", "Session count", "2"),
  emailVariable(
    "Event",
    "event.locationSummary",
    "Location",
    "Learning Centre, Sydney NSW",
  ),
  emailVariable("Event", "event.venueName", "Venue name", "Learning Centre"),
  emailVariable(
    "Event",
    "event.venueAddress",
    "Venue address",
    "1 Example Street, Sydney NSW",
  ),
  emailVariable(
    "Event",
    "event.virtualJoinUrl",
    "Virtual meeting link",
    "https://meet.example.com/workshop",
    "url",
  ),
  emailVariable("Event", "event.capacity", "Event capacity", "30"),
  emailVariable("Event", "event.availablePlaces", "Available places", "8"),
  emailVariable(
    "Event",
    "event.registrationMode",
    "Registration mode",
    "Registration required",
  ),
  emailVariable(
    "Event",
    "event.registrationOpensAt",
    "Registration opens",
    "1 July 2026 at 9:00 am",
  ),
  emailVariable(
    "Event",
    "event.registrationClosesAt",
    "Registration closes",
    "17 August 2026 at 5:00 pm",
  ),
  emailVariable(
    "Event",
    "event.coordinatorLockAt",
    "Coordinator review deadline",
    "19 August 2026 at 5:00 pm",
  ),
  emailVariable(
    "Event",
    "event.administratorNames",
    "Event administrator names",
    "Admin One and Admin Two",
  ),
  emailVariable(
    "Event",
    "event.presenterNames",
    "Presenter names",
    "Presenter One and Presenter Two",
  ),
  emailVariable(
    "Event",
    "event.regionNames",
    "Event region names",
    "Test North and Test South",
  ),
  emailVariable(
    "Event",
    "event.regionGroupNames",
    "Event region group names",
    "NSW Health",
  ),
  emailVariable(
    "Event",
    "event.certificateAvailable",
    "Certificate availability",
    "Available after completion",
  ),
  emailVariable(
    "Event",
    "event.dashboardUrl",
    "Event workspace link",
    "https://upskill.example/my-events/example",
    "url",
  ),
  emailVariable(
    "Event",
    "event.publicUrl",
    "Public event link",
    "https://upskill.example/events/regional-learning-workshop",
    "url",
  ),
  emailVariable(
    "Event",
    "event.certificateUrl",
    "Certificate download link",
    "https://upskill.example/api/learning/event-certificates/example",
    "url",
  ),
];

const registrationVariables = [
  emailVariable(
    "Registration",
    "registration.status",
    "Registration status",
    "Confirmed",
  ),
  emailVariable(
    "Registration",
    "registration.submittedAt",
    "Registration date",
    "3 August 2026",
  ),
  emailVariable(
    "Registration",
    "registration.confirmedAt",
    "Confirmation date",
    "10 August 2026",
  ),
  emailVariable(
    "Registration",
    "registration.regionName",
    "Registration region name",
    "Test North",
  ),
  emailVariable(
    "Registration",
    "registration.regionCode",
    "Registration region code",
    "TEST-NORTH",
  ),
  emailVariable(
    "Registration",
    "registration.regionGroupName",
    "Registration region group name",
    "NSW Health",
  ),
  emailVariable(
    "Registration",
    "registration.regionGroupCode",
    "Registration region group code",
    "NSW-HEALTH",
  ),
];

const sessionVariables = [
  emailVariable(
    "Session",
    "session.title",
    "Session title",
    "Workshop session 1",
  ),
  emailVariable(
    "Session",
    "session.startsAt",
    "Session start",
    "24 August 2026 at 9:00 am",
  ),
  emailVariable(
    "Session",
    "session.endsAt",
    "Session end",
    "24 August 2026 at 12:30 pm",
  ),
  emailVariable("Session", "session.date", "Session date", "24 August 2026"),
  emailVariable(
    "Session",
    "session.startTime",
    "Session start time",
    "9:00 am",
  ),
  emailVariable("Session", "session.endTime", "Session end time", "12:30 pm"),
  emailVariable(
    "Session",
    "session.locationSummary",
    "Session location",
    "Learning Centre, Sydney NSW",
  ),
  emailVariable(
    "Session",
    "session.venueName",
    "Session venue name",
    "Learning Centre",
  ),
  emailVariable(
    "Session",
    "session.venueAddress",
    "Session venue address",
    "1 Example Street, Sydney NSW",
  ),
  emailVariable(
    "Session",
    "session.virtualJoinUrl",
    "Session virtual meeting link",
    "https://meet.example.com/workshop-session",
    "url",
  ),
  emailVariable(
    "Session",
    "session.presenterNames",
    "Session presenter names",
    "Presenter One and Presenter Two",
  ),
];

const attendanceVariables = [
  emailVariable(
    "Attendance",
    "attendance.status",
    "Attendance status",
    "Attended",
  ),
  emailVariable(
    "Attendance",
    "attendance.checkedInAt",
    "Checked-in time",
    "24 August 2026 at 8:55 am",
  ),
  emailVariable(
    "Attendance",
    "attendance.attendedSessionCount",
    "Attended session count",
    "2",
  ),
  emailVariable(
    "Attendance",
    "attendance.totalSessionCount",
    "Total session count",
    "2",
  ),
];

const progressVariables = [
  emailVariable(
    "Progress",
    "section.title",
    "Section title",
    "Pre-event tasks",
  ),
  emailVariable(
    "Progress",
    "activity.title",
    "Activity title",
    "Pre-event survey",
  ),
  emailVariable(
    "Progress",
    "activity.dueAt",
    "Activity due date",
    "23 August 2026 at 5:00 pm",
  ),
  emailVariable(
    "Progress",
    "progress.percent",
    "Overall progress percentage",
    "60%",
  ),
  emailVariable(
    "Progress",
    "progress.completedItemCount",
    "Completed activity count",
    "3",
  ),
  emailVariable(
    "Progress",
    "progress.totalItemCount",
    "Total activity count",
    "5",
  ),
  emailVariable(
    "Progress",
    "progress.remainingItemCount",
    "Remaining activity count",
    "2",
  ),
];

const contracts = {
  "system.account_setup_requested": {
    key: "system.account_setup_requested",
    version: 1,
    variables: [
      {
        category: "Recipient",
        key: "user.fullName",
        label: "User full name",
        type: "text",
        required: true,
        fixtureValue: "Alex Learner",
      },
      {
        category: "Account",
        key: "account.setupUrl",
        label: "Account setup link",
        type: "url",
        required: true,
        fixtureValue: "https://upskill.example/setup-account#token=example",
      },
    ],
  },
  "system.phone_verification_transferred": {
    key: "system.phone_verification_transferred",
    version: 1,
    variables: [
      emailVariable(
        "Recipient",
        "user.fullName",
        "User full name",
        "Alex Learner",
        "text",
        true,
      ),
      emailVariable(
        "Account",
        "phone.lastFour",
        "Mobile number last four digits",
        "0000",
        "text",
        true,
      ),
      emailVariable(
        "Account",
        "account.profileUrl",
        "Profile link",
        "https://upskill.example/profile",
        "url",
        true,
      ),
      emailVariable(
        "Platform",
        "platform.supportEmail",
        "Support email",
        "support@upskill.example",
        "text",
        true,
      ),
    ],
  },
  "offering.course": {
    key: "offering.course",
    version: 1,
    variables: [
      ...recipientVariables,
      ...platformVariables,
      ...courseVariables,
      ...enrolmentVariables,
      ...purchaseVariables,
      ...progressVariables,
    ],
  },
  "offering.event": {
    key: "offering.event",
    version: 1,
    variables: [
      ...recipientVariables,
      ...platformVariables,
      ...eventVariables,
      ...registrationVariables,
      ...sessionVariables,
      ...attendanceVariables,
      ...progressVariables,
    ],
  },
} as const satisfies Record<string, EmailTemplateContract>;

export type EmailTemplateContractKey = keyof typeof contracts;

export function emailContractKeyForContext(
  contextKey: string,
): EmailTemplateContractKey | null {
  if (contextKey === "system_account_setup")
    return "system.account_setup_requested";
  if (contextKey === "system_phone_verification")
    return "system.phone_verification_transferred";
  if (contextKey === "offering_course") return "offering.course";
  if (contextKey === "offering_event") return "offering.event";
  return null;
}

export function getEmailTemplateContract(
  key: string,
  version = 1,
): EmailTemplateContract {
  if (!Object.hasOwn(contracts, key))
    throw new Error("EMAIL_TEMPLATE_CONTRACT_NOT_FOUND");
  const contract = contracts[key as EmailTemplateContractKey];
  if (contract.version !== version)
    throw new Error("EMAIL_TEMPLATE_CONTRACT_NOT_FOUND");
  return contract;
}

export function emailVariableGroups(
  variables: ReadonlyArray<EmailTemplateVariableDefinition>,
): Array<EmailTemplateVariableGroup> {
  const groups = new Map<string, EmailTemplateVariableGroup["items"]>();
  for (const variable of variables) {
    const items = groups.get(variable.category) ?? [];
    items.push({
      value: variable.key,
      label: `${variable.label}${variable.required ? " *" : ""}`,
    });
    groups.set(variable.category, items);
  }
  return Array.from(groups, ([group, items]) => ({ group, items }));
}

export function referencedEmailVariables(input: {
  subject: string;
  textBody: string;
}): Array<string> {
  const keys = new Set<string>();
  for (const content of [input.subject, input.textBody]) {
    TOKEN_PATTERN.lastIndex = 0;
    for (const match of content.matchAll(TOKEN_PATTERN)) {
      const key = match[1];
      if (key) keys.add(key);
    }
  }
  return [...keys].sort();
}

export function validateEmailTemplate(
  input: {
    contractKey: string;
    contractVersion: number;
    subject: string;
    textBody: string;
  },
  options: { requireMandatoryVariables?: boolean | undefined } = {},
): { valid: true; referencedVariables: Array<string> } | { valid: false } {
  let contract: EmailTemplateContract;
  try {
    contract = getEmailTemplateContract(
      input.contractKey,
      input.contractVersion,
    );
  } catch {
    return { valid: false };
  }
  const referencedVariables = referencedEmailVariables(input);
  const referenced = new Set(referencedVariables);
  const allowed = new Set(contract.variables.map((variable) => variable.key));
  if (referencedVariables.some((key) => !allowed.has(key)))
    return { valid: false };
  if (
    options.requireMandatoryVariables !== false &&
    contract.variables.some(
      (variable) => variable.required && !referenced.has(variable.key),
    )
  )
    return { valid: false };
  return { valid: true, referencedVariables };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeTextHtml(textBody: string): string {
  return textBody
    .split(/\n{2,}/u)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
}

export function renderEmailTemplate(input: {
  contractKey: string;
  contractVersion: number;
  subject: string;
  textBody: string;
  variables: Readonly<Record<string, string>>;
  requireMandatoryVariables?: boolean;
}): { subject: string; textBody: string; htmlBody: string } {
  const validation = validateEmailTemplate(input, {
    requireMandatoryVariables: input.requireMandatoryVariables,
  });
  if (!validation.valid) throw new Error("EMAIL_TEMPLATE_INVALID");
  const contract = getEmailTemplateContract(
    input.contractKey,
    input.contractVersion,
  );
  for (const variable of contract.variables) {
    const value = input.variables[variable.key];
    if (variable.required && !value)
      throw new Error("EMAIL_TEMPLATE_CONTEXT_INVALID");
    if (value && variable.type === "url") {
      try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol))
          throw new Error("invalid protocol");
      } catch {
        throw new Error("EMAIL_TEMPLATE_CONTEXT_INVALID");
      }
    }
  }
  const replaceTokens = (content: string) => {
    TOKEN_PATTERN.lastIndex = 0;
    return content.replace(TOKEN_PATTERN, (_token, key: string) => {
      const value = input.variables[key];
      if (value === undefined)
        throw new Error("EMAIL_TEMPLATE_CONTEXT_INVALID");
      return value;
    });
  };
  const subject = replaceTokens(input.subject);
  const textBody = replaceTokens(input.textBody);
  return { subject, textBody, htmlBody: safeTextHtml(textBody) };
}

export function fixtureEmailContext(
  contractKey: string,
  contractVersion: number,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    getEmailTemplateContract(contractKey, contractVersion).variables.map(
      (variable) => [variable.key, variable.fixtureValue],
    ),
  );
}
