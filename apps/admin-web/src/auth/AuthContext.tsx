import { createContext, useContext, useEffect, useState } from 'react';
import React from 'react';
import { api, clearTokens, getTokens, http, setTokens } from '../api/client';

interface Me {
  id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  is_super_admin: boolean;
  memberships: Array<{
    organization_id: string;
    organization_name: string;
    role_slug: string;
    role_name: string;
    site_id: string | null;
    room_ids: string[];
    joined_at: string | null;
    permissions: string[];
  }>;
  current_organization_id: string | null;
}

interface AuthValue {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({
  user: null,
  loading: true,
  login: async () => undefined,
  logout: async () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tokens = getTokens();
    if (!tokens.access) {
      setLoading(false);
      return;
    }
    http
      .get<Me>('/me')
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    const res = await api<{ access_token: string; refresh_token: string }>('POST', '/auth/login', {
      email,
      password,
    });
    setTokens(res.access_token, res.refresh_token);
    const me = await http.get<Me>('/me');
    setUser(me);
  };

  const logout = async (): Promise<void> => {
    const { refresh } = getTokens();
    if (refresh) {
      await api('POST', '/auth/logout', { refresh_token: refresh }).catch(() => undefined);
    }
    clearTokens();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
