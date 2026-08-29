import { Link, useRouter } from "@tanstack/react-router";
import { useState, type SyntheticEvent } from "react";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Alert, Button } from "#/features/shared/mantine";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { createAdminEnterpriseContract } from "#/server/functions/admin-enterprise-contract";
import type {
  AdminEnterpriseContractCreateInput,
  AdminEnterpriseContractDirectory,
} from "./admin-contract.schema";
import {
  ContractCoveragePicker,
  type ContractCoverageOption,
} from "./ContractCoveragePicker";
import { ContractIdentityListInput } from "./ContractIdentityListInput";
import classes from "./AdminEnterpriseContractManager.module.css";

const formText = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

export function AdminEnterpriseContractCreate({
  directory,
}: {
  directory: AdminEnterpriseContractDirectory;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [courseIds, setCourseIds] = useState<Array<string>>([]);
  const [eventIds, setEventIds] = useState<Array<string>>([]);
  const [domains, setDomains] = useState<Array<string>>([]);
  const [ownerEmails, setOwnerEmails] = useState<Array<string>>([]);
  const [autoEnroll, setAutoEnroll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const courseOptions: Array<ContractCoverageOption> = directory.courses.map(
    (course) => ({
      id: course.id,
      title: course.title,
    }),
  );
  const eventOptions: Array<ContractCoverageOption> = directory.events.map(
    (event) => ({
      id: event.id,
      title: `${event.title} — ${formatLocalDateTime(event.startsAt, { timeZone: event.timezone })}`,
    }),
  );

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      name: formText(data, "name"),
      reference: formText(data, "reference"),
      organizationName: formText(data, "organizationName"),
      startsOn: formText(data, "startsOn"),
      expiresOn: formText(data, "expiresOn"),
      enrollmentDurationDays: Number(formText(data, "enrollmentDurationDays")),
      autoEnrollCourses: autoEnroll,
      accessCode: formText(data, "accessCode"),
      domains: domains.join(","),
      ownerEmails: ownerEmails.join(","),
      courseIds,
      eventOccurrenceIds: eventIds,
    } as AdminEnterpriseContractCreateInput;
    if (input.expiresOn <= input.startsOn) {
      setError("The end date must be after the start date.");
      return;
    }
    if (courseIds.length + eventIds.length === 0) {
      setError("Add at least one covered course or scheduled event.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await createAdminEnterpriseContract({
        data: input,
      });
      if (response.status === "conflict")
        setError(
          response.reason === "duplicate_reference"
            ? "That contract reference is already in use."
            : "One or more selected offerings are no longer available.",
        );
      else if (response.status !== "ready")
        setError("The enterprise contract could not be created.");
      else {
        setIssuedCode(response.data.accessCode ?? null);
        setCopyState("idle");
        await router.invalidate();
      }
    } catch {
      setError("The enterprise contract could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  if (issuedCode)
    return (
      <div className={classes.pageStack}>
        <header>
          <h1>Contract draft created</h1>
        </header>
        <Alert color="green" title="The contract is ready for review" />
        <section className={classes.formSection}>
          <h2>Shared eligibility code</h2>
          <code className={classes.issuedCode}>{issuedCode}</code>
          <div className={classes.actions}>
            <Button
              type="button"
              variant="light"
              onClick={() => {
                void navigator.clipboard
                  .writeText(issuedCode)
                  .then(() => {
                    setCopyState("copied");
                  })
                  .catch(() => {
                    setCopyState("failed");
                  });
              }}
            >
              {copyState === "copied" ? "Copied" : "Copy code"}
            </Button>
            <Button component={Link} to="/admin/contracts">
              View enterprise contracts
            </Button>
          </div>
          {copyState === "failed" ? (
            <Alert color="red">Copy failed.</Alert>
          ) : null}
        </section>
      </div>
    );

  return (
    <div className={classes.pageStack}>
      <header className={classes.pageHeader}>
        <div>
          <h1>Create enterprise contract</h1>
        </div>
        <Button component={Link} to="/admin/contracts" variant="light">
          Back to contracts
        </Button>
      </header>
      {error ? <Alert color="red">{error}</Alert> : null}
      <form onSubmit={(event) => void submit(event)}>
        <div className={classes.formStack}>
          <section className={classes.formSection}>
            <header className={classes.sectionHeading}>
              <h2>Contract details</h2>
            </header>
            <div className={classes.formGrid}>
              <MantineTextInput
                name="name"
                label="Contract name"
                minLength={2}
                required
              />
              <MantineTextInput
                name="reference"
                label="Contract reference"
                minLength={2}
                required
              />
              <MantineTextInput
                name="organizationName"
                label="Organisation"
                minLength={2}
                required
              />
              <MantineTextInput
                name="accessCode"
                label="Shared eligibility code"
                autoCapitalize="characters"
                autoComplete="off"
                minLength={8}
                required
              />
            </div>
          </section>

          <section className={classes.formSection}>
            <header className={classes.sectionHeading}>
              <h2>Contract period and fulfilment</h2>
            </header>
            <div className={classes.formGridThree}>
              <MantineTextInput
                name="startsOn"
                label="Starts"
                type="date"
                required
              />
              <MantineTextInput
                name="expiresOn"
                label="Ends"
                type="date"
                required
              />
              <MantineTextInput
                name="enrollmentDurationDays"
                label="Learner access duration"
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                defaultValue="365"
                required
              />
            </div>
            <div className={classes.checkboxPanel}>
              <MantineCheckbox
                checked={autoEnroll}
                onChange={setAutoEnroll}
                label="Automatically add every covered course and scheduled event after the learner claims access and accepts information sharing"
              />
            </div>
          </section>

          <section className={classes.formSection}>
            <header className={classes.sectionHeading}>
              <h2>Eligibility and Access Owners</h2>
            </header>
            <div className={classes.formGrid}>
              <ContractIdentityListInput
                label="Eligible verified-email domains"
                kind="domain"
                values={domains}
                onChange={setDomains}
              />
              <ContractIdentityListInput
                label="Contract Access Owners"
                kind="email"
                values={ownerEmails}
                onChange={setOwnerEmails}
              />
            </div>
          </section>

          <section className={classes.formSection}>
            <header className={classes.sectionHeading}>
              <h2>Learning coverage</h2>
            </header>
            <ContractCoveragePicker
              label="Covered courses"
              emptyMessage="No courses added."
              options={courseOptions}
              selectedIds={courseIds}
              onChange={setCourseIds}
            />
            <hr className={classes.sectionDivider} />
            <ContractCoveragePicker
              label="Covered scheduled events"
              emptyMessage="No scheduled events added."
              options={eventOptions}
              selectedIds={eventIds}
              onChange={setEventIds}
            />
          </section>

          <footer className={classes.formActions}>
            <div className={classes.actions}>
              <Button component={Link} to="/admin/contracts" variant="default">
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Create draft contract
              </Button>
            </div>
          </footer>
        </div>
      </form>
    </div>
  );
}
