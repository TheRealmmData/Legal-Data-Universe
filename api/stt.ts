// @ts-expect-error Shared production handlers are plain ESM.
import { handleSttRequest } from '../server/api-handlers.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleSttRequest(request, process.env);
}
