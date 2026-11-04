// @ts-expect-error Shared production handlers are plain ESM.
import { handleChatRequest } from '../server/api-handlers.mjs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleChatRequest(request, process.env);
}
