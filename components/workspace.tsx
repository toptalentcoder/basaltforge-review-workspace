"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  api,
  type AuditEventView,
  type SessionUser,
  type SubmissionDetail,
  type SubmissionRow,
  type SubmissionStatus,
} from "@/lib/api-client";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ClockIcon,
  FileIcon,
  FilterIcon,
  InboxIcon,
  LogOutIcon,
  LogoMark,
  PlusIcon,
  SearchIcon,
  XCircleIcon,
} from "@/components/icons";

// The app is one screen: a filter sidebar on the left, and a main area that
// shows the filtered document list (a board when Status = All, a grid for one
// status). Selecting a document opens its detail with its activity; a back link
// returns to the list. Every route renders this same component with different
// initial state, so deep links keep working. The API's vocabulary is unchanged.

/** Pending documents older than this get a subtle time cue. Presentation only. */
const SLA_DAYS = 2;
const CATEGORIES = ["Finance", "Policy", "Procurement", "Operations"];

/** The document view is wider so the body and its activity sit side by side. */
const DETAIL_COLUMN = "mx-auto w-full max-w-[1080px] px-5 sm:px-6";
/** The compose form stays a comfortable single-column width. */
const FORM_COLUMN = "mx-auto w-full max-w-[760px] px-5 sm:px-6";

type FilterKey = "ALL" | SubmissionStatus;

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
const STATUS_PILL: Record<SubmissionStatus, string> = {
  PENDING: "pill-pending",
  APPROVED: "pill-approved",
  REJECTED: "pill-rejected",
};

/** Column order for the "All" board view. */
const BOARD_COLUMNS: SubmissionStatus[] = ["PENDING", "APPROVED", "REJECTED"];

/** Per-status column styling: a tinted, outlined header dot + accent. */
const BOARD_COLUMN_STYLE: Record<SubmissionStatus, { header: string; dot: string; ring: string }> = {
  PENDING: { header: "bg-pending-soft text-pending-ink", dot: "bg-pending-dot", ring: "ring-pending-dot/25" },
  APPROVED: { header: "bg-approved-soft text-approved-ink", dot: "bg-approved-dot", ring: "ring-approved-dot/25" },
  REJECTED: { header: "bg-rejected-soft text-rejected-ink", dot: "bg-rejected-dot", ring: "ring-rejected-dot/25" },
};

type SortField = "priority" | "created" | "title";
const SORT_FIELDS: [SortField, string][] = [
  ["priority", "Priority"],
  ["created", "Created date"],
  ["title", "Title"],
];
type SortDir = "asc" | "desc";

/** Friendly, non-status avatar tints, assigned deterministically by name. */
const AVATAR_COLORS = ["#0f9488", "#3b82f6", "#8b5cf6", "#5b6472", "#0891b2", "#c026d3"];
function avatarColor(name: string): string {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
function shortAge(days: number): string {
  return days <= 0 ? "today" : `${days}d`;
}
function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Pending first, longest-waiting at the top; everything else newest first. */
function sortForQueue(rows: SubmissionRow[]): SubmissionRow[] {
  const pending = rows
    .filter((row) => row.status === "PENDING")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const rest = rows
    .filter((row) => row.status !== "PENDING")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return [...pending, ...rest];
}
function sortRows(rows: SubmissionRow[], field: SortField, dir: SortDir): SubmissionRow[] {
  if (field === "priority") return sortForQueue(rows);
  const list = [...rows];
  if (field === "created") {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } else {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }
  return dir === "desc" ? list.reverse() : list;
}

function Avatar({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: avatarColor(name) }}
      className={`inline-flex flex-none items-center justify-center rounded-full font-semibold text-white ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}
function StatusPill({ status, className = "" }: { status: SubmissionStatus; className?: string }) {
  return <span className={`pill ${STATUS_PILL[status]} ${className}`}>{STATUS_LABEL[status]}</span>;
}
function Dot() {
  return <span className="text-ink-3">·</span>;
}

/** A document card. In the board view the status pill is hidden (the column
 *  already declares the status), so cards read cleaner. */
function DocumentCard({
  row,
  isReviewer,
  onSelect,
  hidePill = false,
}: {
  row: SubmissionRow;
  isReviewer: boolean;
  onSelect: (id: string) => void;
  hidePill?: boolean;
}) {
  const days = ageDays(row.createdAt);
  const late = row.status === "PENDING" && days >= SLA_DAYS;
  const age =
    row.status === "PENDING" ? (
      <span className={`text-[11.5px] font-medium ${late ? "text-rejected-ink" : "text-ink-3"}`}>
        {shortAge(days)}
      </span>
    ) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      className="group flex h-full min-h-[96px] w-full flex-col rounded-xl border border-border bg-surface p-4 text-left shadow-xs transition-all hover:border-border-strong hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        {hidePill ? (
          <h3 className="line-clamp-2 text-[14.5px] font-semibold text-ink group-hover:text-accent-ink">
            {row.title}
          </h3>
        ) : (
          <StatusPill status={row.status} />
        )}
        {age}
      </div>
      {!hidePill && (
        <h3 className="mt-2.5 line-clamp-2 text-[15px] font-semibold text-ink group-hover:text-accent-ink">
          {row.title}
        </h3>
      )}
      <div className="mt-auto flex items-center gap-1.5 pt-3 text-[12px] text-ink-3">
        {isReviewer && <Avatar name={row.author?.name ?? "—"} className="h-5 w-5 text-[9px]" />}
        <span className="truncate">
          {isReviewer ? (row.author?.name ?? "—") : (row.category ?? "No category")}
        </span>
        {isReviewer && row.category && (
          <>
            <Dot />
            <span className="truncate">{row.category}</span>
          </>
        )}
        <span className="ml-auto whitespace-nowrap">{dateOnly(row.createdAt)}</span>
      </div>
    </button>
  );
}

/** An uppercase section label + its control(s). */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{label}</p>
      {children}
    </div>
  );
}

/** A styled dropdown that matches the app's inputs. */
function Select({
  value,
  onChange,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: React.ChangeEventHandler<HTMLSelectElement>;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        className="input cursor-pointer appearance-none py-2 pr-8"
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-ink-3" />
    </div>
  );
}

type FilterControlProps = {
  isReviewer: boolean;
  counts: Record<FilterKey, number>;
  statusFilter: FilterKey;
  setStatusFilter: (v: FilterKey) => void;
  authorFilter: string;
  setAuthorFilter: (v: string) => void;
  authorOptions: string[];
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  categoryOptions: string[];
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  searchDraft: string;
  setSearchDraft: (v: string) => void;
  sortField: SortField;
  setSortField: (v: SortField) => void;
  sortDir: SortDir;
  setSortDir: (v: SortDir) => void;
  activeCount: number;
  onClear: () => void;
};

function FilterControls(props: FilterControlProps) {
  const {
    isReviewer,
    counts,
    statusFilter,
    setStatusFilter,
    authorFilter,
    setAuthorFilter,
    authorOptions,
    categoryFilter,
    setCategoryFilter,
    categoryOptions,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    searchDraft,
    setSearchDraft,
    sortField,
    setSortField,
    sortDir,
    setSortDir,
    activeCount,
    onClear,
  } = props;

  const dirDisabled = sortField === "priority";
  const dirButton = (dir: SortDir, label: string) => {
    const active = !dirDisabled && sortDir === dir;
    return (
      <button
        type="button"
        onClick={() => setSortDir(dir)}
        disabled={dirDisabled}
        aria-pressed={active}
        className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
          active
            ? "bg-accent text-white shadow-xs"
            : "border border-border-strong bg-surface text-ink-2 hover:bg-surface-2 disabled:opacity-45 disabled:hover:bg-surface"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        {activeCount > 0 ? (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent-ink">
            {activeCount} active
          </span>
        ) : (
          <span className="text-[11.5px] text-ink-3">No filters applied</span>
        )}
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="text-[12.5px] font-medium text-accent-ink hover:underline">
            Clear all
          </button>
        )}
      </div>

      <Section label="Status">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as FilterKey)}
          ariaLabel="Filter by status"
        >
          <option value="ALL">All statuses ({counts.ALL})</option>
          <option value="PENDING">Pending ({counts.PENDING})</option>
          <option value="APPROVED">Approved ({counts.APPROVED})</option>
          <option value="REJECTED">Rejected ({counts.REJECTED})</option>
        </Select>
      </Section>

      {isReviewer && (
        <Section label="Author">
          <Select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)} ariaLabel="Filter by author">
            <option value="">All authors</option>
            {authorOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Section>
      )}

      <Section label="Category">
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          ariaLabel="Filter by category"
        >
          <option value="">All categories</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </Select>
      </Section>

      <Section label="Date range (created)">
        <div className="space-y-2">
          <div>
            <label htmlFor="date-from" className="mb-1 block text-[11.5px] text-ink-3">
              From
            </label>
            <input
              id="date-from"
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input py-2"
            />
          </div>
          <div>
            <label htmlFor="date-to" className="mb-1 block text-[11.5px] text-ink-3">
              To
            </label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="input py-2"
            />
          </div>
        </div>
      </Section>

      <Section label={isReviewer ? "Title / keyword" : "Search"}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            className="input py-2 pl-9"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={isReviewer ? "Search title or content…" : "Search title…"}
            aria-label={isReviewer ? "Search title or content" : "Search title"}
          />
        </div>
      </Section>

      <Section label="Sort by">
        <div className="space-y-2">
          <Select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} ariaLabel="Sort field">
            {SORT_FIELDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            {dirButton("asc", "↑ Asc")}
            {dirButton("desc", "↓ Desc")}
          </div>
        </div>
      </Section>
    </div>
  );
}

export function Workspace({
  user,
  initialSelectedId,
  initialComposing = false,
}: {
  user: SessionUser;
  initialSelectedId?: string;
  initialComposing?: boolean;
}) {
  const router = useRouter();
  const isReviewer = user.role === "REVIEWER";
  const homeRoute = isReviewer ? "/reviewer/dashboard" : "/submissions/my";
  const backLabel = isReviewer ? "Back to review queue" : "Back to documents";

  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [sortField, setSortField] = useState<SortField>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [authorFilter, setAuthorFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [doc, setDoc] = useState<SubmissionDetail | null>(null);
  const [events, setEvents] = useState<AuditEventView[] | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  const [composing, setComposing] = useState(initialComposing);
  const [draft, setDraft] = useState({ title: "", category: "", body: "" });

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [toast, setToast] = useState<{ message: string; tone: "ok" | "warn" } | null>(null);

  const syncUrl = useCallback((path: string) => {
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.replaceState(null, "", path);
    }
  }, []);
  const flash = useCallback((message: string, tone: "ok" | "warn") => {
    setToast({ message, tone });
  }, []);

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      if (isReviewer) {
        // Only content search runs server-side (it needs the body, which the
        // list omits). Status/author/category/date filter on the client.
        const data = await api.reviewerSubmissions({ search });
        setRows(data.submissions);
      } else {
        const data = await api.mySubmissions();
        setRows(data.submissions);
      }
    } catch (cause) {
      setRows([]);
      setListError(cause instanceof ApiError ? cause.message : "Could not load documents.");
    }
  }, [isReviewer, search]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Search applies live as the user types. Debounced so the reviewer's
  // server-side content search fires once the typing settles, not per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchDraft), 250);
    return () => clearTimeout(id);
  }, [searchDraft]);

  const loadDoc = useCallback(async (id: string) => {
    setDocError(null);
    try {
      const [detail, history] = await Promise.all([api.submission(id), api.auditHistory(id)]);
      setDoc(detail.submission);
      setEvents(history.events);
    } catch (cause) {
      setDoc(null);
      setEvents(null);
      const status = cause instanceof ApiError ? cause.status : 0;
      setDocError(
        status === 404
          ? "This document doesn’t exist, or it isn’t yours to read."
          : cause instanceof ApiError
            ? cause.message
            : "Could not load this document.",
      );
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDoc(selectedId);
    else {
      setDoc(null);
      setEvents(null);
      setDocError(null);
    }
  }, [selectedId, loadDoc]);

  const baseList = useMemo(() => {
    let list = rows ?? [];
    if (!isReviewer && search.trim()) {
      const needle = search.trim().toLowerCase();
      list = list.filter((row) => row.title.toLowerCase().includes(needle));
    }
    if (isReviewer && authorFilter) list = list.filter((row) => (row.author?.name ?? "") === authorFilter);
    if (categoryFilter) list = list.filter((row) => (row.category ?? "") === categoryFilter);
    if (dateFrom) {
      const from = new Date(`${dateFrom}T00:00:00`).getTime();
      list = list.filter((row) => new Date(row.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(`${dateTo}T23:59:59.999`).getTime();
      list = list.filter((row) => new Date(row.createdAt).getTime() <= to);
    }
    return list;
  }, [rows, isReviewer, search, authorFilter, categoryFilter, dateFrom, dateTo]);

  const visibleRows = useMemo(() => {
    const list = filter === "ALL" ? baseList : baseList.filter((row) => row.status === filter);
    return sortRows(list, sortField, sortDir);
  }, [baseList, filter, sortField, sortDir]);

  // For the "All" board view: rows split into their status columns.
  const board = useMemo(
    () => ({
      PENDING: sortRows(baseList.filter((r) => r.status === "PENDING"), sortField, sortDir),
      APPROVED: sortRows(baseList.filter((r) => r.status === "APPROVED"), sortField, sortDir),
      REJECTED: sortRows(baseList.filter((r) => r.status === "REJECTED"), sortField, sortDir),
    }),
    [baseList, sortField, sortDir],
  );

  const counts = useMemo<Record<FilterKey, number>>(
    () => ({
      ALL: baseList.length,
      PENDING: baseList.filter((r) => r.status === "PENDING").length,
      APPROVED: baseList.filter((r) => r.status === "APPROVED").length,
      REJECTED: baseList.filter((r) => r.status === "REJECTED").length,
    }),
    [baseList],
  );

  const authorOptions = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.author?.name).filter((n): n is string => Boolean(n)))].sort(),
    [rows],
  );
  const categoryOptions = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.category).filter((c): c is string => Boolean(c)))].sort(),
    [rows],
  );

  const activeFilterCount =
    (filter !== "ALL" ? 1 : 0) +
    (authorFilter ? 1 : 0) +
    (categoryFilter ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (search.trim() ? 1 : 0);

  function clearAllFilters() {
    setFilter("ALL");
    setAuthorFilter("");
    setCategoryFilter("");
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setSearchDraft("");
  }

  function selectRow(id: string) {
    setSelectedId(id);
    setComposing(false);
    setRejecting(false);
    setReason("");
    syncUrl(`/submissions/${id}`);
  }

  function backToList() {
    setSelectedId(null);
    setComposing(false);
    setRejecting(false);
    setReason("");
    syncUrl(homeRoute);
  }

  function startCompose() {
    setComposing(true);
    setRejecting(false);
    syncUrl("/submissions/new");
  }

  function cancelCompose() {
    setComposing(false);
    setDraft({ title: "", category: "", body: "" });
    syncUrl(selectedId ? `/submissions/${selectedId}` : homeRoute);
  }

  async function submitDraft() {
    if (!draft.title.trim() || !draft.body.trim()) return;
    setBusy(true);
    try {
      const { submission } = await api.createSubmission({
        title: draft.title.trim(),
        body: draft.body.trim(),
        ...(draft.category ? { category: draft.category } : {}),
      });
      setDraft({ title: "", category: "", body: "" });
      setComposing(false);
      setFilter("ALL");
      setSelectedId(submission.id);
      syncUrl(`/submissions/${submission.id}`);
      await loadList();
      flash("Sent for review", "ok");
      router.refresh();
    } catch (cause) {
      flash(cause instanceof ApiError ? cause.message : "Could not send that document.", "warn");
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (!doc) return;
    if (action === "reject" && !reason.trim()) return;
    setBusy(true);
    try {
      if (action === "approve") await api.approve(doc.id);
      else await api.reject(doc.id, reason.trim());
      setRejecting(false);
      setReason("");
      await Promise.all([loadDoc(doc.id), loadList()]);
      flash(action === "approve" ? "Approved" : "Rejected", "ok");
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        await Promise.all([loadDoc(doc.id), loadList()]);
        flash(`${cause.message} — refreshed.`, "warn");
      } else if (cause instanceof ApiError && cause.status === 403) {
        flash("You don’t have permission to decide this.", "warn");
      } else {
        flash(cause instanceof ApiError ? cause.message : "Could not record that decision.", "warn");
      }
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const filterControlProps: FilterControlProps = {
    isReviewer,
    counts,
    statusFilter: filter,
    setStatusFilter: setFilter,
    authorFilter,
    setAuthorFilter,
    authorOptions,
    categoryFilter,
    setCategoryFilter,
    categoryOptions,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    searchDraft,
    setSearchDraft,
    sortField,
    setSortField,
    sortDir,
    setSortDir,
    activeCount: activeFilterCount,
    onClear: clearAllFilters,
  };

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-[640px] lg:overflow-hidden">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="flex h-14 flex-none items-center gap-3 border-b border-border bg-surface px-4 sm:px-5">
        <span className="flex items-center gap-2.5">
          <LogoMark className="h-[26px] w-[26px] text-accent" />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Basalt Review</span>
        </span>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="flex items-center gap-2.5">
            <Avatar name={user.name} className="h-8 w-8 text-[12px]" />
            <span className="hidden leading-tight sm:block">
              <span className="block text-[13px] font-medium">{user.name}</span>
              <span className="block text-[12px] text-ink-3">{isReviewer ? "Reviewer" : "Writer"}</span>
            </span>
          </span>
          <button type="button" onClick={signOut} className="btn btn-ghost" aria-label="Sign out">
            <LogOutIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* ── Main: filter sidebar + content ───────────────────────────────── */}
      <main
        className={`grid min-h-0 flex-1 grid-cols-1 ${
          sidebarCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[288px_minmax(0,1fr)]"
        }`}
      >
        {/* Filter sidebar (desktop) */}
        {!sidebarCollapsed && (
          <aside className="hidden border-r border-border bg-surface lg:flex lg:min-h-0 lg:flex-col">
            <div className="flex flex-none items-center justify-between border-b border-border px-4 py-3.5">
              <span className="flex items-center gap-2">
                <FilterIcon className="h-4 w-4 text-ink-2" />
                <h2 className="text-[15px] font-semibold">Filters</h2>
              </span>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Collapse filters"
                className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <FilterControls {...filterControlProps} />
            </div>
          </aside>
        )}

        {/* Content: list, detail, or compose */}
        <section className="flex min-w-0 flex-col bg-canvas lg:min-h-0">
          {composing ? (
            <ComposePane
              draft={draft}
              busy={busy}
              backLabel={backLabel}
              onChange={setDraft}
              onSubmit={submitDraft}
              onCancel={cancelCompose}
            />
          ) : selectedId ? (
            doc && !docError ? (
              <DocumentPane
                doc={doc}
                events={events}
                isReviewer={isReviewer}
                rejecting={rejecting}
                reason={reason}
                busy={busy}
                backLabel={backLabel}
                onBack={backToList}
                onApprove={() => void decide("approve")}
                onOpenReject={() => setRejecting(true)}
                onCancelReject={() => {
                  setRejecting(false);
                  setReason("");
                }}
                onReasonChange={setReason}
                onConfirmReject={() => void decide("reject")}
              />
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex-none border-b border-border bg-surface">
                  <div className={`${DETAIL_COLUMN} py-3.5`}>
                    <BackLink onClick={backToList} label={backLabel} />
                  </div>
                </div>
                <div className="flex flex-1 items-center justify-center p-10 text-center">
                  {docError ? (
                    <div className="max-w-[36ch]">
                      <h2 className="text-[18px] font-semibold">Not available</h2>
                      <p className="mt-1.5 text-[14px] text-ink-2">{docError}</p>
                    </div>
                  ) : (
                    <p className="text-[14px] text-ink-3">Loading…</p>
                  )}
                </div>
              </div>
            )
          ) : (
            /* ── Document list ── */
            <div className="flex min-w-0 flex-col lg:min-h-0">
              <div className="flex-none border-b border-border bg-surface px-5 py-3 sm:px-6">
                <div className="flex items-center gap-2">
                  {sidebarCollapsed && (
                    <button
                      type="button"
                      onClick={() => setSidebarCollapsed(false)}
                      className="hidden items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 lg:inline-flex"
                    >
                      <FilterIcon className="h-3.5 w-3.5" />
                      Filters
                      {activeFilterCount > 0 && (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                          {activeFilterCount}
                        </span>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setMobileFiltersOpen((open) => !open)}
                    aria-expanded={mobileFiltersOpen}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors lg:hidden ${
                      mobileFiltersOpen || activeFilterCount > 0
                        ? "border-accent/40 bg-accent-soft text-accent-ink"
                        : "border-border bg-surface text-ink-2 hover:bg-surface-2"
                    }`}
                  >
                    <FilterIcon className="h-3.5 w-3.5" />
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>

                  <h1 className="hidden text-[15px] font-semibold sm:block">
                    {isReviewer ? "Review queue" : "Documents"}
                  </h1>
                  {rows !== null && (
                    <span className="hidden h-5 min-w-[20px] items-center justify-center rounded-full bg-surface-2 px-1.5 text-[12px] font-semibold text-ink-2 sm:inline-flex">
                      {visibleRows.length}
                    </span>
                  )}

                  {!isReviewer && (
                    <button type="button" onClick={startCompose} className="btn btn-primary ml-auto px-3 py-2">
                      <PlusIcon className="h-4 w-4" />
                      New
                    </button>
                  )}
                </div>

                {/* Mobile filter panel (the sidebar's controls) */}
                {mobileFiltersOpen && (
                  <div className="mt-3 rounded-lg border border-border bg-surface-2/60 p-3 lg:hidden">
                    <FilterControls {...filterControlProps} />
                  </div>
                )}
              </div>

              <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                <div className="px-5 py-5 sm:px-6">
                  {listError && (
                    <div className="rounded-lg bg-rejected-soft px-4 py-3 text-[13px] text-rejected-ink">
                      <p>{listError}</p>
                      <button type="button" onClick={() => void loadList()} className="mt-1.5 font-medium underline">
                        Try again
                      </button>
                    </div>
                  )}

                  {rows === null && !listError && (
                    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-[128px] animate-pulse rounded-xl bg-surface-2" />
                      ))}
                    </div>
                  )}

                  {rows !== null && !listError && visibleRows.length > 0 && (
                    <>
                      {filter === "ALL" ? (
                        /* Board: one outlined, color-headed column per status. */
                        <div className="grid gap-4 md:grid-cols-3">
                          {BOARD_COLUMNS.map((status) => {
                            const style = BOARD_COLUMN_STYLE[status];
                            const items = board[status];
                            return (
                              <section
                                key={status}
                                className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-2/40 shadow-md"
                              >
                                <header
                                  className={`flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 ${style.header}`}
                                >
                                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                                    <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                                    {STATUS_LABEL[status]}
                                  </span>
                                  <span
                                    className={`rounded-full bg-surface px-2 py-0.5 text-[12px] font-semibold ring-1 ring-inset ${style.ring}`}
                                  >
                                    {items.length}
                                  </span>
                                </header>
                                {items.length > 0 ? (
                                  <ul className="space-y-2.5 p-2.5">
                                    {items.map((row) => (
                                      <li key={row.id}>
                                        <DocumentCard row={row} isReviewer={isReviewer} onSelect={selectRow} hidePill />
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="px-3 py-8 text-center text-[12.5px] text-ink-3">Nothing here</p>
                                )}
                              </section>
                            );
                          })}
                        </div>
                      ) : (
                        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                          {visibleRows.map((row) => (
                            <li key={row.id}>
                              <DocumentCard row={row} isReviewer={isReviewer} onSelect={selectRow} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}

                  {rows !== null && !listError && visibleRows.length === 0 && (
                    <div className="flex flex-col items-center px-6 py-16 text-center">
                      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink-3">
                        <InboxIcon className="h-5 w-5" />
                      </span>
                      <p className="text-[14px] font-medium">No documents found</p>
                      <p className="mt-1 max-w-sm text-[13px] text-ink-3">
                        {activeFilterCount > 0
                          ? "Try clearing the filters to see everything."
                          : isReviewer
                            ? "Submissions will appear here as they arrive."
                            : "You haven’t sent any documents yet."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed right-4 bottom-4 left-4 z-30 flex animate-[rise_.18s_ease-out] items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg sm:left-auto sm:max-w-sm">
          <span
            className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${
              toast.tone === "warn" ? "bg-rejected-soft text-rejected-ink" : "bg-approved-soft text-approved-ink"
            }`}
          >
            {toast.tone === "warn" ? <XCircleIcon className="h-4 w-4" /> : <CheckIcon className="h-3.5 w-3.5" />}
          </span>
          <span className="flex-1 text-[13.5px] font-medium">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[13px] font-medium text-ink-3 hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function BackLink({ onClick, label = "Back to documents" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
    >
      <ArrowLeftIcon className="h-4 w-4" />
      {label}
    </button>
  );
}

/** A centered confirmation dialog. Backdrop click and Escape both cancel. */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmTone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmTone?: "primary" | "danger" | "approve";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm animate-[rise_.15s_ease-out] rounded-xl border border-border bg-surface p-5 shadow-lg"
      >
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{message}</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost px-4 py-2">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`btn px-4 py-2 ${
              confirmTone === "danger" ? "btn-danger-solid" : confirmTone === "approve" ? "btn-approve" : "btn-primary"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposePane({
  draft,
  busy,
  backLabel,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: { title: string; category: string; body: string };
  busy: boolean;
  backLabel: string;
  onChange: (next: { title: string; category: string; body: string }) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const ready = draft.title.trim() && draft.body.trim();
  const dirty = Boolean(draft.title.trim() || draft.body.trim());
  const [confirm, setConfirm] = useState<"send" | "discard" | null>(null);

  function requestCancel() {
    if (dirty) setConfirm("discard");
    else onCancel();
  }

  return (
    <>
      <div className="flex-none border-b border-border bg-surface">
        <div className={`${FORM_COLUMN} py-3.5`}>
          <BackLink onClick={requestCancel} label={backLabel} />
          <h1 className="mt-1.5 text-[18px] font-semibold">New document</h1>
        </div>
      </div>

      <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className={`${FORM_COLUMN} flex flex-1 flex-col py-6`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <label htmlFor="draft-title" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Title
              </label>
              <input
                id="draft-title"
                className="input"
                value={draft.title}
                onChange={(event) => onChange({ ...draft, title: event.target.value })}
                placeholder="Q3 Budget Proposal"
                maxLength={200}
              />
            </div>
            <div>
              <label htmlFor="draft-category" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Category
              </label>
              <div className="relative">
                <select
                  id="draft-category"
                  className="input cursor-pointer appearance-none pr-9"
                  value={draft.category}
                  onChange={(event) => onChange({ ...draft, category: event.target.value })}
                >
                  <option value="">No category</option>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-1 flex-col">
            <label htmlFor="draft-body" className="mb-1.5 block text-[13px] font-medium text-ink-2">
              Document
            </label>
            <textarea
              id="draft-body"
              className="input min-h-[300px] flex-1"
              value={draft.body}
              onChange={(event) => onChange({ ...draft, body: event.target.value })}
              placeholder="Start writing…"
            />
          </div>
        </div>
      </div>

      <div className="flex-none border-t border-border bg-surface">
        <div className={`${FORM_COLUMN} flex items-center gap-2.5 py-3.5`}>
          <button
            type="button"
            onClick={() => setConfirm("send")}
            disabled={busy || !ready}
            className="btn btn-primary px-4 py-2.5"
          >
            {busy ? "Sending…" : "Send for review"}
          </button>
          <button type="button" onClick={requestCancel} disabled={busy} className="btn btn-ghost px-4 py-2.5">
            Cancel
          </button>
        </div>
      </div>

      {confirm === "send" && (
        <ConfirmDialog
          title="Send for review?"
          message="Once sent, the document is locked — a reviewer reads exactly what you submit, and it can’t be edited afterward."
          confirmLabel="Send for review"
          cancelLabel="Keep editing"
          busy={busy}
          onConfirm={() => {
            setConfirm(null);
            onSubmit();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "discard" && (
        <ConfirmDialog
          title="Discard this document?"
          message="Your draft will be lost. This can’t be undone."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          confirmTone="danger"
          onConfirm={() => {
            setConfirm(null);
            onCancel();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

function DocumentPane({
  doc,
  events,
  isReviewer,
  rejecting,
  reason,
  busy,
  backLabel,
  onBack,
  onApprove,
  onOpenReject,
  onCancelReject,
  onReasonChange,
  onConfirmReject,
}: {
  doc: SubmissionDetail;
  events: AuditEventView[] | null;
  isReviewer: boolean;
  rejecting: boolean;
  reason: string;
  busy: boolean;
  backLabel: string;
  onBack: () => void;
  onApprove: () => void;
  onOpenReject: () => void;
  onCancelReject: () => void;
  onReasonChange: (value: string) => void;
  onConfirmReject: () => void;
}) {
  const canDecide = isReviewer && doc.status === "PENDING";
  const [confirmApprove, setConfirmApprove] = useState(false);

  return (
    <>
      {/* Header */}
      <div className="flex-none border-b border-border bg-surface">
        <div className={`${DETAIL_COLUMN} py-4`}>
          <BackLink onClick={onBack} label={backLabel} />
          <div className="mt-3 flex items-start gap-3">
            <h1 className="flex-1 text-[20px] font-semibold break-words sm:text-[22px]">{doc.title}</h1>
            <StatusPill status={doc.status} className="mt-1 flex-none" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <Avatar name={doc.author.name} className="h-5 w-5 text-[10px]" />
              <span className="font-medium text-ink">{doc.author.name}</span>
            </span>
            {doc.category && (
              <>
                <Dot />
                <span>{doc.category}</span>
              </>
            )}
            <Dot />
            <span className="flex items-center gap-1">
              <ClockIcon className="h-3.5 w-3.5 text-ink-3" />
              {dateOnly(doc.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Body + activity, side by side */}
      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div className={`${DETAIL_COLUMN} grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_290px] lg:gap-8`}>
          <article className="min-w-0 rounded-xl border border-border bg-surface p-6 shadow-xs sm:p-7">
            <p className="text-[15px] leading-[1.75] break-words whitespace-pre-wrap text-ink">{doc.body}</p>
          </article>

          <aside className="min-w-0 lg:border-l lg:border-border lg:pl-8">
            <h2 className="mb-3 text-[13px] font-semibold tracking-[0.01em] text-ink-2">Activity</h2>
            <Timeline events={events} />
          </aside>
        </div>
      </div>

      {/* Action bar */}
      {canDecide && (
        <div className="flex-none border-t border-border bg-surface">
          <div className={`${DETAIL_COLUMN} py-3.5`}>
            {rejecting ? (
              <div>
                <textarea
                  className="input min-h-[80px]"
                  rows={3}
                  value={reason}
                  autoFocus
                  onChange={(event) => onReasonChange(event.target.value)}
                  placeholder="Reason for rejection (required, shared with the author)"
                  aria-label="Reason for rejection"
                />
                <div className="mt-2.5 flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={onConfirmReject}
                    disabled={busy || !reason.trim()}
                    className="btn btn-danger-solid px-4 py-2.5"
                  >
                    {busy ? "Rejecting…" : "Reject"}
                  </button>
                  <button type="button" onClick={onCancelReject} disabled={busy} className="btn btn-ghost px-4 py-2.5">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmApprove(true)}
                  disabled={busy}
                  className="btn btn-approve px-5 py-2.5"
                >
                  <CheckIcon className="h-4 w-4" />
                  {busy ? "Working…" : "Approve"}
                </button>
                <button type="button" onClick={onOpenReject} disabled={busy} className="btn btn-danger px-5 py-2.5">
                  <XCircleIcon className="h-4 w-4" />
                  Reject
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmApprove && (
        <ConfirmDialog
          title="Approve this document?"
          message="Approving is final and recorded against your name — it can’t be changed afterward."
          confirmLabel="Approve"
          cancelLabel="Cancel"
          confirmTone="approve"
          busy={busy}
          onConfirm={() => {
            setConfirmApprove(false);
            onApprove();
          }}
          onCancel={() => setConfirmApprove(false)}
        />
      )}
    </>
  );
}

function Timeline({ events }: { events: AuditEventView[] | null }) {
  if (events === null) {
    return <div className="h-16 animate-pulse rounded-lg bg-surface-2" />;
  }
  const ordered = [...events].reverse();
  const verb: Record<AuditEventView["action"], string> = {
    SUBMITTED: "sent this for review",
    APPROVED: "approved this document",
    REJECTED: "rejected this document",
  };

  return (
    <ol className="relative">
      {ordered.map((event, index) => {
        const last = index === ordered.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span aria-hidden className="absolute top-9 bottom-0 left-[15px] w-px bg-border-strong" />}
            <Avatar name={event.actor.name} className="relative z-10 h-8 w-8 text-[11px] ring-4 ring-canvas" />
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[14px]">
                <span className="font-semibold">{event.actor.name}</span>{" "}
                <span className="text-ink-2">{verb[event.action]}</span>
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                {dateTime(event.createdAt)} · {event.actorRole === "REVIEWER" ? "Reviewer" : "Writer"}
              </p>
              {/* The audit record's previous → new values, shown explicitly. */}
              <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium">
                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-2">
                  {event.fromStatus ? STATUS_LABEL[event.fromStatus] : "New"}
                </span>
                <span aria-hidden className="text-ink-3">
                  →
                </span>
                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-ink-2">
                  {STATUS_LABEL[event.toStatus]}
                </span>
              </p>
              {event.reason && (
                <div className="mt-2.5 rounded-lg border border-border bg-surface px-3.5 py-3">
                  <p className="text-[13px] leading-[1.6] break-words whitespace-pre-wrap text-ink-2">
                    {event.reason}
                  </p>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
