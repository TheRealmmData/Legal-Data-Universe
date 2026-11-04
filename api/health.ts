// @ts-expect-error Shared production handlers are plain ESM.
import { handleHealthRequest } from '../server/api-handlers.mjs';

export const runtime = 'nodejs';

export function GET(): Response {
  return handleHealthRequest(process.env);
}
