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
  const [autoEnroll, setAutoEnroll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const courseOptions: Array<ContractCoverageOption> = directory.courses.map(
    (course) => ({
      id: course.id,
      title: course.title,
      description: `Current published version ${String(course.version)}`,
    }),
  );
  const eventOptions: Array<ContractCoverageOption> = directory.events.map(
    (event) => ({
      id: event.id,
      title: event.title,
      description: `${formatLocalDateTime(event.startsAt, { timeZone: event.timezone })} · ${String(event.remainingPlaces)} places available`,
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
      domains: formText(data, "domains"),
      ownerEmails: formText(data, "ownerEmails"),
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
          <p className={classes.eyebrow}>Organisation access</p>
          <h1>Contract draft created</h1>
        </header>
        <Alert color="green" title="The contract is ready for review">
          Save the shared eligibility code, then activate the contract when its
          terms are ready.
        </Alert>
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
          {copyState === "failed" ? <p>Select and copy manually.</p> : null}
        </section>
      </div>
    );

  return (
    <div className={classes.pageStack}>
      <header className={classes.pageHeader}>
        <div>
          <p className={classes.eyebrow}>Organisation access</p>
          <h1>Create enterprise contract</h1>
          <p className={classes.intro}>
            Define the term, eligible workforce and learning coverage. The
            contract remains a draft until it is reviewed and activated.
          </p>
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
              <p>Use the agreement name and reference used in reporting.</p>
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
                description="Learners enter this before their identity is checked."
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
              <p>
                The term controls new claims. Each enrolment keeps its own
                access duration.
              </p>
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
                description="Days from enrolment"
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
              <p>
                A shared code never grants access alone. Learners must match a
                verified domain or uploaded employee list.
              </p>
            </header>
            <div className={classes.formGrid}>
              <MantineTextInput
                name="domains"
                component="textarea"
                label="Eligible verified-email domains"
                description="Optional if an employee list will be uploaded before activation."
              />
              <MantineTextInput
                name="ownerEmails"
                component="textarea"
                label="Contract Access Owners"
                description="Optional verified users who can view utilisation and export reports."
              />
            </div>
          </section>

          <section className={classes.formSection}>
            <header className={classes.sectionHeading}>
              <h2>Learning coverage</h2>
              <p>Search and add at least one course or scheduled event.</p>
            </header>
            <ContractCoveragePicker
              label="Covered courses"
              description="Uses the current published version at enrolment."
              emptyMessage="No courses added."
              options={courseOptions}
              selectedIds={courseIds}
              onChange={setCourseIds}
            />
            <hr className={classes.sectionDivider} />
            <ContractCoveragePicker
              label="Covered scheduled events"
              description="Only currently available events can be added."
              emptyMessage="No scheduled events added."
              options={eventOptions}
              selectedIds={eventIds}
              onChange={setEventIds}
            />
          </section>

          <footer className={classes.formActions}>
            <p>The new contract remains a draft until it is activated.</p>
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
