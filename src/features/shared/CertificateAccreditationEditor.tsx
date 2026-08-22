import type { CertificateAccreditation } from "#/features/catalog/accreditation";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Alert, Button, Paper, Stack, Title } from "#/features/shared/mantine";
import { useRef, useState } from "react";
import classes from "./CertificateAccreditationEditor.module.css";

const maximumLogoBytes = 2 * 1024 * 1024;

export function CertificateAccreditationEditor({
  accreditations,
  editable,
  onChange,
}: {
  accreditations: Array<CertificateAccreditation>;
  editable: boolean;
  onChange: (accreditations: Array<CertificateAccreditation>) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadIndex, setUploadIndex] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function update(
    index: number,
    change: Partial<CertificateAccreditation>,
  ): void {
    onChange(
      accreditations.map((candidate, candidateIndex) =>
        candidateIndex === index ? { ...candidate, ...change } : candidate,
      ),
    );
  }

  return (
    <Stack gap="sm">
      <Title order={3}>Accreditations</Title>
      {accreditations.map((accreditation, index) => (
        <Paper
          className={classes.card}
          key={`certificate-accreditation-${String(index)}`}
          withBorder
          radius="md"
          p="md"
        >
          <div className={classes.fields}>
            <MantineTextInput
              label="Organisation"
              value={accreditation.name}
              disabled={!editable}
              onChange={(event) => {
                update(index, { name: event.currentTarget.value });
              }}
              required
            />
            {accreditation.logoAssetId ? (
              <div className={classes.uploadedLogo}>
                <MantineTextInput
                  label="Logo name"
                  value={accreditation.logoName}
                  disabled={!editable}
                  onChange={(event) => {
                    update(index, { logoName: event.currentTarget.value });
                  }}
                  required
                />
                <Button
                  variant="default"
                  disabled={!editable}
                  loading={uploading && uploadIndex === index}
                  onClick={() => {
                    update(index, { logoAssetId: null, logoName: "" });
                  }}
                >
                  Remove logo
                </Button>
              </div>
            ) : (
              <div className={classes.logoField}>
                <span>Logo</span>
                <div>
                  <Button
                    variant="default"
                    disabled={!editable}
                    loading={uploading && uploadIndex === index}
                    onClick={() => {
                      setUploadIndex(index);
                      setUploadError(null);
                      fileInput.current?.click();
                    }}
                  >
                    Upload logo
                  </Button>
                </div>
              </div>
            )}
            <MantineTextInput
              label="CPD points"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.25"
              value={
                accreditation.cpdPoints === null
                  ? ""
                  : String(accreditation.cpdPoints)
              }
              disabled={!editable}
              onChange={(event) => {
                const value = event.currentTarget.value;
                update(index, {
                  cpdPoints:
                    value.trim() === "" || !Number.isFinite(Number(value))
                      ? null
                      : Number(value),
                });
              }}
            />
          </div>
          <div className={classes.statementRow}>
            <MantineTextInput
              component="textarea"
              label="Accreditation statement"
              value={accreditation.blurb}
              disabled={!editable}
              classNames={{ input: classes.statement }}
              onChange={(event) => {
                update(index, { blurb: event.currentTarget.value });
              }}
            />
            {editable ? (
              <Button
                variant="default"
                onClick={() => {
                  onChange(
                    accreditations.filter(
                      (_, candidateIndex) => candidateIndex !== index,
                    ),
                  );
                }}
              >
                Remove accreditation
              </Button>
            ) : null}
          </div>
        </Paper>
      ))}
      {editable && accreditations.length < 5 ? (
        <Button
          variant="light"
          onClick={() => {
            onChange([
              ...accreditations,
              {
                name: "",
                cpdPoints: null,
                blurb: "",
                logoAssetId: null,
                logoName: "",
              },
            ]);
          }}
        >
          Add accreditation
        </Button>
      ) : null}
      <input
        ref={fileInput}
        hidden
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        disabled={uploading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          const index = uploadIndex;
          if (!file || index === null) return;
          if (file.type !== "image/png" && file.type !== "image/jpeg") {
            setUploadError("Choose a PNG or JPEG logo.");
            return;
          }
          if (file.size < 1 || file.size > maximumLogoBytes) {
            setUploadError("The logo must be 2 MB or smaller.");
            return;
          }
          setUploading(true);
          setUploadError(null);
          const query = new URLSearchParams({ displayName: file.name });
          void fetch(`/api/admin/accreditation-logos?${query}`, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          })
            .then(async (response) => {
              const result = (await response.json()) as {
                logo?: { assetId: string; displayName: string };
              };
              if (!response.ok || !result.logo) throw new Error();
              update(index, {
                logoAssetId: result.logo.assetId,
                logoName: result.logo.displayName,
              });
            })
            .catch(() => {
              setUploadError("The logo could not be uploaded.");
            })
            .finally(() => {
              setUploading(false);
              setUploadIndex(null);
            });
        }}
      />
      {uploading ? <Alert color="indigo">Uploading logo…</Alert> : null}
      {uploadError ? <Alert color="red">{uploadError}</Alert> : null}
    </Stack>
  );
}
