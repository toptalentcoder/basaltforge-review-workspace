"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { CheckIcon, LogoMark } from "@/components/icons";

// Mock sign-in, as the exercise permits: pick a seeded account, no password.
// The identity is mocked; the server still re-reads the role from the database
// on every request, so picking "Reviewer" here cannot grant reviewer powers.
const ACCOUNTS = [
  {
    id: "alice",
    email: "alice@company.test",
    name: "Alice Nguyen",
    initials: "AN",
    color: "#0f9488",
    role: "Writer",
    title: "Operations Analyst",
    reviewer: false,
  },
  {
    id: "carol",
    email: "carol@company.test",
    name: "Carol Mendes",
    initials: "CM",
    color: "#8b5cf6",
    role: "Writer",
    title: "People Operations",
    reviewer: false,
  },
  {
    id: "bob",
    email: "bob@company.test",
    name: "Bob Okafor",
    initials: "BO",
    color: "#3b82f6",
    role: "Reviewer",
    title: "Compliance Reviewer",
    reviewer: true,
  },
];

export function LoginForm() {
  const router = useRouter();
  const [picked, setPicked] = useState("bob");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = ACCOUNTS.find((a) => a.id === picked) ?? ACCOUNTS[0];

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(selected.email);
      router.replace(user.role === "REVIEWER" ? "/reviewer/dashboard" : "/submissions/my");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Sign-in failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      {/* soft accent glow, entirely decorative */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(91,87,240,0.16), rgba(91,87,240,0))",
        }}
      />

      <div className="relative w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <LogoMark className="h-11 w-11 text-accent" />
          <h1 className="mt-4 text-[22px] font-semibold">Welcome to Basalt Review</h1>
          <p className="mt-1.5 text-[14px] text-ink-2">Choose an account to continue.</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-2 shadow-sm">
          <div className="flex flex-col gap-1">
            {ACCOUNTS.map((account) => {
              const active = picked === account.id;
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setPicked(account.id)}
                  aria-pressed={active}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent-soft"
                      : "border-transparent hover:bg-surface-2"
                  }`}
                >
                  <span
                    style={{ backgroundColor: account.color }}
                    className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full text-[12px] font-semibold text-white"
                  >
                    {account.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold">{account.name}</span>
                      {/* One pill shape, role-tinted, with a ring so it stays
                          legible on the selected row's tinted background. */}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                          account.reviewer
                            ? "bg-accent-soft text-accent-ink ring-accent/25"
                            : "bg-surface-2 text-ink-2 ring-border-strong"
                        }`}
                      >
                        {account.role}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                      {account.title}
                    </span>
                  </span>
                  <span
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border transition-colors ${
                      active ? "border-accent bg-accent text-white" : "border-border-strong text-transparent"
                    }`}
                  >
                    <CheckIcon className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rejected-soft px-3.5 py-2.5 text-[13px] text-rejected-ink">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="btn btn-primary mt-4 w-full py-2.5 text-[14px]"
        >
          {busy ? "Signing in…" : `Continue as ${selected.name.split(" ")[0]}`}
        </button>

        <p className="mt-5 text-center text-[12px] text-ink-3">No password required.</p>
      </div>
    </div>
  );
}
