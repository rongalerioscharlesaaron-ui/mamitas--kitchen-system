import { createContext, useContext, useState } from 'react';
import { USERS } from '../mock/users';

const AuthContext = createContext(null);
const KEY = 'mk_user';

function loadUser() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadUser);

  const login = (username, password) => {
    const found = USERS.find(
      (u) => u.username === username && u.password === password
    );
    if (!found) return { ok: false, message: 'Incorrect username or password.' };
    const safeUser = { username: found.username, name: found.name, role: found.role };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(safeUser));
    } catch {
      /* ignore storage errors */
    }
    setUser(safeUser);
    return { ok: true };
  };

  const logout = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}