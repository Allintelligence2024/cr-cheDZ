import { createContext, useContext, useEffect, useState } from 'react';
import React from 'react';
import { api, clearTokens, getAccessToken, http, setAccessToken } from '../api/client';

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
  /** Recharge le profil depuis les jetons déjà stockés (A1 : acceptation
   * d'invitation — plus de login('','') qui échouait silencieusement). */
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({
  user: null,
  loading: true,
  login: async () => undefined,
  refreshProfile: async () => undefined,
  logout: async () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  /** Recharge /me avec le token en mémoire ; échec = session invalide. */
  const refreshProfile = async (): Promise<void> => {
    if (!getAccessToken()) {
      setUser(null);
      return;
    }
    try {
      setUser(await http.get<Me>('/me'));
    } catch {
      clearTokens();
      setUser(null);
    }
  };

  useEffect(() => {
    // R14 : on tente /me directement. Si l'access token est présent en
    // mémoire (reload récent), on l'utilise. Sinon, on tente un refresh
    // silencieux via le cookie httpOnly (le client fait un /auth/refresh
    // qui pose un nouveau access_token si le cookie est valide).
    const bootstrap = async (): Promise<void> => {
      if (!getAccessToken()) {
        // Pas d'access token : on tente un refresh silencieux.
        try {
          const res = await api<{ access_token: string }>('POST', '/auth/refresh', {});
          if (res?.access_token) setAccessToken(res.access_token);
          else { setUser(null); return; }
        } catch {
          // 401 = pas de cookie / expiré. L'utilisateur n'est pas connecté.
          setUser(null);
          return;
        }
      }
      await refreshProfile();
    };
    bootstrap().finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    // R14 : web_client=true signale à l'API qu'elle doit positionner un
    // cookie httpOnly en complément du body. Pas de refresh en localStorage.
    const res = await api<{ access_token: string; refresh_token: string }>('POST', '/auth/login', {
      email,
      password,
      web_client: true,
    });
    setAccessToken(res.access_token);
    // refresh_token reste présent dans le body pour rétro-compat mais on
    // ne le persiste pas (le cookie httpOnly est la source de vérité).
    const me = await http.get<Me>('/me');
    setUser(me);
  };

  const logout = async (): Promise<void> => {
    // R14 : le cookie httpOnly est effacé côté serveur via clearRefreshCookie
    // (même si aucun refresh_token n'est passé dans le body — clearCookie est
    // idempotent). On n'envoie donc plus le refresh dans le body.
    try {
      await api('POST', '/auth/logout', {});
    } catch {
      // best-effort : même si logout serveur échoue (réseau), on nettoie
      // l'état local.
    }
    clearTokens();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, refreshProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
