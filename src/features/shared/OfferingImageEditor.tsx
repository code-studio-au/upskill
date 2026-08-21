import { useRef, useState } from "react";
import type { OfferingImage } from "#/features/shared/offering-image";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Alert, Button, Stack, Text } from "#/features/shared/mantine";
import classes from "./OfferingImageEditor.module.css";

const maximumImageBytes = 5 * 1024 * 1024;

function defaultAltText(fileName: string): string {
  const text = fileName
    .replace(/\.[^.]+$/u, "")
    .replaceAll(/[-_]+/gu, " ")
    .trim()
    .slice(0, 240);
  return text || "Offering cover image";
}

export function OfferingImageEditor({
  image,
  editable,
  onChange,
}: {
  image: OfferingImage;
  editable: boolean;
  onChange: (image: OfferingImage) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <Stack gap={4}>
      <Text component="span" size="sm" fw={500}>
        Cover image
      </Text>
      {image ? (
        <div className={classes.layout}>
          <MantineTextInput
            label="Alternative text"
            value={image.altText}
            maxLength={240}
            disabled={!editable}
            onChange={(event) => {
              onChange({ ...image, altText: event.currentTarget.value });
            }}
            required
          />
          {editable ? (
            <Button
              variant="default"
              onClick={() => {
                onChange(null);
              }}
            >
              Remove image
            </Button>
          ) : null}
        </div>
      ) : editable ? (
        <Button
          variant="default"
          loading={uploading}
          onClick={() => {
            setUploadError(null);
            fileInput.current?.click();
          }}
        >
          Upload cover image
        </Button>
      ) : (
        <Text size="sm" c="dimmed">
          No cover image
        </Text>
      )}
      <input
        ref={fileInput}
        hidden
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        disabled={uploading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (file.type !== "image/png" && file.type !== "image/jpeg") {
            setUploadError("Choose a PNG or JPEG image.");
            return;
          }
          if (file.size < 1 || file.size > maximumImageBytes) {
            setUploadError("The image must be 5 MB or smaller.");
            return;
          }
          setUploading(true);
          setUploadError(null);
          const query = new URLSearchParams({ displayName: file.name });
          void fetch(`/api/admin/offering-images?${query}`, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          })
            .then(async (response) => {
              const result = (await response.json()) as {
                image?: { assetId: string };
              };
              if (!response.ok || !result.image) throw new Error();
              onChange({
                assetId: result.image.assetId,
                altText: defaultAltText(file.name),
              });
            })
            .catch(() => {
              setUploadError("The cover image could not be uploaded.");
            })
            .finally(() => {
              setUploading(false);
            });
        }}
      />
      {uploading ? <Alert color="indigo">Uploading image…</Alert> : null}
      {uploadError ? <Alert color="red">{uploadError}</Alert> : null}
    </Stack>
  );
}
