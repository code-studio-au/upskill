import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { issueAccessCode } from "#/server/access/access-code.server";
import { encryptAccessCode } from "#/server/access/access-code-encryption.server";
import type { Database } from "#/server/db/types";

const CODE_INSERT_BATCH_SIZE = 500;

function chunks<T>(values: ReadonlyArray<T>, size: number): Array<Array<T>> {
  const result: Array<Array<T>> = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

async function collectAvailableGrantCodes(
  transaction: Transaction<Database>,
  prefix: string,
  count: number,
  candidates = new Map<string, string>(),
): Promise<Map<string, string>> {
  while (candidates.size < count) {
    const candidate = issueAccessCode(prefix);
    if (!candidate) throw new Error("Access-code issuance failed");
    candidates.set(candidate.lookupId, candidate.accessCode);
  }
  const existingGroups = await Promise.all(
    chunks([...candidates.keys()], CODE_INSERT_BATCH_SIZE).flatMap(
      (lookupIds) => [
        transaction
          .selectFrom("access_grant_code")
          .select("lookupId")
          .where("lookupId", "in", lookupIds)
          .execute(),
        transaction
          .selectFrom("enterprise_contract_code")
          .select("lookupId")
          .where("lookupId", "in", lookupIds)
          .execute(),
      ],
    ),
  );
  for (const row of existingGroups.flat()) candidates.delete(row.lookupId);
  return candidates.size < count
    ? await collectAvailableGrantCodes(transaction, prefix, count, candidates)
    : candidates;
}

export async function issueGrantCodes(
  transaction: Transaction<Database>,
  input: {
    accessGrantId: string;
    prefix: string;
    count: number;
    firstOrdinal: number | null;
    createdAt: Date;
  },
): Promise<Array<string>> {
  const candidates = await collectAvailableGrantCodes(
    transaction,
    input.prefix,
    input.count,
  );
  const codes = [...candidates.entries()].slice(0, input.count);
  const rows = codes.map(([lookupId, accessCode], index) => ({
    id: `access_grant_code_${randomUUID()}`,
    accessGrantId: input.accessGrantId,
    lookupId,
    encryptedAccessCode: encryptAccessCode({
      accessGrantId: input.accessGrantId,
      lookupId,
      accessCode,
    }),
    ordinal: input.firstOrdinal === null ? null : input.firstOrdinal + index,
    createdAt: input.createdAt,
  }));
  await Promise.all(
    chunks(rows, CODE_INSERT_BATCH_SIZE).map(
      async (batch) =>
        await transaction
          .insertInto("access_grant_code")
          .values(batch)
          .execute(),
    ),
  );
  return codes.map(([, accessCode]) => accessCode);
}
