import { createServerFn } from "@tanstack/react-start";
import type { StatsPayload } from "./stats.server";
import { getCachedStats } from "./stats.server";

export type { DexStats, StatsPayload, WalletTx } from "./stats.server";

export const getStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<StatsPayload> => getCachedStats(),
);
