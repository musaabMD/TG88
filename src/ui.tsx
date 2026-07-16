import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  Check,
  CheckCircle2,
  CornerDownLeft,
  Eye,
  FileText,
  LayoutList,
  LineChart as LineChartIcon,
  MessagesSquare,
  PenLine,
  Radio,
  RefreshCw,
  ScrollText,
  Send,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  X
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type ChannelKind = "channel" | "group";
type PostStatus = "draft" | "published" | "scheduled" | "failed";
type Page = "post" | "posts" | "channels" | "analytics";

interface ApiTarget {
  id: number;
  chat_id: string;
  thread_id: number;
  topic_name: string | null;
  title: string;
  type: ChannelKind;
  rules: string;
  post_count?: number;
  draft_count?: number;
  published_count?: number;
  failed_count?: number;
  member_count?: number | null;
  member_growth_week?: number | null;
  view_count?: number | null;
  view_growth_week?: number | null;
  member_history?: number[];
  view_history?: number[];
  messages?: ApiMessage[];
}

interface ApiMessage {
  id: number;
  target_id: number;
  body: string;
  kind: "text" | "poll";
  poll_options: string | null;
  link_preview_enabled: number;
  repeat_group_id: string | null;
  repeat_index: number;
  status: "draft" | "pending" | "posting" | "posted" | "failed";
  scheduled_at: string;
  posted_at: string | null;
  view_count: number | null;
  created_at: string;
}

interface Channel {
  id: string;
  chatId: string;
  name: string;
  kind: ChannelKind;
  members: number;
  memberPosts: number;
  rules: string;
  color: string;
  memberHistory: number[];
  viewHistory: number[];
}

interface Post {
  id: string;
  channelId: string;
  text: string;
  kind: "text" | "poll";
  pollOptions: string[];
  status: PostStatus;
  publishedAt: string | null;
  views: number;
  createdAt: string;
}

interface AiGeneration {
  id: number;
  prompt: string;
  desired_count: number;
  batch_size: number;
  generated_count: number;
  model: string;
}

const GROWTH_TARGET = 5;
const COLORS = ["#0E7490", "#7C3AED", "#2563EB", "#059669", "#DB2777", "#EA580C"];

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "post", label: "Post", icon: <Send className="w-4 h-4" /> },
  { id: "posts", label: "Posts", icon: <LayoutList className="w-4 h-4" /> },
  { id: "channels", label: "Channels", icon: <Radio className="w-4 h-4" /> },
  { id: "analytics", label: "Analytics", icon: <LineChartIcon className="w-4 h-4" /> }
];

const PAGE_TITLES: Record<Page, { title: string; sub: string }> = {
  post: { title: "Post", sub: "Write once, draft to every selected chat" },
  posts: { title: "Posts", sub: "Select drafts and publish in one click" },
  channels: { title: "Channels & groups", sub: "Growth and activity per chat" },
  analytics: { title: "Analytics", sub: "Members and views against the 5% weekly goal" }
};

function weeklyGrowth(history: number[]): number {
  const clean = history.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return 0;
  const last = clean[clean.length - 1];
  const prev = clean[clean.length - 2];
  if (!prev) return 0;
  return ((last - prev) / prev) * 100;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}>{children}</div>;
}

function Badge({
  children,
  tone = "slate"
}: {
  children: React.ReactNode;
  tone?: "slate" | "sky" | "amber" | "emerald" | "violet" | "red";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    red: "bg-red-50 text-red-700 border-red-200"
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled = false,
  className = "",
  title
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const variants: Record<string, string> = {
    default: "bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-300",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50 bg-white disabled:text-slate-300",
    ghost: "text-slate-500 hover:bg-slate-100 disabled:text-slate-300",
    danger: "border border-red-200 text-red-600 bg-white hover:bg-red-50 disabled:text-red-200"
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-3 text-xs",
    md: "h-9 px-4 text-sm"
  };
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

function GrowthBar({ growth }: { growth: number }) {
  const onTarget = growth >= GROWTH_TARGET;
  const pct = Math.max(0, Math.min((growth / GROWTH_TARGET) * 100, 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-500">Weekly growth</span>
        <span className={`inline-flex items-center gap-1 font-semibold ${onTarget ? "text-emerald-600" : "text-amber-600"}`}>
          {onTarget ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {growth.toFixed(1)}% / {GROWTH_TARGET}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${onTarget ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ChatIcon({ kind, className = "w-4 h-4" }: { kind: ChannelKind; className?: string }) {
  return kind === "channel" ? <Radio className={className} /> : <MessagesSquare className={className} />;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers ?? {}) } : options.headers
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function mapData(targets: ApiTarget[]): { channels: Channel[]; posts: Post[] } {
  const channels = targets.map((target, index) => ({
    id: String(target.id),
    chatId: target.chat_id,
    name: target.title,
    kind: target.type,
    members: target.member_count ?? 0,
    memberPosts: 0,
    rules: target.rules ?? "",
    color: COLORS[index % COLORS.length],
    memberHistory: normalizeHistory(target.member_history, target.member_count ?? 0),
    viewHistory: normalizeHistory(target.view_history, target.view_count ?? 0)
  }));

  const posts = targets.flatMap((target) =>
    (target.messages ?? []).map((message) => ({
      id: String(message.id),
      channelId: String(target.id),
      text: message.body,
      kind: message.kind ?? "text",
      pollOptions: parseOptions(message.poll_options),
      status: normalizeStatus(message.status),
      publishedAt: message.posted_at,
      views: message.view_count ?? 0,
      createdAt: message.created_at || message.scheduled_at
    }))
  );

  return { channels, posts };
}

function parseOptions(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeHistory(history: number[] | undefined, fallback: number): number[] {
  const clean = (history ?? []).filter((value) => Number.isFinite(value));
  if (clean.length === 0) return Array(8).fill(fallback);
  while (clean.length < 8) clean.unshift(clean[0]);
  return clean.slice(-8);
}

function normalizeStatus(status: ApiMessage["status"]): PostStatus {
  if (status === "posted") return "published";
  if (status === "pending" || status === "posting") return "scheduled";
  if (status === "failed") return "failed";
  return "draft";
}

function SideNav({ page, setPage, draftCount }: { page: Page; setPage: (p: Page) => void; draftCount: number }) {
  return (
    <nav className="w-52 shrink-0 border-r border-slate-200 bg-white min-h-screen sticky top-0 flex flex-col">
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-slate-100">
        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
          <Send className="w-4 h-4" />
        </div>
        <div>
          <p className="text-sm font-bold leading-tight tracking-tight">TG88</p>
          <p className="text-[10px] text-slate-400 leading-tight">Telegram autoposter</p>
        </div>
      </div>
      <div className="p-3 space-y-1">
        {NAV.map((item) => {
          const active = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 h-10 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${
                active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.icon}
              {item.label}
              {item.id === "posts" && draftCount > 0 && (
                <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"}`}>
                  {draftCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-auto p-3 border-t border-slate-100">
        <Badge tone="sky">
          <Bot className="w-3 h-3" />
          @dn88appbot
        </Badge>
      </div>
    </nav>
  );
}

function Composer({
  channels,
  onDraft,
  onSchedule
}: {
  channels: Channel[];
  onDraft: (payload: ComposerPayload, channelIds: string[]) => void;
  onSchedule: (payload: ComposerPayload, channelIds: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "poll">("text");
  const [pollOptions, setPollOptions] = useState("Yes\nNo");
  const [linkPreviewEnabled, setLinkPreviewEnabled] = useState(true);
  const [repeatCount, setRepeatCount] = useState(1);
  const [repeatIntervalMinutes, setRepeatIntervalMinutes] = useState(1440);
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleTime());
  const [selected, setSelected] = useState<string[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSelected((current) => {
      const valid = current.filter((id) => channels.some((channel) => channel.id === id));
      return valid.length ? valid : channels.map((channel) => channel.id);
    });
  }, [channels]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const normalizedPollOptions = pollOptions.split("\n").map((option) => option.trim()).filter(Boolean);
  const canSubmit = text.trim().length > 0 && selected.length > 0 && (mode === "text" || normalizedPollOptions.length >= 2);
  const payload = (): ComposerPayload => ({
    body: text.trim(),
    kind: mode,
    pollOptions: normalizedPollOptions,
    linkPreviewEnabled,
    repeatCount,
    repeatIntervalMinutes,
    scheduledAt
  });
  const clear = () => {
    setText("");
    taRef.current?.focus();
  };
  const submit = () => {
    if (!canSubmit) return;
    onDraft(payload(), selected);
    clear();
  };
  const schedule = () => {
    if (!canSubmit) return;
    onSchedule(payload(), selected);
    clear();
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setMode("text")}
          className={`h-8 px-3 rounded-lg text-xs font-medium ${mode === "text" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          Post
        </button>
        <button
          onClick={() => setMode("poll")}
          className={`h-8 px-3 rounded-lg text-xs font-medium ${mode === "poll" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          Poll
        </button>
      </div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={mode === "poll" ? "Poll question" : "What is happening?"}
        rows={3}
        className="w-full resize-none text-lg text-slate-900 placeholder:text-slate-400 focus:outline-none"
      />

      {mode === "poll" && (
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-500">Poll options, one per line</label>
          <textarea
            value={pollOptions}
            onChange={(event) => setPollOptions(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 focus:outline-2 focus:outline-sky-500 resize-none"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {channels.map((c) => {
          const active = selected.includes(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium border transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${
                active ? "border-transparent text-white" : "border-slate-300 text-slate-600 bg-white hover:bg-slate-50"
              }`}
              style={active ? { backgroundColor: c.color } : undefined}
            >
              <ChatIcon kind={c.kind} className="w-3.5 h-3.5" />
              {c.name}
              {active && <Check className="w-3.5 h-3.5" />}
            </button>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <label className="text-xs text-slate-500">
            Schedule
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 h-9 text-sm text-slate-700"
            />
          </label>
          <label className="text-xs text-slate-500">
            Repeat
            <input
              type="number"
              min={1}
              max={30}
              value={repeatCount}
              onChange={(event) => setRepeatCount(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 h-9 text-sm text-slate-700"
            />
          </label>
          <label className="text-xs text-slate-500">
            Every minutes
            <input
              type="number"
              min={1}
              max={43200}
              value={repeatIntervalMinutes}
              onChange={(event) => setRepeatIntervalMinutes(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 h-9 text-sm text-slate-700"
            />
          </label>
          <label className="flex items-end gap-2 text-xs text-slate-500 pb-2">
            <input
              type="checkbox"
              checked={linkPreviewEnabled}
              onChange={(event) => setLinkPreviewEnabled(event.target.checked)}
              disabled={mode === "poll"}
              className="accent-slate-900 w-4 h-4"
            />
            Link preview
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <CornerDownLeft className="w-3.5 h-3.5" />
            <span>
              Enter drafts to {selected.length} chat{selected.length === 1 ? "" : "s"} · links work inside text posts
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={!canSubmit} variant="outline" onClick={schedule}>
              <Send className="w-4 h-4" />
              Schedule
            </Button>
            <Button disabled={!canSubmit} onClick={submit}>
              <PenLine className="w-4 h-4" />
              Save draft
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AiGenerator({
  channels,
  onGenerated,
  notify
}: {
  channels: Channel[];
  onGenerated: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [desiredCount, setDesiredCount] = useState(100);
  const [batchSize, setBatchSize] = useState(3);
  const [generation, setGeneration] = useState<AiGeneration | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelected((current) => {
      const valid = current.filter((id) => channels.some((channel) => channel.id === id));
      return valid.length ? valid : channels.map((channel) => channel.id);
    });
  }, [channels]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const canGenerate = prompt.trim().length > 0 && selected.length > 0 && !loading;

  const generateFirst = async () => {
    if (!canGenerate) return;
    setLoading(true);
    try {
      const data = await api<{ generation: AiGeneration; posts: string[]; done: boolean }>("/api/ai/generations", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          targetIds: selected.map(Number),
          desiredCount,
          batchSize
        })
      });
      setGeneration(data.generation);
      await onGenerated();
      notify(`AI drafted ${data.posts.length} posts to ${selected.length} chat${selected.length === 1 ? "" : "s"}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI generation failed");
    } finally {
      setLoading(false);
    }
  };

  const continueGeneration = async () => {
    if (!generation || loading) return;
    setLoading(true);
    try {
      const data = await api<{ generation: AiGeneration; posts: string[]; done: boolean }>(
        `/api/ai/generations/${generation.id}/continue`,
        { method: "POST" }
      );
      setGeneration(data.generation);
      await onGenerated();
      notify(data.done ? "AI generation complete" : `AI drafted ${data.posts.length} more posts`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">AI content generator</p>
          <p className="text-xs text-slate-500 mt-0.5">Write the content strategy once. TG88 drafts the first batch of 3, then continue toward 100.</p>
        </div>
        {generation && (
          <Badge tone={generation.generated_count >= generation.desired_count ? "emerald" : "sky"}>
            {generation.generated_count}/{generation.desired_count}
          </Badge>
        )}
      </div>

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={4}
        placeholder="Example: Generate short daily posts for founders about Telegram growth, product launches, and automation. Make them direct, no fluff, include occasional CTAs."
        className="mt-4 w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 focus:outline-2 focus:outline-sky-500 resize-none"
      />

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {channels.map((channel) => {
          const active = selected.includes(channel.id);
          return (
            <button
              key={channel.id}
              onClick={() => toggle(channel.id)}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium border transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${
                active ? "border-transparent text-white" : "border-slate-300 text-slate-600 bg-white hover:bg-slate-50"
              }`}
              style={active ? { backgroundColor: channel.color } : undefined}
            >
              <ChatIcon kind={channel.kind} className="w-3.5 h-3.5" />
              {channel.name}
              {active && <Check className="w-3.5 h-3.5" />}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <label className="text-xs text-slate-500">
          Goal
          <input
            type="number"
            min={3}
            max={500}
            value={desiredCount}
            onChange={(event) => setDesiredCount(Number(event.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 h-9 text-sm text-slate-700"
          />
        </label>
        <label className="text-xs text-slate-500">
          Batch size
          <input
            type="number"
            min={1}
            max={10}
            value={batchSize}
            onChange={(event) => setBatchSize(Number(event.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 h-9 text-sm text-slate-700"
          />
        </label>
        <div className="flex items-end gap-2">
          <Button disabled={!canGenerate} onClick={generateFirst} className="flex-1">
            <Bot className="w-4 h-4" />
            {loading && !generation ? "Generating" : "Generate first"}
          </Button>
          <Button disabled={!generation || loading || generation.generated_count >= generation.desired_count} variant="outline" onClick={continueGeneration} className="flex-1">
            <RefreshCw className="w-4 h-4" />
            Continue
          </Button>
        </div>
      </div>
    </Card>
  );
}

type ComposerPayload = {
  body: string;
  kind: "text" | "poll";
  pollOptions: string[];
  linkPreviewEnabled: boolean;
  repeatCount: number;
  repeatIntervalMinutes: number;
  scheduledAt: string;
};

function defaultScheduleTime(): string {
  const date = new Date(Date.now() + 10 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
    </Card>
  );
}

function PostPage({
  channels,
  posts,
  onGenerated,
  notify
}: {
  channels: Channel[];
  posts: Post[];
  onGenerated: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const totalMembers = channels.reduce((s, c) => s + c.members, 0);
  const overallHistory = channels.length
    ? channels[0].memberHistory.map((_, i) => channels.reduce((s, c) => s + (c.memberHistory[i] ?? 0), 0))
    : Array(8).fill(0);
  const growth = weeklyGrowth(overallHistory);
  const published = posts.filter((p) => p.status === "published");
  const drafts = posts.filter((p) => p.status === "draft");
  const totalViews = published.reduce((s, p) => s + p.views, 0);

  return (
    <div className="space-y-5">
      <AiGenerator channels={channels} onGenerated={onGenerated} notify={notify} />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Members" value={totalMembers.toLocaleString()} sub={`${growth >= 0 ? "+" : ""}${growth.toFixed(1)}% this week · target ${GROWTH_TARGET}%`} icon={<Users className="w-3.5 h-3.5" />} />
        <StatCard label="Views" value={totalViews.toLocaleString()} sub="across published posts" icon={<Eye className="w-3.5 h-3.5" />} />
        <StatCard label="Published" value={String(published.length)} sub="posts live in Telegram" icon={<CheckCircle2 className="w-3.5 h-3.5" />} />
        <StatCard label="Drafts" value={String(drafts.length)} sub="waiting on the Posts page" icon={<FileText className="w-3.5 h-3.5" />} />
      </div>

      <Card className="p-4">
        <GrowthBar growth={growth} />
      </Card>
    </div>
  );
}

type Filter = "all" | PostStatus;

function PostsPage({
  posts,
  channels,
  onPublish,
  onDelete
}: {
  posts: Post[];
  channels: Channel[];
  onPublish: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const rows = posts.filter((p) => filter === "all" || p.status === filter);
  const chan = (id: string) => channels.find((c) => c.id === id);
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggleAll = () => setSelected(allChecked ? [] : rows.map((r) => r.id));
  const toggleOne = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedDrafts = selected.filter((id) => posts.find((p) => p.id === id)?.status === "draft");
  const publishSelected = () => {
    onPublish(selectedDrafts);
    setSelected([]);
  };
  const deleteSelected = () => {
    onDelete(selected);
    setSelected([]);
  };
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "draft", label: "Drafts" },
    { id: "scheduled", label: "Scheduled" },
    { id: "published", label: "Published" }
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-100">
        <div className="flex items-center gap-1">
          {filters.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${filter === f.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {selected.length > 0 && <span className="text-xs text-slate-500">{selected.length} selected</span>}
          <Button size="sm" variant="danger" disabled={selected.length === 0} onClick={deleteSelected}>
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </Button>
          <Button size="sm" disabled={selectedDrafts.length === 0} onClick={publishSelected}>
            <Send className="w-3.5 h-3.5" />
            Publish {selectedDrafts.length > 0 ? `(${selectedDrafts.length})` : ""}
          </Button>
        </div>
      </div>

      <label className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 text-xs text-slate-500 cursor-pointer select-none">
        <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-slate-900 w-4 h-4" />
        Select all
      </label>

      <div className="divide-y divide-slate-100">
        {rows.length === 0 && <p className="px-4 py-10 text-center text-slate-400 text-sm">Nothing here yet. Draft a post from the Post page.</p>}
        {rows.map((p) => {
          const c = chan(p.channelId);
          const checked = selected.includes(p.id);
          return (
            <label key={p.id} className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${checked ? "bg-sky-50/60" : "hover:bg-slate-50/70"}`}>
              <input type="checkbox" checked={checked} onChange={() => toggleOne(p.id)} className="accent-slate-900 w-4 h-4 mt-1.5 shrink-0" />
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0" style={{ backgroundColor: c?.color }}>
                <ChatIcon kind={c?.kind ?? "channel"} className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs leading-none">
                  <span className="font-semibold text-slate-900 truncate">{c?.name}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-400 whitespace-nowrap">{p.status === "published" ? fmtTime(p.publishedAt) : fmtTime(p.createdAt)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {p.status === "published" && (
                      <span className="inline-flex items-center gap-1 text-slate-400 tabular-nums">
                        <Eye className="w-3.5 h-3.5" />
                        {p.views.toLocaleString()}
                      </span>
                    )}
                    {p.status === "draft" ? (
                      <Badge tone="amber">
                        <PenLine className="w-3 h-3" />
                        Draft
                      </Badge>
                    ) : p.status === "published" ? (
                      <Badge tone="emerald">
                        <CheckCircle2 className="w-3 h-3" />
                        Published
                      </Badge>
                    ) : p.status === "failed" ? (
                      <Badge tone="red">Failed</Badge>
                    ) : (
                      <Badge tone="sky">Scheduled</Badge>
                    )}
                  </span>
                </div>
                <p className="text-[15px] text-slate-800 leading-snug mt-1.5 break-words">{p.text}</p>
                {p.kind === "poll" && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.pollOptions.map((option) => (
                      <span key={option} className="px-2 py-1 rounded-full bg-slate-100 text-[11px] text-slate-600">
                        {option}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </Card>
  );
}

function ChannelsPage({ channels, posts, onOpenRules }: { channels: Channel[]; posts: Post[]; onOpenRules: (c: Channel) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Use /register@dn88appbot in Telegram to add chats.</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {channels.map((c) => {
          const mine = posts.filter((p) => p.channelId === c.id).length;
          const growth = weeklyGrowth(c.memberHistory);
          return (
            <Card key={c.id} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: c.color }}>
                    <ChatIcon kind={c.kind} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">{c.chatId}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onOpenRules(c)}>
                  <ScrollText className="w-3.5 h-3.5" />
                  Rules
                </Button>
              </div>

              <div className="mt-4">
                <GrowthBar growth={growth} />
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4">
                <Badge tone="slate">{c.kind}</Badge>
                <Badge tone="sky">
                  <Users className="w-3 h-3" />
                  {c.members.toLocaleString()} members
                </Badge>
                <Badge tone="emerald">
                  <PenLine className="w-3 h-3" />
                  {mine} by you
                </Badge>
                <Badge tone="violet">
                  <UserRound className="w-3 h-3" />
                  {c.memberPosts} by members
                </Badge>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function AnalyticsPage({ channels }: { channels: Channel[] }) {
  const [scope, setScope] = useState<string>("all");
  const weeks = Array.from({ length: 8 }, (_, i) => `W${i + 1}`);
  const active = scope === "all" ? undefined : channels.find((c) => c.id === scope);
  const scopeColor = active?.color ?? "#0F172A";

  const memberData = weeks.map((week, i) => {
    const members = active ? active.memberHistory[i] ?? 0 : channels.reduce((s, c) => s + (c.memberHistory[i] ?? 0), 0);
    const base = active ? active.memberHistory[0] ?? 0 : channels.reduce((s, c) => s + (c.memberHistory[0] ?? 0), 0);
    return { week, members, target: Math.round(base * Math.pow(1 + GROWTH_TARGET / 100, i)) };
  });

  const viewData = weeks.map((week, i) => ({
    week,
    views: active ? active.viewHistory[i] ?? 0 : channels.reduce((s, c) => s + (c.viewHistory[i] ?? 0), 0)
  }));

  const growth = weeklyGrowth(memberData.map((d) => d.members));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setScope("all")} className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium border transition-colors ${scope === "all" ? "bg-slate-900 text-white border-transparent" : "border-slate-300 text-slate-600 bg-white hover:bg-slate-50"}`}>
          <LineChartIcon className="w-3.5 h-3.5" />
          All chats
        </button>
        {channels.map((c) => (
          <button key={c.id} onClick={() => setScope(c.id)} className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium border transition-colors ${scope === c.id ? "text-white border-transparent" : "border-slate-300 text-slate-600 bg-white hover:bg-slate-50"}`} style={scope === c.id ? { backgroundColor: c.color } : undefined}>
            <ChatIcon kind={c.kind} className="w-3.5 h-3.5" />
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Target className="w-4 h-4 text-slate-400" />
              Members vs {GROWTH_TARGET}% target
            </div>
            <Badge tone={growth >= GROWTH_TARGET ? "emerald" : "amber"}>
              {growth >= GROWTH_TARGET ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {growth.toFixed(1)}% this week
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mb-3">Dashed line is a compounding {GROWTH_TARGET}% weekly goal from week 1.</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={memberData} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#94A3B8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} tickLine={false} axisLine={false} width={52} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                <Line type="monotone" dataKey="members" name="Members" stroke={scopeColor} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="target" name={`${GROWTH_TARGET}% target`} stroke="#94A3B8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-1">
            <Eye className="w-4 h-4 text-slate-400" />
            Views per week
          </div>
          <p className="text-xs text-slate-500 mb-3">Post views for the selected scope.</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={viewData} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={scopeColor} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={scopeColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#94A3B8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} tickLine={false} axisLine={false} width={52} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                <Area type="monotone" dataKey="views" name="Views" stroke={scopeColor} strokeWidth={2} fill="url(#viewsFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-4">
          <TrendingUp className="w-4 h-4 text-slate-400" />
          Growth per chat, this week
        </div>
        <div className="space-y-4">
          {channels.map((c) => (
            <div key={c.id} className="flex items-center gap-4">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: c.color }}>
                <ChatIcon kind={c.kind} className="w-3.5 h-3.5" />
              </span>
              <div className="w-40 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                <p className="text-[11px] text-slate-400">{c.members.toLocaleString()} members</p>
              </div>
              <div className="flex-1">
                <GrowthBar growth={weeklyGrowth(c.memberHistory)} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RulesSheet({
  channel,
  onClose,
  onSave
}: {
  channel: Channel | null;
  onClose: () => void;
  onSave: (id: string, rules: string) => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (channel) setValue(channel.rules);
  }, [channel]);

  if (!channel) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl border-l border-slate-200 flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ScrollText className="w-4 h-4 text-slate-400" />
              Posting rules
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {channel.name} · {channel.chatId}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          <label className="text-xs font-medium text-slate-500">Tone, notes, links to avoid</label>
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={10} placeholder="Example: friendly tone, no external shorteners, tag releases with #changelog" className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 focus:outline-2 focus:outline-sky-500 resize-none" />
          <p className="text-xs text-slate-400 mt-2">Rules apply to every post drafted for this chat.</p>
        </div>
        <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(channel.id, value);
              onClose();
            }}
          >
            <Check className="w-4 h-4" />
            Save rules
          </Button>
        </div>
      </aside>
    </div>
  );
}

function TG88Dashboard() {
  const [page, setPage] = useState<Page>("post");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [rulesFor, setRulesFor] = useState<Channel | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    const data = await api<{ targets: ApiTarget[] }>("/api/targets");
    const mapped = mapData(data.targets);
    setChannels(mapped.channels);
    setPosts(mapped.posts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((error) => {
      setLoading(false);
      notify(error.message);
    });
  }, [load, notify]);

  const draftPosts = async (payload: ComposerPayload, channelIds: string[]) => {
    await Promise.all(
      channelIds.map((channelId) =>
        api("/api/drafts", {
          method: "PUT",
          body: JSON.stringify({ targetId: Number(channelId), ...payload })
        })
      )
    );
    await load();
    notify(`Drafted to ${channelIds.length} chat${channelIds.length === 1 ? "" : "s"}`);
  };

  const schedulePosts = async (payload: ComposerPayload, channelIds: string[]) => {
    await Promise.all(
      channelIds.map((channelId) =>
        api("/api/messages", {
          method: "POST",
          body: JSON.stringify({ targetId: Number(channelId), ...payload, scheduledAt: payload.scheduledAt })
        })
      )
    );
    await load();
    notify(`Scheduled to ${channelIds.length} chat${channelIds.length === 1 ? "" : "s"}`);
  };

  const publishPosts = async (ids: string[]) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => api(`/api/drafts/${id}/publish`, { method: "POST" })));
    await load();
    notify(`Published ${ids.length} post${ids.length === 1 ? "" : "s"}`);
  };

  const deletePosts = async (ids: string[]) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => api(`/api/messages/${id}`, { method: "DELETE" })));
    await load();
    notify(`Deleted ${ids.length} post${ids.length === 1 ? "" : "s"}`);
  };

  const saveRules = async (id: string, rules: string) => {
    await api(`/api/targets/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ rules })
    });
    await load();
    notify("Rules saved");
  };

  const draftCount = posts.filter((p) => p.status === "draft").length;
  const meta = PAGE_TITLES[page];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      <SideNav page={page} setPage={setPage} draftCount={draftCount} />

      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-slate-200">
          <div className="px-6 h-16 flex items-center justify-between">
            <div>
              <h1 className="text-base font-bold leading-tight tracking-tight">{meta.title}</h1>
              <p className="text-[11px] text-slate-500 leading-tight">{meta.sub}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                load()
                  .then(() => notify("Refreshed"))
                  .catch((error) => notify(error.message))
              }
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </Button>
          </div>
        </header>

        <main className="p-6 max-w-6xl">
          {loading && <Card className="p-10 text-center text-sm text-slate-500">Loading TG88...</Card>}
          {!loading && channels.length === 0 && <Card className="p-10 text-center text-sm text-slate-500">Use /register@dn88appbot in Telegram to add chats.</Card>}
          {!loading && channels.length > 0 && page === "post" && <PostPage channels={channels} posts={posts} onGenerated={load} notify={notify} />}
          {!loading && channels.length > 0 && page === "posts" && <PostsPage posts={posts} channels={channels} onPublish={publishPosts} onDelete={deletePosts} />}
          {!loading && channels.length > 0 && page === "channels" && <ChannelsPage channels={channels} posts={posts} onOpenRules={setRulesFor} />}
          {!loading && channels.length > 0 && page === "analytics" && <AnalyticsPage channels={channels} />}
        </main>
      </div>

      <RulesSheet channel={rulesFor} onClose={() => setRulesFor(null)} onSave={saveRules} />

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          {toast}
        </div>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<TG88Dashboard />);
