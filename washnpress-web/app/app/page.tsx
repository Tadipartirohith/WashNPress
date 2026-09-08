"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Shirt, Car, Wind, Sparkles, Wallet as WalletIcon, CalendarClock, PackageSearch,
  ArrowLeft, LogOut, Loader2, Plus, CheckCircle2, Clock, ClipboardList,
  LifeBuoy, Send, Paperclip, MessageSquare, Bell, User as UserIcon, ChevronRight,
  CreditCard, Home as HomeIcon, Pencil, Menu, X as XIcon,
} from "lucide-react";
import {
  api, setToken, getToken, ApiError,
  type Dashboard, type Service, type Slot, type BookingOptionService, type Plan,
  type OrderCard, type Tracking, type SubscriptionUsage, type PlanChangeQuote,
  type AvailablePlan, type SupportTicket, type IssuePriority, type ConversationView,
  type AttachmentSummary, type ResidentProfile, type NotificationItem, type ServiceRequestCard,
  type ServiceOfferingItem,
} from "@/lib/api-client";
import { DatePicker } from "@/components/portal/date-picker";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

function serviceIcon(name: string) {
  const n = name.toLowerCase();
  if (/car|vehicle|bike|scooter/.test(n)) return Car;
  if (/iron|press|steam|crease/.test(n)) return Wind;
  if (/dry|premium|sofa|shoe|carpet/.test(n)) return Sparkles;
  return Shirt;
}

const fade = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };
const listV = { show: { transition: { staggerChildren: 0.05 } } };
const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

type View = "home" | "book" | "orders" | "profile" | "wallet" | "plans" | "track" | "support" | "ticket";

export default function ResidentApp() {
  const [booted, setBooted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<View>("home");
  const [trackId, setTrackId] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const t = getToken();
    if (!t) { setBooted(true); return; }
    api.me().then(() => setAuthed(true)).catch(() => setToken(null)).finally(() => setBooted(true));
  }, []);

  if (!booted) return <Splash />;
  if (!authed) return <Login onLogin={() => { setAuthed(true); setView("home"); }} />;

  const logout = async () => { await api.logout(); setToken(null); setAuthed(false); };

  const goto = (v: View) => { setView(v); setNavOpen(false); };

  return (
    <div className="flex min-h-[100dvh]">
      {/* Persistent sidebar on desktop; a slide-in drawer on narrow screens. */}
      <Sidebar view={view} go={goto} onLogout={logout} open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <ResidentHeader onOpenNav={() => setNavOpen(true)}
          onOpenNotification={(id) => { setTrackId(id); setView("track"); }} notifOpen={notifOpen} setNotifOpen={setNotifOpen} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8">
          <AnimatePresence mode="wait">
            <motion.div key={view + (trackId ?? "") + (ticketId ?? "")} initial={fade.initial} animate={fade.animate} exit={fade.exit} transition={{ duration: 0.25 }}>
              {view === "home" && <Home go={setView} onTrack={(id) => { setTrackId(id); setView("track"); }} onShowUpdates={() => setNotifOpen(true)} />}
              {view === "book" && <Book onBooked={() => setView("orders")} />}
              {view === "orders" && <Orders onTrack={(id) => { setTrackId(id); setView("track"); }} />}
              {view === "profile" && <Profile go={setView} onLogout={logout} />}
              {view === "wallet" && <WalletView onBack={() => setView("profile")} />}
              {view === "plans" && <Plans onBack={() => setView("profile")} />}
              {view === "track" && trackId && <TrackView orderId={trackId} onBack={() => setView("orders")} />}
              {view === "support" && <Support onOpen={(id) => { setTicketId(id); setView("ticket"); }} onBack={() => setView("profile")} />}
              {view === "ticket" && ticketId && <TicketDetail ticketId={ticketId} onBack={() => setView("support")} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// The desktop left rail: brand, primary navigation, a plan shortcut and the account
// block. On desktop it is always visible; on smaller screens it slides in from the
// left over a scrim and closes when a destination or the scrim is tapped.
function Sidebar({ view, go, onLogout, open, onClose }: {
  view: View; go: (v: View) => void; onLogout: () => void; open: boolean; onClose: () => void;
}) {
  const items: { id: View; label: string; icon: typeof HomeIcon }[] = [
    { id: "home", label: "Home", icon: HomeIcon },
    { id: "book", label: "Book Pickup", icon: CalendarClock },
    { id: "orders", label: "My Orders", icon: PackageSearch },
    { id: "plans", label: "My Plan", icon: CreditCard },
    { id: "wallet", label: "Wallet", icon: WalletIcon },
    { id: "support", label: "Help & Support", icon: LifeBuoy },
    { id: "profile", label: "Profile", icon: UserIcon },
  ];
  const active = (id: View) => view === id
    || (id === "orders" && view === "track")
    || (id === "support" && view === "ticket");

  return (
    <>
      {open && <button aria-hidden className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-1 border-r border-border bg-card/80 p-4 backdrop-blur transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/40 text-primary-foreground shadow-glow"><Sparkles className="size-4" /></span>
            <span className="font-display text-lg font-bold tracking-tight">Wash N Press</span>
          </div>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 lg:hidden"><XIcon className="size-4" /></button>
        </div>

        <nav className="flex flex-col gap-1">
          {items.map((t) => (
            <button key={t.id} onClick={() => go(t.id)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${active(t.id) ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"}`}>
              <t.icon className="size-5 shrink-0" /> {t.label}
            </button>
          ))}
        </nav>

        <button onClick={() => go("plans")} className="mt-4 rounded-2xl bg-primary/10 p-4 text-left ring-1 ring-primary/20 transition-colors hover:bg-primary/15">
          <p className="text-sm font-semibold text-primary">Your plan</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Manage or upgrade your subscription.</p>
        </button>

        <div className="mt-auto space-y-1 border-t border-border pt-3">
          <button onClick={() => go("profile")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground/10"><UserIcon className="size-4 text-muted-foreground" /></span>
            <span className="min-w-0"><span className="block truncate font-medium">My account</span><span className="block truncate text-xs text-muted-foreground">View profile</span></span>
          </button>
          <button onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
            <LogOut className="size-5 shrink-0" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

// The desktop top bar over the content: a menu button on mobile, the page brand on
// small widths, and the notification bell.
function ResidentHeader({ onOpenNav, onOpenNotification, notifOpen, setNotifOpen }: {
  onOpenNav: () => void; onOpenNotification: (orderId: string) => void; notifOpen: boolean; setNotifOpen: (v: boolean) => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur sm:px-8">
      <div className="flex items-center gap-2">
        <button onClick={onOpenNav} aria-label="Open menu" className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 lg:hidden"><Menu className="size-5" /></button>
        <span className="font-display text-base font-bold tracking-tight lg:hidden">Wash N Press</span>
      </div>
      <NotificationBell onOpenNotification={onOpenNotification} open={notifOpen} setOpen={setNotifOpen} />
    </header>
  );
}

function Splash() {
  return <div className="grid min-h-[100dvh] place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
}

function TopBar({ onOpenNotification, notifOpen, setNotifOpen }: { onOpenNotification: (orderId: string) => void; notifOpen: boolean; setNotifOpen: (v: boolean) => void }) {
  return (
    <header className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/40 text-primary-foreground shadow-glow">
          <Sparkles className="size-4" />
        </span>
        <span className="font-display text-lg font-bold tracking-tight">Wash N Press</span>
      </div>
      <NotificationBell onOpenNotification={onOpenNotification} open={notifOpen} setOpen={setNotifOpen} />
    </header>
  );
}

// The alerts bell in the header. A badge shows the unread count; the dropdown lists
// recent notifications, marks one read on tap (jumping to its order when it has one)
// and marks everything read in one go.
function NotificationBell({ onOpenNotification, open, setOpen }: { onOpenNotification: (orderId: string) => void; open: boolean; setOpen: (v: boolean) => void }) {
  const { data, loading, reload } = useAsync(() => api.notifications(), []);
  const items = data?.notifications ?? [];
  const unread = items.filter((n) => !n.read).length;

  const openOne = async (n: NotificationItem) => {
    if (!n.read) { try { await api.markNotificationRead(n.id); } catch { /* ignore */ } reload(); }
    if (n.orderId) { setOpen(false); onOpenNotification(n.orderId); }
  };
  const markAll = async () => { try { await api.markAllNotificationsRead(); } catch { /* ignore */ } reload(); };

  return (
    <div className="relative">
      <button aria-label="Notifications" onClick={() => setOpen(!open)} className="relative grid size-9 place-items-center rounded-full glass text-muted-foreground hover:text-foreground">
        <Bell className="size-4" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{unread}</span>}
      </button>
      {open && (
        <>
          <button aria-hidden className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-40 w-[min(88vw,20rem)] overflow-hidden rounded-2xl glass-strong shadow-xl">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <p className="text-sm font-semibold">Notifications</p>
              {unread > 0 && <button onClick={markAll} className="text-xs text-primary">Mark all read</button>}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="grid place-items-center py-8"><Loader2 className="size-5 animate-spin text-primary" /></div>
              ) : items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
              ) : items.map((n) => (
                <button key={n.id} onClick={() => openOne(n)} className={`flex w-full gap-3 border-b border-border/40 px-4 py-3 text-left last:border-0 hover:bg-foreground/5 ${n.read ? "" : "bg-primary/5"}`}>
                  {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  <span className={n.read ? "ml-5" : ""}>
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TabBar({ view, setView }: { view: View; setView: (v: View) => void }) {
  const tabs: { id: View; label: string; icon: typeof Shirt }[] = [
    { id: "home", label: "Home", icon: HomeIcon },
    { id: "book", label: "Booking", icon: CalendarClock },
    { id: "orders", label: "Orders", icon: Clock },
    { id: "profile", label: "Profile", icon: UserIcon },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(92%,26rem)] items-center justify-between rounded-2xl glass-strong p-1.5">
      {tabs.map((t) => {
        const active = view === t.id
          || (view === "track" && t.id === "orders")
          || ((view === "wallet" || view === "plans" || view === "support" || view === "ticket") && t.id === "profile");
        return (
          <button key={t.id} onClick={() => setView(t.id)} className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px]">
            {active && <motion.span layoutId="tab" className="absolute inset-0 rounded-xl bg-primary/15 ring-1 ring-primary/30" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <t.icon className={`relative size-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
            <span className={`relative ${active ? "text-foreground" : "text-muted-foreground"}`}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [phone, setPhone] = useState("9876543210");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setError(null);
    try { const r = await api.sendOtp(phone); setStage("otp"); if (r.otpForTesting) { setHint(r.otpForTesting); setOtp(r.otpForTesting); } }
    catch (e) { setError(e instanceof Error ? e.message : "Could not send the code"); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    try { const r = await api.verifyOtp(phone, otp); setToken(r.token); onLogin(); }
    catch (e) { setError(e instanceof Error ? e.message : "That code did not work"); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4">
      <motion.div initial={fade.initial} animate={fade.animate} className="w-full max-w-sm rounded-3xl glass-strong p-7">
        <h1 className="font-display text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to book laundry, ironing, dry clean, or a car wash.</p>
        {stage === "phone" ? (
          <div className="mt-6 space-y-3">
            <label className="block text-xs text-muted-foreground">Mobile number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={10}
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-ring" />
            <button onClick={send} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <label className="block text-xs text-muted-foreground">Enter the 6 digit code</label>
            <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6}
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-ring" />
            {hint && <p className="text-xs text-accent">Demo code: {hint}</p>}
            <button onClick={verify} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Verify and continue"}
            </button>
          </div>
        )}
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </motion.div>
    </div>
  );
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    setLoading(true); setError(null);
    fn().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Something went wrong")).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, loading, error, reload: run };
}

function Panel({ loading, error, children }: { loading: boolean; error: string | null; children: React.ReactNode }) {
  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (error) return <div className="rounded-2xl glass p-6 text-sm text-danger">{error}</div>;
  return <>{children}</>;
}

// Statuses the resident sees, collapsing the operator-internal ones (washing,
// ironing, qc, rework, batch stages) into the plain lifecycle a customer follows.
const DASH_STATUS: Record<string, string> = {
  scheduled: "Scheduled", picked_up: "Picked Up",
  in_wash: "Processing", washing: "Processing", ironing: "Processing",
  qc: "Quality Check", qc_hold: "Quality Check", qc_failed: "Quality Check",
  ready_for_delivery: "Ready for Delivery", out_for_delivery: "Out for Delivery",
  delivered: "Delivered", pickup_failed: "Pickup Failed", cancelled: "Cancelled", disputed: "Quality Check",
};
const dashStatus = (s: string) => DASH_STATUS[s] ?? prettyState(s);
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

// The resident dashboard: a compact, backend-driven overview. Laundry is primary;
// additional services are a secondary link; wallet balance and internal processing
// states are deliberately not shown here.
function Home({ go, onTrack, onShowUpdates }: { go: (v: View) => void; onTrack: (id: string) => void; onShowUpdates: () => void }) {
  const { data, loading, error } = useAsync<Dashboard>(() => api.dashboard(), []);
  const offerings = useAsync(() => api.serviceOfferings().catch(() => ({ offerings: [] })), []);
  const sub = data?.subscription ?? null;

  const activeOffers = (offerings.data?.offerings ?? []).filter((o) => o.isActive !== false);

  return (
    <Panel loading={loading} error={error}>
      {data && (
        <div className="space-y-6">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back,</p>
            <h2 className="font-display text-2xl font-bold">{data.residentName ?? "there"}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Here&apos;s what&apos;s happening with your laundry.</p>
          </div>

          {/* Active Laundry */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Active Laundry</h3>
            {data.currentOrder ? (
              <button onClick={() => onTrack(data.currentOrder!.id)} className="flex w-full items-center gap-3 rounded-2xl glass p-4 text-left">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{data.currentOrder.orderCode ?? "Laundry order"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {data.currentOrder.acceptedCount != null ? `${data.currentOrder.acceptedCount} garments collected · ` : ""}
                    Expected back: {fmtDate(data.currentOrder.estimatedDeliveryAt ?? data.currentOrder.expectedCompletionAt)}
                  </p>
                  <p className="mt-1.5 text-xs font-medium text-primary">View Order ›</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${stateTone(data.currentOrder.state)}`}>{dashStatus(data.currentOrder.state)}</span>
              </button>
            ) : data.upcomingPickup?.orderId || data.upcomingOrders[0] ? (
              (() => {
                const p = data.upcomingPickup;
                const oid = p?.orderId ?? data.upcomingOrders[0]?.id;
                return (
                  <button onClick={() => oid && onTrack(oid)} className="flex w-full items-center gap-3 rounded-2xl glass p-4 text-left">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{p?.orderCode ?? data.upcomingOrders[0]?.orderCode ?? "Pickup"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Pickup: {fmtDate(p?.date ?? data.upcomingOrders[0]?.scheduledPickupAt)}{p?.window ? ` · ${p.window}${p.startTime ? ` ${p.startTime}–${p.endTime}` : ""}` : ""}
                      </p>
                      <p className="mt-1.5 text-xs font-medium text-primary">View Pickup ›</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning">Scheduled</span>
                  </button>
                );
              })()
            ) : (
              <div className="rounded-2xl glass p-5 text-center">
                <p className="text-sm text-muted-foreground">No active laundry orders</p>
                <button onClick={() => go("book")} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow">
                  <Plus className="size-4" /> Schedule a Pickup
                </button>
              </div>
            )}
          </section>

          {/* Primary: schedule a laundry pickup */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Schedule a Laundry Pickup</h3>
            <button onClick={() => go("book")} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground shadow-glow hover:brightness-110">
              <Plus className="size-4" /> Schedule Pickup
            </button>
          </section>

          {/* Additional services — secondary, text-only */}
          {activeOffers.length > 0 && (
            <section className="rounded-2xl glass p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Additional Services</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Book services separately from your laundry pickup.</p>
                </div>
                <button onClick={() => go("book")} className="shrink-0 text-xs font-medium text-primary">View Additional Services ›</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {activeOffers.slice(0, 4).map((o) => <span key={o.id} className="text-xs text-muted-foreground">{o.name}</span>)}
              </div>
            </section>
          )}

          {/* Recent updates — from real notifications */}
          {data.notifications.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground">Recent Updates{data.unreadNotifications > 0 ? ` · ${data.unreadNotifications} new` : ""}</h3>
                <button onClick={onShowUpdates} className="text-xs font-medium text-primary">View All Updates ›</button>
              </div>
              <div className="space-y-2">
                {data.notifications.slice(0, 3).map((n) => (
                  <div key={n.id} className="rounded-xl glass p-3">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Your plan — compact */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Your Plan</h3>
            <button onClick={() => go("plans")} className="flex w-full items-center gap-3 rounded-2xl glass p-4 text-left">
              <div className="min-w-0 flex-1">
                {sub ? (
                  <>
                    <p className="text-sm font-semibold">{sub.planTier}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{rupees(sub.monthlyPaise)} / month · {sub.remaining} of {sub.allowance} garments remaining</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Renews {fmtDate(sub.renewalDate)}</p>
                  </>
                ) : (
                  <p className="text-sm font-medium">No active plan</p>
                )}
              </div>
              <span className="shrink-0 text-xs font-medium text-primary">{sub ? "View Plan ›" : "Choose a plan ›"}</span>
            </button>
          </section>

          {/* Recent orders preview */}
          {data.recentOrders.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground">Recent Orders</h3>
                <button onClick={() => go("orders")} className="text-xs font-medium text-primary">View All Orders ›</button>
              </div>
              <div className="space-y-2">
                {data.recentOrders.slice(0, 3).map((o) => (
                  <button key={o.id} onClick={() => onTrack(o.id)} className="flex w-full items-center gap-3 rounded-xl glass p-3.5 text-left">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{o.orderCode ?? "Order"}</p>
                      {o.acceptedCount != null && <p className="mt-0.5 text-xs text-muted-foreground">{o.acceptedCount} garments</p>}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${stateTone(o.state)}`}>{dashStatus(o.state)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}

// I-36: the resident only schedules a pickup — a date and a slot. Garments, services
// and quantities are collected by the operator afterwards, so none of that appears
// here; the resident sees the actual collection summary once the operator confirms it.
function Book({ onBooked }: { onBooked: () => void }) {
  const minDate = today();
  const [date, setDate] = useState(minDate);
  const slotsQ = useAsync<{ slots: Slot[] }>(() => api.slots(date), [date]);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!slotId) return;
    setBusy(true); setError(null);
    try { await api.bookPickup(slotId); onBooked(); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? "That slot just filled up. Pick another." : (e instanceof Error ? e.message : "Booking failed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-bold">Book a pickup</h2>
      <p className="-mt-3 text-sm text-muted-foreground">Just choose when we should collect. Our operator notes the clothes, services and quantities at your door — you&apos;ll see the full summary here once they do.</p>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Choose a day</h3>
        <DatePicker
          value={date}
          min={minDate}
          clearable={false}
          ariaLabel="Choose a pickup day"
          onChange={(v) => { const next = v ?? minDate; setDate(next); setSlotId(null); }}
          className="w-full max-w-[16rem]"
        />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Pick a slot for {date === minDate ? "today" : date}</h3>
        <Panel loading={slotsQ.loading} error={slotsQ.error}>
          {(slotsQ.data?.slots ?? []).length === 0 ? (
            <p className="rounded-2xl glass p-5 text-sm text-muted-foreground">No slots left for this day. Try another date.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(slotsQ.data?.slots ?? []).map((s) => {
                const on = slotId === s.id;
                return (
                  <button key={s.id} onClick={() => setSlotId(s.id)}
                    className={`rounded-2xl p-4 text-left transition ${on ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40"}`}>
                    <p className="text-sm font-semibold">{s.window}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.startTime} to {s.endTime}</p>
                    {typeof s.capacityRemaining === "number" && (
                      <p className="mt-1 text-[11px] font-medium text-primary">{s.capacityRemaining} left</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </section>

      <AdditionalServices />

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="h-20" />
      <div className="fixed inset-x-0 bottom-20 z-30 mx-auto flex w-[min(92%,26rem)] items-center justify-between gap-3 rounded-2xl glass-strong px-4 py-3">
        <div>
          <p className="text-[11px] text-muted-foreground">Pickup</p>
          <p className="font-display text-sm font-bold">{!slotId ? "Choose a date and slot" : `${date === minDate ? "Today" : date}`}</p>
        </div>
        <button onClick={confirm} disabled={!slotId || busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Continue"}
        </button>
      </div>
    </div>
  );
}

// I-103090: a secondary section on the Book page. Laundry stays the primary flow
// above; here the resident books an additional service (car wash, ironing, …)
// independently, against the per-date slots an admin or supervisor created. Text
// only — no icons, no repeated "Additional Service" label.
// The offerings endpoint returns the raw offering, so its price lives under one of a
// couple of field names depending on how it was created — read whichever is present.
function offeringPrice(o: ServiceOfferingItem): number {
  const n = o.nonSubscriberPricePaise ?? (o.unitPricePaise as number) ?? (o.pricePaise as number);
  return Number.isFinite(n) ? n : 0;
}

function AdditionalServices() {
  const { data, loading } = useAsync(() => api.serviceOfferings(), []);
  const [expanded, setExpanded] = useState(false);
  const [chosen, setChosen] = useState<ServiceOfferingItem | null>(null);
  const offerings = (data?.offerings ?? []).filter((o) => o.isActive !== false);

  if (loading || offerings.length === 0) return null;

  return (
    <section className="rounded-2xl glass p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Additional Services</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Book a car wash, ironing and more — separate from your laundry pickup.</p>
        </div>
        <button onClick={() => setExpanded((v) => !v)} className="shrink-0 text-xs font-medium text-primary">
          {expanded ? "Hide" : "View Additional Services"}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2">
          {offerings.map((o) => (
            <button key={o.id} onClick={() => setChosen(o)}
              className="flex w-full items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3.5 py-3 text-left hover:ring-1 hover:ring-primary/40">
              <span>
                <span className="block text-sm font-medium">{o.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">from {rupees(offeringPrice(o))} / {o.unit ?? "job"}</span>
              </span>
              <span className="shrink-0 text-sm font-medium text-primary">Select ›</span>
            </button>
          ))}
        </div>
      )}
      {chosen && <AdditionalServiceWizard offering={chosen} onClose={() => setChosen(null)} />}
    </section>
  );
}

function AdditionalServiceWizard({ offering, onClose }: { offering: ServiceOfferingItem; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [date, setDate] = useState("");
  const [slotId, setSlotId] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minDate = today();

  const slotsQ = useAsync<{ slots: import("@/lib/api-client").ServiceDateSlot[] }>(
    () => (date ? api.serviceDateSlots(offering.id, date) : Promise.resolve({ slots: [] })), [date]);
  const quoteQ = useAsync<{ quote: Record<string, unknown> } | null>(
    () => (step === 3 && date ? api.serviceQuote(offering.id, date).catch(() => null) : Promise.resolve(null)), [step, date]);

  const slots = slotsQ.data?.slots ?? [];
  const chosenSlot = slots.find((s) => s.id === slotId) ?? null;
  const quote = quoteQ.data?.quote as { totalPaise?: number; planMode?: string; message?: string } | undefined;

  const confirm = async () => {
    if (!slotId) return;
    setBusy(true); setError(null);
    try { await api.bookServiceSlot({ serviceSlotId: slotId }); setBooked(true); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? "That slot just filled up. Pick another." : (e instanceof Error ? e.message : "Booking failed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <button aria-hidden className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,26rem)] rounded-3xl glass-strong p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold">{offering.name}</h3>
            {!booked && <p className="text-xs text-muted-foreground">Step {step} of 3</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {booked ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-success"><CheckCircle2 className="size-6" /></div>
            <p className="text-sm">Your {offering.name} is booked. Track it in My Orders under Additional Services.</p>
            <button onClick={onClose} className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow">Done</button>
          </div>
        ) : step === 1 ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Select Date</p>
              <DatePicker value={date} min={minDate} clearable={false} ariaLabel="Select date"
                onChange={(v) => { setDate(v ?? minDate); setSlotId(null); }} className="w-full" />
            </div>
            <button disabled={!date} onClick={() => setStep(2)}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">Next</button>
          </div>
        ) : step === 2 ? (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground">Select Slot</p>
            <Panel loading={slotsQ.loading} error={slotsQ.error}>
              {slots.length === 0 ? (
                <p className="rounded-xl glass p-4 text-center text-sm text-muted-foreground">No slots offered for {offering.name} on this day. Try another date.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((s) => (
                    <button key={s.id} disabled={s.full} onClick={() => setSlotId(s.id)}
                      className={`rounded-xl p-3 text-center text-sm ${s.full ? "cursor-not-allowed bg-foreground/5 text-muted-foreground" : slotId === s.id ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40"}`}>
                      <span className="block font-medium">{s.window}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{s.full ? "Full" : `${s.capacityRemaining} left`}</span>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 rounded-xl glass py-3 text-sm font-medium">Back</button>
              <button disabled={!slotId} onClick={() => setStep(3)}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">Review</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl glass p-4 text-sm">
              <div className="flex justify-between py-1"><span className="text-muted-foreground">Service</span><span className="font-medium">{offering.name}</span></div>
              <div className="flex justify-between py-1"><span className="text-muted-foreground">Date</span><span className="font-medium">{date}</span></div>
              <div className="flex justify-between py-1"><span className="text-muted-foreground">Slot</span><span className="font-medium">{chosenSlot?.window} · {chosenSlot?.startTime}–{chosenSlot?.endTime}</span></div>
              <div className="mt-2 flex justify-between border-t border-white/10 pt-2">
                <span className="font-medium">Price</span>
                <span className="font-display font-bold">
                  {quoteQ.loading ? "…" : quote?.totalPaise != null ? rupees(quote.totalPaise) : rupees(offeringPrice(offering))}
                </span>
              </div>
              {quote?.planMode && <p className="mt-1 text-xs text-muted-foreground">{quote.planMode === "included" ? "Included with your plan" : quote.planMode === "covered" ? "Covered by your plan" : "Chargeable"}</p>}
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="flex-1 rounded-xl glass py-3 text-sm font-medium">Back</button>
              <button disabled={busy} onClick={confirm}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">
                {busy ? "Booking…" : "Confirm Booking"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const stateTone = (state: string): string => {
  if (/cancel|fail|reject/.test(state)) return "bg-danger/15 text-danger";
  if (/deliver|complete|ready/.test(state)) return "bg-success/15 text-success";
  if (/scheduled|upcoming|request/.test(state)) return "bg-warning/15 text-warning";
  return "bg-primary/15 text-primary";
};
const prettyState = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// A laundry order and an additional-service booking, unified so My Orders can list
// and filter both. `kind` is the secondary Laundry / Additional filter; `bucket`
// is the Active / Upcoming / History tab.
type OrderBucket = "active" | "upcoming" | "history";
type UnifiedOrder = {
  id: string; kind: "laundry" | "additional"; bucket: OrderBucket;
  code: string; title: string; sub: string; state: string; stateLabel: string;
  priceLabel?: string;
};

function LaundryOrderCard(o: OrderCard, bucket: OrderBucket): UnifiedOrder {
  return {
    id: o.id, kind: "laundry", bucket,
    code: o.orderCode ?? "Order", title: o.orderCode ?? "Laundry order",
    sub: o.scheduledFor ? `Pickup ${new Date(o.scheduledFor).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : (o.serviceName ?? "Laundry"),
    state: o.state, stateLabel: prettyState(o.state),
  };
}
function ServiceOrderCard(r: ServiceRequestCard): UnifiedOrder {
  const done = /complete|cancel|reject/i.test(r.status);
  const date = r.date ?? r.scheduledFor;
  const slot = r.slot ?? r.window;
  const price = r.payablePaise ?? r.quotedPaise;
  return {
    id: r.id, kind: "additional", bucket: done ? "history" : "active",
    code: r.code ?? r.orderCode ?? "AS", title: r.offeringName ?? r.serviceName ?? r.kindLabel ?? "Additional service",
    sub: [date ? new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null, slot].filter(Boolean).join(" · ") || "Additional service",
    state: r.status, stateLabel: r.statusLabel ?? prettyState(r.status),
    priceLabel: price != null ? rupees(price) : undefined,
  };
}

function OrderCardRow({ c, onClick }: { c: UnifiedOrder; onClick: () => void }) {
  return (
    <motion.button variants={itemV} onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl glass p-4 text-left">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{c.title}</p>
          <span className="shrink-0 rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{c.kind === "laundry" ? "Laundry" : "Service"}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.code} · {c.sub}{c.priceLabel ? ` · ${c.priceLabel}` : ""}</p>
        <p className="mt-1.5 text-xs font-medium text-primary">View Details ›</p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${stateTone(c.state)}`}>{c.stateLabel}</span>
    </motion.button>
  );
}

function Orders({ onTrack }: { onTrack: (id: string) => void }) {
  const { data, loading, error } = useAsync(() => api.orders(), []);
  // Additional-service bookings live in their own list; a resident without any (or
  // before the feature is switched on) simply sees an empty Additional filter.
  const services = useAsync(() => api.serviceRequests().catch(() => ({ requests: [] })), []);
  const [tab, setTab] = useState<OrderBucket>("active");
  const [kind, setKind] = useState<"all" | "laundry" | "additional">("all");
  const [query, setQuery] = useState("");

  const all: UnifiedOrder[] = [
    ...(data?.current ?? []).map((o) => LaundryOrderCard(o, "active")),
    ...(data?.upcoming ?? []).map((o) => LaundryOrderCard(o, "upcoming")),
    ...(data?.previous ?? []).map((o) => LaundryOrderCard(o, "history")),
    ...((services.data?.requests ?? []).map(ServiceOrderCard)),
  ];
  const counts = {
    active: all.filter((c) => c.bucket === "active").length,
    upcoming: all.filter((c) => c.bucket === "upcoming").length,
    history: all.filter((c) => c.bucket === "history").length,
  };
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((c) => c.bucket === tab)
    .filter((c) => kind === "all" || c.kind === kind)
    .filter((c) => !q || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q));

  const tabs: { id: OrderBucket; label: string }[] = [
    { id: "active", label: "Active" }, { id: "upcoming", label: "Upcoming" }, { id: "history", label: "History" },
  ];
  const kinds: { id: "all" | "laundry" | "additional"; label: string }[] = [
    { id: "all", label: "All" }, { id: "laundry", label: "Laundry" }, { id: "additional", label: "Additional Services" },
  ];

  return (
    <Panel loading={loading} error={error}>
      <div className="mb-4">
        <h2 className="font-display text-2xl font-bold">My Orders</h2>
        <p className="mt-1 text-sm text-muted-foreground">Track your laundry pickups and additional-service bookings.</p>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3">
        <PackageSearch className="size-4 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by Order ID" className="w-full bg-transparent py-2.5 text-sm outline-none" />
      </div>

      <div className="mb-3 flex gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 rounded-xl py-2 text-sm font-medium ${tab === t.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground"}`}>
            {t.label} <span className="text-xs opacity-70">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-1.5">
        {kinds.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${kind === k.id ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {k.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">
          {all.length === 0 ? "No orders yet. Book your first pickup from the Booking tab." : "Nothing here. Try another tab or filter."}
        </div>
      ) : (
        <motion.div variants={listV} initial="hidden" animate="show" className="space-y-2">
          {shown.map((c) => <OrderCardRow key={`${c.kind}-${c.id}`} c={c} onClick={() => onTrack(c.id)} />)}
        </motion.div>
      )}
    </Panel>
  );
}

// Enforced backend-side by the actual booking cutoff; mirrored here only so the
// button can hide itself before a doomed request round-trips. The real answer,
// including any fee, always comes back from the cancel/reschedule call itself.
const PICKUP_CHANGE_CUTOFF_HOURS = 2;
const FREE_CHANGE_WINDOW_MINUTES = 60;
const CANCELLATION_FEE_RUPEES = 99;
const RESCHEDULE_FEE_RUPEES = 49;

function TrackView({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { data, loading, error, reload: reloadTracking } = useAsync<Tracking>(() => api.tracking(orderId), [orderId]);
  const detail = useAsync<{ order: import("@/lib/api-client").OrderDetail } | null>(
    () => api.orderDetail(orderId).catch(() => null), [orderId],
  );
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const order = detail.data?.order;
  const changeable = Boolean(order && order.state === "scheduled" && order.pickupId);
  const withinCutoff = changeable && order!.scheduledPickupAt
    ? new Date(order!.scheduledPickupAt).getTime() - Date.now() < PICKUP_CHANGE_CUTOFF_HOURS * 3600_000
    : false;
  const minutesSinceBooking = order ? (Date.now() - new Date(order.createdAt).getTime()) / 60_000 : 0;
  const feeApplies = minutesSinceBooking >= FREE_CHANGE_WINDOW_MINUTES;

  const describeFee = (result: { feeChargedPaise: number; feePending: boolean }) => {
    if (result.feeChargedPaise > 0) return `Done — a ₹${(result.feeChargedPaise / 100).toFixed(0)} fee was charged since it's past the free window.`;
    if (result.feePending) return "Done — a fee applies but your wallet balance was too low, so it's still outstanding.";
    return "Done — free, within the hour.";
  };

  const cancelBooking = async () => {
    if (!order?.pickupId) return;
    setActing(true); setActionError(null);
    try {
      const result = await api.cancelPickup(order.pickupId);
      setNotice(describeFee(result));
      setConfirmingCancel(false);
      detail.reload();
      reloadTracking();
    } catch (e) {
      setActionError(e instanceof ApiError && e.status === 409 ? "That's too close to the pickup time to cancel now." : (e instanceof Error ? e.message : "Could not cancel"));
    } finally { setActing(false); }
  };

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-primary"><ArrowLeft className="size-4" /> Orders</button>
      <Panel loading={loading} error={error}>
        {data && (
          <div>
            <h2 className="font-display text-2xl font-bold">{data.orderCode ?? "Order"}</h2>
            <p className="mt-1 text-sm text-primary">{data.state.replace(/_/g, " ")}</p>
            <ol className="mt-6 space-y-4">
              {data.timeline.map((t, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 flex-none text-primary" />
                  <div>
                    <p className="text-sm font-medium">{t.state.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">{new Date(t.at).toLocaleString()}</p>
                    {t.note && <p className="text-xs text-accent">{t.note}</p>}
                  </div>
                </motion.li>
              ))}
            </ol>

            {/* I-36: once the operator has collected and recorded the clothes, the
                resident sees the actual collection summary — the services, garment
                counts and any weighed amount the operator entered. */}
            {order && (order.acceptedCount != null || (order.lines?.length ?? 0) > 0) && (
              <section className="mt-6 rounded-2xl glass p-4">
                <h3 className="font-display text-sm font-bold">Clothes collection summary</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Recorded by the operator at collection.</p>
                <ul className="mt-3 space-y-2">
                  {(order.lines ?? []).map((l, i) => (
                    <li key={l.id ?? i} className="flex items-center justify-between text-sm">
                      <span>{l.serviceName ? `${l.serviceName} · ` : ""}{l.category}</span>
                      <span className="font-medium tabular-nums">{l.quantity}{l.measuredQuantity ? ` · ${l.measuredQuantity} ${l.unit ?? "kg"}` : ""}</span>
                    </li>
                  ))}
                </ul>
                {order.acceptedCount != null && (
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
                    <span className="text-muted-foreground">Total garments collected</span>
                    <span className="font-display text-lg font-bold tabular-nums">{order.acceptedCount}</span>
                  </div>
                )}
              </section>
            )}

            {notice && <p className="mt-5 rounded-xl bg-primary/10 p-3 text-sm text-primary">{notice}</p>}
            {actionError && <p className="mt-3 text-sm text-danger">{actionError}</p>}

            {changeable && !withinCutoff && !rescheduling && (
              <div className="mt-6 space-y-3 border-t border-border pt-5">
                <h3 className="text-sm font-semibold text-muted-foreground">Change this booking</h3>
                <p className="text-xs text-muted-foreground">
                  {feeApplies
                    ? `A ₹${CANCELLATION_FEE_RUPEES} cancellation fee or ₹${RESCHEDULE_FEE_RUPEES} reschedule fee applies now — it's been over an hour since booking.`
                    : "Free to cancel or reschedule for the next while — no charge yet."}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setRescheduling(true)} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium hover:ring-1 hover:ring-primary/40">
                    Reschedule booking
                  </button>
                  {confirmingCancel ? (
                    <button onClick={cancelBooking} disabled={acting}
                      className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                      {acting ? "Cancelling…" : "Confirm cancel"}
                    </button>
                  ) : (
                    <button onClick={() => setConfirmingCancel(true)} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium text-danger hover:ring-1 hover:ring-danger/40">
                      Cancel booking
                    </button>
                  )}
                </div>
              </div>
            )}
            {changeable && withinCutoff && (
              <p className="mt-6 rounded-xl bg-warning/10 p-3 text-sm text-warning border-t border-border pt-5">
                Too close to pickup time to cancel or reschedule now.
              </p>
            )}

            {rescheduling && order?.pickupId && (
              <RescheduleInline
                pickupId={order.pickupId}
                onDone={(result) => { setNotice(describeFee(result)); setRescheduling(false); detail.reload(); reloadTracking(); }}
                onCancel={() => setRescheduling(false)}
              />
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RescheduleInline({ pickupId, onDone, onCancel }: {
  pickupId: string; onDone: (result: { feeChargedPaise: number; feePending: boolean }) => void; onCancel: () => void;
}) {
  const minDate = today();
  const [date, setDate] = useState(minDate);
  const slotsQ = useAsync<{ slots: Slot[] }>(() => api.slots(date), [date]);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!slotId) return;
    setBusy(true); setError(null);
    try { onDone(await api.reschedulePickup(pickupId, slotId)); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? "That slot isn't available. Pick another." : (e instanceof Error ? e.message : "Could not reschedule")); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4 space-y-3 rounded-2xl glass p-4">
      <DatePicker value={date} min={minDate} clearable={false} ariaLabel="Reschedule date"
        onChange={(v) => { setDate(v ?? minDate); setSlotId(null); }} className="w-full max-w-[16rem]" />
      <Panel loading={slotsQ.loading} error={slotsQ.error}>
        {(slotsQ.data?.slots ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No slots left for this day.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(slotsQ.data?.slots ?? []).map((s) => (
              <button key={s.id} onClick={() => setSlotId(s.id)}
                className={`rounded-xl p-2.5 text-left text-xs transition ${slotId === s.id ? "bg-primary/15 ring-1 ring-primary" : "glass-strong hover:ring-1 hover:ring-primary/40"}`}>
                <p className="font-semibold">{s.window}</p>
                <p className="text-muted-foreground">{s.startTime}</p>
              </button>
            ))}
          </div>
        )}
      </Panel>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 rounded-xl glass py-2 text-sm font-medium">Never mind</button>
        <button onClick={confirm} disabled={!slotId || busy}
          className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? "Moving…" : "Confirm new slot"}
        </button>
      </div>
    </div>
  );
}

// The account hub. Consolidates what used to be scattered tabs — plan, wallet and
// support each become a summary card that opens the full screen — alongside the
// resident's own details. Society, block and flat are shown read-only: those are an
// operator's to change, not the resident's.
function Profile({ go, onLogout }: { go: (v: View) => void; onLogout: () => void }) {
  const { data, loading, error, reload } = useAsync(() => api.getProfile(), []);
  const wallet = useAsync(() => api.wallet(), []);
  const sub = useAsync(() => api.residentSubscription(), []);
  const [editing, setEditing] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  const profile = data?.profile;
  const current = sub.data?.current ?? null;

  const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value || "—"}</span>
    </div>
  );

  const SummaryCard = ({ icon: Icon, title, value, cta, onClick }: {
    icon: React.ComponentType<{ className?: string }>; title: string; value: string; cta: string; onClick: () => void;
  }) => (
    <div className="rounded-2xl glass p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="truncate font-semibold">{value}</p>
        </div>
        <button onClick={onClick} className="inline-flex shrink-0 items-center gap-1 rounded-full glass px-3 py-1.5 text-xs font-medium hover:ring-1 hover:ring-primary/40">
          {cta} <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <Panel loading={loading} error={error}>
      <div className="space-y-5">
        <div>
          <h2 className="font-display text-2xl font-bold">Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage your personal information and account services.</p>
        </div>

        <section className="rounded-2xl glass p-5">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Personal Information</h3>
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
              <Pencil className="size-3.5" /> Edit Profile
            </button>
          </div>
          <Row label="Full Name" value={profile?.fullName} />
          <Row label="Mobile" value={profile?.phone} />
          <Row label="Email" value={profile?.email} />
        </section>

        <section className="rounded-2xl glass p-5">
          <h3 className="mb-1 text-sm font-semibold">Residence Details</h3>
          <Row label="Society" value={profile?.societyName} />
          <Row label="Block" value={profile?.towerBlock} />
          <Row label="Flat" value={profile?.unitNumber} />
          <p className="mt-2 text-xs text-muted-foreground">Managed by Wash N Press. Contact support to update your residence.</p>
        </section>

        <SummaryCard icon={ClipboardList} title="My Plan"
          value={current ? current.planTier : "No active plan"}
          cta="View Plan" onClick={() => go("plans")} />
        <SummaryCard icon={CreditCard} title="Wallet"
          value={wallet.data?.balanceFormatted ?? "—"}
          cta="View Wallet" onClick={() => go("wallet")} />
        <SummaryCard icon={LifeBuoy} title="Support"
          value="Get help with an order or account"
          cta="Contact Support" onClick={() => go("support")} />

        <button onClick={() => setConfirmOut(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl glass py-3.5 text-sm font-semibold text-danger hover:ring-1 hover:ring-danger/40">
          <LogOut className="size-4" /> Sign Out
        </button>
      </div>

      {editing && profile && <EditProfileModal profile={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {confirmOut && (
        <div className="fixed inset-0 z-[100] grid place-items-center p-4">
          <button aria-hidden className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setConfirmOut(false)} />
          <div className="relative z-10 w-[min(92vw,22rem)] rounded-3xl glass-strong p-6">
            <h3 className="font-display text-lg font-bold">Sign out?</h3>
            <p className="mt-1 text-sm text-muted-foreground">You'll need your mobile number to sign back in.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmOut(false)} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
              <button onClick={onLogout} className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-white">Sign Out</button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function EditProfileModal({ profile, onClose, onSaved }: { profile: ResidentProfile; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(profile.fullName ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.updateProfile({ fullName: fullName.trim() || undefined, email: email.trim() || undefined });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <button aria-hidden className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,26rem)] rounded-3xl glass-strong p-6">
        <h3 className="font-display text-lg font-bold">Edit Profile</h3>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Full Name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Mobile</span>
            <input value={profile.phone ?? ""} disabled className="w-full cursor-not-allowed rounded-xl border border-border bg-foreground/5 px-3.5 py-2.5 text-sm text-muted-foreground outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={save} disabled={busy} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function WalletView({ onBack }: { onBack?: () => void }) {
  const { data, loading, error, reload } = useAsync(() => api.wallet(), []);
  const txns = useAsync(() => api.walletTransactions(), []);
  const [note, setNote] = useState<string | null>(null);
  const topup = async (paise: number) => {
    setNote(null);
    try { const r = await api.topup(paise); setNote(`Payment started (${r.paymentOrder?.providerOrderId ?? "order"}). Your balance updates once the payment is confirmed.`); reload(); }
    catch (e) { setNote(e instanceof Error ? e.message : "Top up failed"); }
  };
  return (
    <Panel loading={loading} error={error}>
      {onBack && <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-primary"><ArrowLeft className="size-4" /> Profile</button>}
      <h2 className="mb-4 font-display text-2xl font-bold">Wallet</h2>
      {data && (
        <div className="rounded-3xl glass-strong p-6">
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className="mt-1 font-display text-4xl font-bold">{data.balanceFormatted}</p>
        </div>
      )}
      <div className="mt-4 flex gap-3">
        {[20000, 50000, 100000].map((p) => (
          <button key={p} onClick={() => topup(p)} className="flex-1 rounded-xl glass py-3 text-sm font-semibold hover:ring-1 hover:ring-primary/40">Add {rupees(p)}</button>
        ))}
      </div>
      {note && <p className="mt-3 text-sm text-muted-foreground">{note}</p>}
      <h3 className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">Transactions</h3>
      <Panel loading={txns.loading} error={txns.error}>
        {(txns.data?.transactions ?? []).length === 0 ? (
          <p className="rounded-2xl glass p-5 text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <div className="space-y-2">
            {(txns.data?.transactions ?? []).map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-2xl glass p-3.5">
                <span className="text-xs text-muted-foreground">{t.reference}</span>
                <span className={t.direction === "credit" ? "text-primary" : "text-danger"}>{t.direction === "credit" ? "+" : "-"}{rupees(t.amountPaise)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </Panel>
  );
}

const dirLabel = (d: AvailablePlan["direction"]) =>
  d === "upgrade" ? "Upgrade" : d === "downgrade" ? "Downgrade" : "Switch";

function Plans({ onBack }: { onBack?: () => void }) {
  const { data, loading, error, reload } = useAsync<{ current: SubscriptionUsage | null; availablePlans: AvailablePlan[] }>(() => api.residentSubscription(), []);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null);
  const [selected, setSelected] = useState<AvailablePlan | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [confirmingCancelChange, setConfirmingCancelChange] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("No longer needed");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const current = data?.current ?? null;
  const plans = data?.availablePlans ?? [];
  const pending = current?.pendingPlan ?? null;

  const subscribe = async (p: AvailablePlan) => {
    setBusy(p.id); setNote(null);
    try { await api.subscribe(p.id); setNote(`Subscribed to ${p.name}.`); reload(); }
    catch (e) { setNote(e instanceof ApiError && e.status === 402 ? "Not enough wallet balance. Add money in the Wallet tab first." : (e instanceof Error ? e.message : "Could not subscribe")); }
    finally { setBusy(null); }
  };

  const review = async (p: AvailablePlan) => {
    setBusy(p.id); setQuoteError(null); setSelected(p);
    try { setQuote((await api.quotePlanChange(p.id)).quote); }
    catch (e) { setNote(e instanceof Error ? e.message : "Could not quote that change"); setSelected(null); }
    finally { setBusy(null); }
  };

  const confirmChange = async () => {
    if (!quote) return;
    setBusy(quote.newPlanId); setQuoteError(null);
    try { const r = await api.changePlan(quote.newPlanId); setNote(r.note); setQuote(null); setSelected(null); reload(); }
    catch (e) {
      setQuoteError(e instanceof ApiError && e.status === 402
        ? "There is not enough in your wallet to cover the difference. Top up in the Wallet tab and try again."
        : (e instanceof Error ? e.message : "Could not change plan"));
    } finally { setBusy(null); }
  };

  const cancelScheduledChange = async () => {
    setBusy("cancel-change");
    try { await api.cancelPlanChange(); setNote("Scheduled change cancelled. Your current plan stays active."); setConfirmingCancelChange(false); reload(); }
    catch (e) { setNote(e instanceof Error ? e.message : "Could not cancel the change"); }
    finally { setBusy(null); }
  };

  const cancelSubscription = async () => {
    setCancelBusy(true); setCancelError(null);
    try {
      const r = await api.cancelSubscription(cancelReason);
      setCancelling(false);
      setNote(r.refundPaise > 0 ? `Subscription cancelled. ₹${(r.refundPaise / 100).toFixed(2)} refunded to your wallet.` : "Subscription cancelled.");
      reload();
    } catch (e) { setCancelError(e instanceof Error ? e.message : "Could not cancel"); }
    finally { setCancelBusy(false); }
  };

  return (
    <Panel loading={loading} error={error}>
      {onBack && <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-primary"><ArrowLeft className="size-4" /> Profile</button>}
      <h2 className="mb-4 font-display text-2xl font-bold">Plan</h2>
      {note && <p className="mb-3 rounded-xl bg-primary/10 p-3 text-sm text-foreground">{note}</p>}

      {/* Current plan — amount, garment usage (no progress bar), turnaround, dates */}
      {current && (
        <div className="mb-5 rounded-3xl glass-strong p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Plan</p>
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">Active</span>
          </div>
          <p className="mt-1 font-display text-2xl font-bold">{current.planTier}</p>

          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Plan Amount</dt>
              <dd className="font-display text-lg font-semibold">{rupees(current.monthlyPaise)}<span className="text-xs font-normal text-muted-foreground"> / month</span></dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Garment Usage</dt>
              <dd className="font-semibold">{current.used} of {current.allowance} used</dd>
              <dd className="text-xs text-muted-foreground">{current.remaining} garments remaining</dd>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><dt className="text-xs text-muted-foreground">Turnaround</dt><dd className="font-medium">{current.turnaroundHours} hours</dd></div>
              <div><dt className="text-xs text-muted-foreground">Start Date</dt><dd className="font-medium">{fmtDate(current.cycleStart)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Next Renewal</dt><dd className="font-medium">{fmtDate(current.renewalDate)}</dd></div>
            </div>
          </dl>

          {!cancelling ? (
            <button onClick={() => setCancelling(true)} className="mt-4 text-sm font-medium text-danger">Cancel subscription</button>
          ) : (
            <div className="mt-4 space-y-2 rounded-2xl bg-danger/10 p-3">
              <p className="text-xs text-muted-foreground">
                Cancelling takes effect immediately and refunds the unused part of what you already paid this cycle straight to your wallet. Your remaining allowance goes with it.
              </p>
              <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why are you cancelling?"
                className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              {cancelError && <p className="text-xs text-danger">{cancelError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setCancelling(false)} className="flex-1 rounded-xl glass py-2 text-sm font-medium">Never mind</button>
                <button onClick={cancelSubscription} disabled={cancelBusy || !cancelReason.trim()}
                  className="flex-1 rounded-xl bg-danger py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {cancelBusy ? "Cancelling…" : "Confirm cancel"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scheduled plan change — its own section, only when one is pending */}
      {pending && (
        <div className="mb-5 rounded-3xl border border-primary/30 bg-primary/5 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Scheduled Plan Change</p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="font-display text-lg font-bold">{pending.tier}</p>
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold capitalize text-primary">{pending.direction === "sidegrade" ? "Switch" : pending.direction}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{rupees(pending.monthlyPaise)} / month · {pending.allowance} garments</p>
          <p className="mt-1 text-sm"><span className="text-muted-foreground">Effective:</span> {fmtDate(pending.effectiveFrom)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Your current plan stays active until then.</p>
          {pending.canCancel && (
            !confirmingCancelChange ? (
              <button onClick={() => setConfirmingCancelChange(true)} className="mt-3 rounded-xl glass px-4 py-2 text-sm font-semibold text-primary">Cancel Change</button>
            ) : (
              <div className="mt-3 rounded-2xl bg-background/60 p-3">
                <p className="text-sm font-semibold">Cancel plan change?</p>
                <p className="mt-1 text-xs text-muted-foreground">Your scheduled change to {pending.tier} will be cancelled. Your current plan will remain active.</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setConfirmingCancelChange(false)} className="flex-1 rounded-xl glass py-2 text-sm font-medium">Keep Change</button>
                  <button onClick={cancelScheduledChange} disabled={busy === "cancel-change"}
                    className="flex-1 rounded-xl bg-danger py-2 text-sm font-semibold text-white disabled:opacity-60">
                    {busy === "cancel-change" ? "Cancelling…" : "Cancel Change"}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Available plans — every plan; the current one is labelled, not offered */}
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Available Plans</h3>
      <motion.div variants={listV} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2">
        {plans.map((p) => (
          <motion.div key={p.id} variants={itemV} className={`rounded-3xl glass-strong p-5 ${p.isCurrent ? "ring-1 ring-primary/40" : ""}`}>
            <p className="font-display text-lg font-bold">{p.name}</p>
            {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
            <p className="mt-2 font-display text-lg font-semibold">{rupees(p.monthlyPaise)}<span className="text-xs font-normal text-muted-foreground"> / month</span></p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" /> {p.garmentCap} garments / month</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" /> {p.turnaroundHours} hours turnaround</li>
            </ul>

            {!current ? (
              <button onClick={() => subscribe(p)} disabled={busy === p.id}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
                {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : "Choose plan"}
              </button>
            ) : p.isCurrent ? (
              <div className="mt-4 rounded-xl bg-muted py-3 text-center text-sm font-semibold text-muted-foreground">Current Plan</div>
            ) : !p.canChange ? (
              <div className="mt-4 rounded-xl bg-muted py-3 text-center text-sm font-medium text-muted-foreground">Change Scheduled</div>
            ) : (
              <button onClick={() => review(p)} disabled={busy === p.id}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
                {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : dirLabel(p.direction)}
              </button>
            )}
          </motion.div>
        ))}
      </motion.div>

      {quote && selected && current && (
        <PlanChangeModal quote={quote} plan={selected} current={current} busy={busy === quote.newPlanId} error={quoteError}
          onConfirm={confirmChange} onClose={() => { setQuote(null); setSelected(null); setQuoteError(null); }} />
      )}
    </Panel>
  );
}

function PlanChangeModal({ quote, plan, current, busy, error, onConfirm, onClose }: {
  quote: PlanChangeQuote; plan: AvailablePlan; current: SubscriptionUsage;
  busy: boolean; error: string | null; onConfirm: () => void; onClose: () => void;
}) {
  const title = plan.direction === "downgrade" ? "Downgrade Plan" : plan.direction === "upgrade" ? "Upgrade Plan" : "Change Plan";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl glass-strong p-6">
        <h3 className="font-display text-lg font-bold">{title}</h3>

        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-2xl bg-background/50 p-3">
            <p className="text-xs text-muted-foreground">You are currently on</p>
            <p className="font-semibold">{quote.currentPlanTier}</p>
            <p className="text-xs text-muted-foreground">{rupees(quote.currentCyclePaise)} / month · {current.allowance} garments / month</p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3">
            <p className="text-xs text-muted-foreground">You are {plan.direction === "downgrade" ? "changing" : "upgrading"} to</p>
            <p className="font-semibold">{quote.newPlanTier}</p>
            <p className="text-xs text-muted-foreground">{rupees(quote.newCyclePaise)} / month · {plan.garmentCap} garments / month</p>
          </div>
          <div className="flex justify-between"><span className="text-muted-foreground">Effective Date</span><span className="font-medium">{fmtDate(quote.effectiveFrom)}</span></div>
          <div className="flex justify-between font-semibold"><span>To pay now</span><span>{quote.amountDuePaise > 0 ? rupees(quote.amountDuePaise) : "Nothing"}</span></div>
        </div>

        <p className="mt-3 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
          {quote.immediate
            ? "Paying moves you to the new plan now, with its own allowance from today."
            : "Your current plan will remain active until the end of your current billing period. The new plan will take effect from your next renewal date."}
        </p>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {busy ? <Loader2 className="mx-auto size-4 animate-spin" /> : quote.amountDuePaise > 0 ? `Pay ${rupees(quote.amountDuePaise)}` : `Confirm ${plan.direction === "downgrade" ? "Downgrade" : plan.direction === "upgrade" ? "Upgrade" : "Change"}`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const RESIDENT_PRIORITIES: IssuePriority[] = ["normal", "high", "emergency"];
const priorityTone: Record<IssuePriority, string> = {
  low: "bg-muted text-muted-foreground", normal: "bg-primary/15 text-primary",
  high: "bg-warning/15 text-warning", emergency: "bg-danger/15 text-danger",
};
const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Support({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const { data, loading, error, reload } = useAsync<{ tickets: SupportTicket[] }>(() => api.listTickets(), []);
  const [composing, setComposing] = useState(false);

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-primary"><ArrowLeft className="size-4" /> Home</button>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">Support</h2>
        {!composing && (
          <button onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110">
            <Plus className="size-4" /> New ticket
          </button>
        )}
      </div>

      {composing && (
        <NewTicketForm
          onCancel={() => setComposing(false)}
          onCreated={(id) => { setComposing(false); reload(); onOpen(id); }}
        />
      )}

      {!composing && (
        <Panel loading={loading} error={error}>
          {(data?.tickets ?? []).length === 0 ? (
            <p className="rounded-2xl glass p-6 text-center text-sm text-muted-foreground">No support tickets yet. Something not right with an order, or a question for us? Raise a ticket any time — with or without a plan.</p>
          ) : (
            <motion.div variants={listV} initial="hidden" animate="show" className="space-y-2">
              {(data?.tickets ?? []).map((t) => (
                <motion.button key={t.id} variants={itemV} onClick={() => onOpen(t.id)} className="flex w-full items-center justify-between rounded-2xl glass p-4 text-left">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{humanize(t.category)}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.conversation?.preview || t.description}</p>
                  </div>
                  <div className="ml-3 flex flex-none flex-col items-end gap-1">
                    <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] text-primary">{humanize(t.status)}</span>
                    {(t.conversation?.unreadCount ?? 0) > 0 && <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{t.conversation!.unreadCount}</span>}
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}
        </Panel>
      )}
    </div>
  );
}

function NewTicketForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (ticketId: string) => void }) {
  const types = useAsync<{ issueTypes: string[]; priorities: string[] }>(() => api.supportIssueTypes(), []);
  const ordersQ = useAsync(() => api.orders(), []);
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<IssuePriority>("normal");
  const [orderId, setOrderId] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allOrders = ordersQ.data ? [...ordersQ.data.current, ...ordersQ.data.upcoming, ...ordersQ.data.previous] : [];
  const maxLen = 1000;

  useEffect(() => {
    if (!category && types.data?.issueTypes?.length) setCategory(types.data.issueTypes[0]);
  }, [types.data, category]);

  const submit = async () => {
    if (!category || !description.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api.createTicket({ category, description: description.trim(), priority, orderId: orderId || undefined });
      onCreated(r.ticket.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the ticket"); }
    finally { setBusy(false); }
  };

  return (
    <div className="mb-5 space-y-4 rounded-3xl glass-strong p-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Category</label>
        <Panel loading={types.loading} error={types.error}>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            {(types.data?.issueTypes ?? []).map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
        </Panel>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Priority</label>
        <div className="flex gap-2">
          {RESIDENT_PRIORITIES.map((p) => (
            <button key={p} onClick={() => setPriority(p)}
              className={`flex-1 rounded-xl py-2 text-xs font-medium capitalize transition ${priority === p ? "bg-primary/15 ring-1 ring-primary text-primary" : "glass text-muted-foreground"}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {allOrders.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Related order (optional)</label>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">Not order specific</option>
            {allOrders.map((o) => <option key={o.id} value={o.id}>{o.orderCode ?? o.serviceName ?? "Order"}</option>)}
          </select>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-muted-foreground">What's going on?</label>
          <span className="text-[11px] text-muted-foreground">{description.length}/{maxLen}</span>
        </div>
        <textarea value={description} maxLength={maxLen} onChange={(e) => setDescription(e.target.value)} rows={4}
          placeholder="Describe the issue — as much detail as helps us sort it out."
          className="w-full resize-none rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Never mind</button>
        <button onClick={submit} disabled={busy || !category || !description.trim()}
          className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="mx-auto size-4 animate-spin" /> : "Submit ticket"}
        </button>
      </div>
    </div>
  );
}

function TicketDetail({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const ticketQ = useAsync<{ ticket: SupportTicket }>(() => api.getTicket(ticketId), [ticketId]);
  const convoQ = useAsync<{ conversation: ConversationView }>(() => api.ticketConversation(ticketId), [ticketId]);
  const attachmentsQ = useAsync<{ attachments: AttachmentSummary[] }>(() => api.ticketAttachments(ticketId), [ticketId]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const ticket = ticketQ.data?.ticket;
  const conversation = convoQ.data?.conversation;
  const canClose = ticket && !["resolved", "closed"].includes(ticket.status);

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true); setError(null);
    try { await api.replyToTicket(ticketId, reply.trim()); setReply(""); convoQ.reload(); ticketQ.reload(); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? "This conversation is no longer open to replies." : (e instanceof Error ? e.message : "Could not send")); }
    finally { setBusy(false); }
  };

  const close = async () => {
    setClosing(true); setError(null);
    try { await api.closeTicket(ticketId); ticketQ.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not close the ticket"); }
    finally { setClosing(false); }
  };

  const onAttach = async (file: File) => {
    setError(null);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      await api.attachToTicket(ticketId, { filename: file.name, contentType: file.type || "image/jpeg", data });
      attachmentsQ.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not attach that photo"); }
  };

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-primary"><ArrowLeft className="size-4" /> Support</button>
      <Panel loading={ticketQ.loading} error={ticketQ.error}>
        {ticket && (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold">{humanize(ticket.category)}</h2>
                {ticket.order && <p className="mt-0.5 text-xs text-muted-foreground">Order {ticket.order.orderCode}</p>}
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] text-primary">{humanize(ticket.status)}</span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] capitalize ${priorityTone[ticket.priority]}`}>{ticket.priority}</span>
              </div>
            </div>
            <p className="mt-3 rounded-2xl glass p-3 text-sm text-muted-foreground">{ticket.description}</p>

            <Panel loading={convoQ.loading} error={convoQ.error}>
              <div className="mt-5 space-y-3">
                {(conversation?.messages ?? []).map((m, i) => (
                  <div key={i} className={m.side === "system" ? "text-center" : m.side === "mine" ? "flex justify-end" : "flex justify-start"}>
                    {m.side === "system" ? (
                      <p className="mx-auto max-w-xs text-xs italic text-muted-foreground">{m.body}</p>
                    ) : (
                      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${m.side === "mine" ? "bg-primary/15" : "glass"}`}>
                        {m.authorName && m.side === "theirs" && <p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{m.authorName}</p>}
                        <p>{m.body}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel loading={attachmentsQ.loading} error={attachmentsQ.error}>
              {(attachmentsQ.data?.attachments.length ?? 0) > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {attachmentsQ.data!.attachments.map((a) => <AttachmentThumb key={a.id} attachment={a} />)}
                </div>
              )}
            </Panel>

            {error && <p className="mt-3 text-sm text-danger">{error}</p>}

            {conversation && !conversation.canReply && (
              <p className="mt-4 rounded-xl bg-warning/10 p-3 text-sm text-warning">{conversation.readOnlyReason ?? "This conversation is read only."}</p>
            )}

            {conversation?.canReply && (
              <div className="mt-4 space-y-2">
                <div className="flex items-end gap-2">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder={conversation.replyLabel || "Write a reply…"}
                    className="flex-1 resize-none rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                  <label className="grid size-10 flex-none cursor-pointer place-items-center rounded-xl glass text-muted-foreground hover:text-foreground">
                    <Paperclip className="size-4" />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
                  </label>
                  <button onClick={send} disabled={busy || !reply.trim()} aria-label="Send"
                    className="grid size-10 flex-none place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50">
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </button>
                </div>
              </div>
            )}

            {canClose && (
              <button onClick={close} disabled={closing} className="mt-4 text-sm font-medium text-danger disabled:opacity-60">
                {closing ? "Closing…" : "Close ticket"}
              </button>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function AttachmentThumb({ attachment }: { attachment: AttachmentSummary }) {
  const { data, loading } = useAsync(() => api.fetchAttachmentAsDataUri(attachment.id), [attachment.id]);
  return (
    <div className="grid size-16 place-items-center overflow-hidden rounded-xl glass">
      {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : data
        ? <img src={data} alt={attachment.filename} className="size-full object-cover" />
        : <MessageSquare className="size-4 text-muted-foreground" />}
    </div>
  );
}
