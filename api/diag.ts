// @ts-expect-error Shared production handlers are plain ESM.
import { handleDiagRequest } from '../server/api-handlers.mjs';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleDiagRequest(request);
}
