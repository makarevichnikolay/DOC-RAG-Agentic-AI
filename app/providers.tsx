"use client";

// Mock auth session + in-memory app state (tasks, flags, uploads, audit log).
// Session survives reloads via a client cookie; everything else lives in memory
// for the duration of the browser session — per the prototype spec.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AuditEvent,
  DocMeta,
  Flag,
  QueryResult,
  Role,
  Session,
  TaskItem,
  TaskStatus,
} from "@/lib/types";
import { DEFAULT_CLIENT_ID, SEEDS } from "@/lib/seeds";
import { roleLabel } from "@/lib/access";

const SESSION_COOKIE = "ci_session";
const CLIENT_COOKIE = "ci_client";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=86400; samesite=lax`;
}

function clearCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; max-age=0`;
}

export type LastQuery = {
  clientId: string;
  clientName: string;
  question: string;
  result: QueryResult;
};

type AppContextValue = {
  ready: boolean;
  session: Session | null;
  signIn: (role: Role, name: string) => void;
  signOut: () => void;
  clientId: string;
  setClient: (id: string) => void;
  tasks: TaskItem[];
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  markDocGenerated: (id: string) => void;
  confirmedFlags: string[];
  dismissedFlags: string[];
  confirmFlag: (args: {
    flagId: string;
    clientId: string;
    title: string;
    source: string;
  }) => void;
  dismissFlag: (flagId: string, detail: string) => void;
  uploads: Record<string, DocMeta[]>;
  addUpload: (clientId: string, doc: DocMeta) => void;
  uploadedFlags: Record<string, Flag[]>;
  addFlags: (clientId: string, flags: Flag[]) => void;
  lastQuery: LastQuery | null;
  setLastQuery: (q: LastQuery) => void;
  audit: AuditEvent[];
  log: (action: string, detail: string) => void;
  /** Drop every audit entry with this action — see clearLog below. */
  clearLog: (action: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <Providers>");
  return ctx;
}

export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [clientId, setClientId] = useState<string>(DEFAULT_CLIENT_ID);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [confirmedFlags, setConfirmedFlags] = useState<string[]>([]);
  const [dismissedFlags, setDismissedFlags] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Record<string, DocMeta[]>>({});
  const [uploadedFlags, setUploadedFlags] = useState<Record<string, Flag[]>>({});
  const [lastQuery, setLastQueryState] = useState<LastQuery | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);

  // Restore session + active client from cookies after mount (avoids hydration mismatch).
  useEffect(() => {
    const raw = readCookie(SESSION_COOKIE);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Session;
        if (parsed && parsed.role && parsed.name) setSession(parsed);
      } catch {
        clearCookie(SESSION_COOKIE);
      }
    }
    const client = readCookie(CLIENT_COOKIE);
    if (client && SEEDS.some((s) => s.clientId === client)) setClientId(client);
    setReady(true);
  }, []);

  const log = useCallback(
    (action: string, detail: string) => {
      const event: AuditEvent = {
        time: new Date().toISOString().replace("T", " ").slice(0, 19),
        user: session?.name ?? "anonymous",
        role: session ? roleLabel(session.role) : "-",
        action,
        detail,
      };
      setAudit((prev) => [event, ...prev].slice(0, 200));
    },
    [session]
  );

  // Erase one action's entries from the audit trail.
  //
  // Exists for the Discussion screen, which tells the user its conversation "is
  // discarded when you leave this page, switch client, or press End session".
  // The questions were still landing here as "discuss" entries and staying
  // readable on Settings afterwards, so the promise was false. A temporary mode
  // has to be temporary everywhere, not just in the component that renders it.
  const clearLog = useCallback((action: string) => {
    setAudit((prev) => prev.filter((e) => e.action !== action));
  }, []);

  const signIn = useCallback((role: Role, name: string) => {
    const s: Session = { role, name };
    setSession(s);
    writeCookie(SESSION_COOKIE, JSON.stringify(s));
    const event: AuditEvent = {
      time: new Date().toISOString().replace("T", " ").slice(0, 19),
      user: name,
      role: roleLabel(role),
      action: "sign_in",
      detail: `Signed in as ${roleLabel(role)} (mock login)`,
    };
    setAudit((prev) => [event, ...prev].slice(0, 200));
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    clearCookie(SESSION_COOKIE);
  }, []);

  const setClient = useCallback(
    (id: string) => {
      if (!SEEDS.some((s) => s.clientId === id)) return;
      setClientId(id);
      writeCookie(CLIENT_COOKIE, id);
      log("switch_client", `Active client set to ${id}`);
    },
    [log]
  );

  const confirmFlag = useCallback(
    (args: { flagId: string; clientId: string; title: string; source: string }) => {
      setConfirmedFlags((prev) =>
        prev.includes(args.flagId) ? prev : [...prev, args.flagId]
      );
      const task: TaskItem = {
        id: `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        clientId: args.clientId,
        title: args.title,
        source: args.source,
        status: "open",
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setTasks((prev) => [task, ...prev]);
      log("confirm_flag", `Flag confirmed -> task created: ${args.title}`);
    },
    [log]
  );

  const dismissFlag = useCallback(
    (flagId: string, detail: string) => {
      setDismissedFlags((prev) =>
        prev.includes(flagId) ? prev : [...prev, flagId]
      );
      log("dismiss_flag", detail);
    },
    [log]
  );

  const updateTaskStatus = useCallback((id: string, status: TaskStatus) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
  }, []);

  const markDocGenerated = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, docGenerated: true } : t))
    );
  }, []);

  const addUpload = useCallback(
    (cid: string, doc: DocMeta) => {
      setUploads((prev) => {
        const list = prev[cid] ?? [];
        if (list.some((d) => d.file === doc.file)) return prev;
        return { ...prev, [cid]: [...list, doc] };
      });
      log("upload_document", `Document uploaded & indexed: ${doc.title}`);
    },
    [log]
  );

  const addFlags = useCallback(
    (cid: string, flags: Flag[]) => {
      if (!flags || flags.length === 0) return;
      setUploadedFlags((prev) => {
        const existing = prev[cid] ?? [];
        const ids = new Set(existing.map((f) => f.id));
        const merged = [...existing, ...flags.filter((f) => !ids.has(f.id))];
        return { ...prev, [cid]: merged };
      });
      log("flags_detected", `${flags.length} risk flag(s) detected on upload`);
    },
    [log]
  );

  const setLastQuery = useCallback((q: LastQuery) => {
    setLastQueryState(q);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      session,
      signIn,
      signOut,
      clientId,
      setClient,
      tasks,
      updateTaskStatus,
      markDocGenerated,
      confirmedFlags,
      dismissedFlags,
      confirmFlag,
      dismissFlag,
      uploads,
      addUpload,
      uploadedFlags,
      addFlags,
      lastQuery,
      setLastQuery,
      audit,
      log,
      clearLog,
    }),
    [
      ready,
      session,
      signIn,
      signOut,
      clientId,
      setClient,
      tasks,
      updateTaskStatus,
      markDocGenerated,
      confirmedFlags,
      dismissedFlags,
      confirmFlag,
      dismissFlag,
      uploads,
      addUpload,
      uploadedFlags,
      addFlags,
      lastQuery,
      setLastQuery,
      audit,
      log,
      clearLog,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
