"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./providers";

// Root: route to the dashboard when signed in, otherwise to the mock login.
export default function RootPage() {
  const { ready, session } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(session ? "/dashboard" : "/login");
  }, [ready, session, router]);

  return (
    <div className="fullcenter">
      <span className="muted">Loading Contract Intelligence…</span>
    </div>
  );
}
