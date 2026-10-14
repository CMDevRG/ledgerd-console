import { z } from 'zod';

/** RFC 9457 problem document, as sent by ledgerd (see docs/openapi.yaml, schema Problem). */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  request_id: z.string().optional(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

/** A failed API call. `problem` is set when the server answered with a problem document. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;

  constructor(status: number, message: string, problem?: Problem) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

/**
 * GET a JSON document and validate it against `schema`.
 *
 * The response is parsed, not trusted: if the server (or a proxy in between) sends
 * something the schema does not describe, this throws instead of letting a wrong
 * shape travel through the UI. Error answers are turned into an ApiError carrying
 * the problem document when there is one.
 */
export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin), {
    headers: { Accept: 'application/json, application/problem+json' },
    ...(signal ? { signal } : {}),
  });

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const problem = problemSchema.safeParse(body);
    throw new ApiError(
      response.status,
      problem.success ? problem.data.title : `HTTP ${response.status}`,
      problem.success ? problem.data : undefined,
    );
  }
  return schema.parse(body);
}
