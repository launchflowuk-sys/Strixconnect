import { getToken, clearToken } from "@/lib/auth";

interface JwtPayload {
  sub: string;
  username: string;
  tenantId?: string;
  role?: string;
  isSuperAdmin?: boolean;
}

function parseJwt(token: string): JwtPayload | null {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function useAuth() {
  const token = getToken();
  if (!token) return { user: null, isAuthenticated: false, logout: clearToken };
  const decoded = parseJwt(token);
  if (!decoded) return { user: null, isAuthenticated: false, logout: clearToken };
  return {
    user: {
      id: decoded.sub,
      username: decoded.username,
      tenantId: decoded.tenantId,
      role: decoded.role,
      isSuperAdmin: decoded.isSuperAdmin ?? false,
    },
    isAuthenticated: true,
    logout: clearToken,
  };
}
