import type { ApiErrorBody } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  code: string;
  retryable: boolean;
  status: number;
  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.code = body.code;
    this.retryable = body.retryable;
    this.status = status;
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

export function qs(p: Params): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  return u.toString();
}

async function handle<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  let body: ApiErrorBody;
  try {
    body = await r.json();
    if (!body?.message) throw new Error();
  } catch {
    body = { code: "http_" + r.status, message: `The data server answered ${r.status}.`, retryable: r.status >= 500 };
  }
  throw new ApiError(body, r.status);
}

export async function apiGet<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1${path}?${qs(params)}`, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError({ code: "unreachable", message: "Waking up the data server…", retryable: true }, 0);
  }
  return handle<T>(r);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError({ code: "unreachable", message: "Waking up the data server…", retryable: true }, 0);
  }
  return handle<T>(r);
}
