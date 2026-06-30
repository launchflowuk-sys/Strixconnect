import { getToken } from "./auth";

const BASE = "";

async function request(method: string, path: string, body?: unknown) {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try { const d = await res.json(); msg = d.error ?? msg; } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

export const apiClient = {
  get: (path: string) => request("GET", path),
  post: (path: string, body?: unknown) => request("POST", path, body),
  patch: (path: string, body?: unknown) => request("PATCH", path, body),
  put: (path: string, body?: unknown) => request("PUT", path, body),
  delete: (path: string) => request("DELETE", path),
};
