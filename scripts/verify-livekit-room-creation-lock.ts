import assert from "node:assert/strict";
import { destroyDatabase } from "#/server/db/database.server";
import { coordinateLiveKitRoomCreation } from "#/server/livekit/livekit-provider.server";

let activeOperations = 0;
let maximumActiveOperations = 0;

async function verifyExclusiveOperation(): Promise<void> {
  await coordinateLiveKitRoomCreation(async () => {
    activeOperations += 1;
    maximumActiveOperations = Math.max(
      maximumActiveOperations,
      activeOperations,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    activeOperations -= 1;
  });
}

try {
  await Promise.all([
    verifyExclusiveOperation(),
    verifyExclusiveOperation(),
    verifyExclusiveOperation(),
  ]);
  assert.equal(maximumActiveOperations, 1);
  assert.equal(activeOperations, 0);
  console.log(
    "Verified cross-connection LiveKit room creation coordination with a PostgreSQL advisory lock",
  );
} finally {
  await destroyDatabase();
}
