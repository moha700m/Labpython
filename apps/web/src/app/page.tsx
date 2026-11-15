"use client";
import { useEffect, useState } from "react";
import { api, type User } from "@/lib/api";
import { AuthScreen } from "@/components/AuthScreen";
import { Dashboard } from "@/components/Dashboard";
import { Spinner } from "@/components/common";

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);
  if (user === undefined)
    return (
      <div className="app-h grid place-items-center text-ink-3">
        <Spinner size={20} />
      </div>
    );
  if (!user) return <AuthScreen onAuthed={setUser} />;
  return <Dashboard user={user} onLogout={() => api.logout().then(() => setUser(null))} />;
}
