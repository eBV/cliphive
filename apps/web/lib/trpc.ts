import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@cliphive/server/src/trpc/router";

export const trpc = createTRPCReact<AppRouter>();
