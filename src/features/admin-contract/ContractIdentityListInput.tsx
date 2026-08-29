import { useRef, useState } from "react";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Button, Group, Paper, Stack, Text } from "#/features/shared/mantine";
import classes from "./AdminEnterpriseContractManager.module.css";

const domainPattern =
  "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+";

export function ContractIdentityListInput({
  label,
  kind,
  values,
  onChange,
}: {
  label: string;
  kind: "domain" | "email";
  values: Array<string>;
  onChange: (values: Array<string>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  function addValue(): void {
    const normalized = value.trim().toLocaleLowerCase("en-AU");
    if (!normalized) return;
    if (!inputRef.current?.reportValidity()) return;
    if (!values.includes(normalized)) onChange([...values, normalized]);
    setValue("");
  }

  return (
    <Stack gap="xs">
      <Group align="end" wrap="nowrap" className={classes.addListRow}>
        <MantineTextInput
          inputRef={inputRef}
          flex={1}
          type={kind === "email" ? "email" : "text"}
          inputMode={kind === "email" ? "email" : "url"}
          label={label}
          value={value}
          {...(kind === "domain" ? { pattern: domainPattern } : {})}
          autoCapitalize="none"
          autoComplete={kind === "email" ? "email" : "off"}
          spellCheck={false}
          onChange={(event) => {
            setValue(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addValue();
          }}
        />
        <Button type="button" variant="light" onClick={addValue}>
          Add
        </Button>
      </Group>
      {values.length ? (
        <div className={classes.selectionList} aria-label={`${label} added`}>
          {values.map((entry) => (
            <Paper withBorder radius="md" p="sm" key={entry}>
              <Group justify="space-between" align="center" wrap="nowrap">
                <Text size="sm" className={classes.selectionIdentity}>
                  {entry}
                </Text>
                <Button
                  type="button"
                  size="compact-xs"
                  color="red"
                  variant="subtle"
                  onClick={() => {
                    onChange(values.filter((value) => value !== entry));
                  }}
                >
                  Remove
                </Button>
              </Group>
            </Paper>
          ))}
        </div>
      ) : null}
    </Stack>
  );
}
