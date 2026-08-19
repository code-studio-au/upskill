import { useRef, useState } from "react";
import type { EmailTemplateVariableGroup } from "./admin-email.schema";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Button } from "#/features/shared/mantine";
import classes from "./EmailBodyEditor.module.css";

export function EmailBodyEditor({
  body,
  disabled = false,
  error,
  onChange,
  variableGroups,
}: {
  body: string;
  disabled?: boolean;
  error?: string | undefined;
  onChange: (value: string) => void;
  variableGroups: ReadonlyArray<EmailTemplateVariableGroup>;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedVariable, setSelectedVariable] = useState(
    variableGroups[0]?.items[0]?.value ?? "",
  );

  return (
    <>
      <MantineTextInput
        component="textarea"
        label="Email body"
        inputRef={inputRef}
        value={body}
        error={error}
        disabled={disabled}
        maxLength={20_000}
        classNames={{ input: classes.bodyInput }}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        required
      />
      <div className={classes.variablePicker}>
        <MantineNativeSelect
          label="Available variables"
          value={selectedVariable}
          disabled={disabled}
          data={variableGroups}
          onChange={(event) => {
            setSelectedVariable(event.currentTarget.value);
          }}
        />
        <Button
          type="button"
          variant="light"
          disabled={disabled}
          onClick={() => {
            const start = Math.min(
              inputRef.current?.selectionStart ?? body.length,
              body.length,
            );
            const end = Math.min(
              Math.max(inputRef.current?.selectionEnd ?? start, start),
              body.length,
            );
            const token = `{{${selectedVariable}}}`;
            onChange([body.slice(0, start), token, body.slice(end)].join(""));
            const nextCaret = start + token.length;
            requestAnimationFrame(() => {
              inputRef.current?.focus();
              inputRef.current?.setSelectionRange(nextCaret, nextCaret);
            });
          }}
        >
          Add variable
        </Button>
      </div>
    </>
  );
}
