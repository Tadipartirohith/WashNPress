"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Shirt, Car, Wind, Sparkles, CalendarClock, PackageSearch,
  ArrowLeft, LogOut, Loader2, Plus, CheckCircle2, Clock, ClipboardList,
  LifeBuoy, Send, Paperclip, MessageSquare, Bell, User as UserIcon, ChevronRight,
  CreditCard, Home as HomeIcon, Pencil, Menu, X as XIcon, Check,
  Trash2, Phone, Mail, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  api, setToken, getToken, ApiError, setSessionExpiredHandler, deleteAccount,
  type Dashboard, type Slot, type Tracking, type SubscriptionUsage, type PlanChangeQuote,
  type AvailablePlan, type SupportTicket, type IssuePriority, type ConversationView,
  type AttachmentSummary, type ResidentProfile, type NotificationItem, type ServiceRequestCard,
  type ServiceOfferingItem, type ServiceDateSlot, type OrderCard, type SupportContact,
} from "@/lib/api-client";
import { DatePicker } from "@/components/portal/date-picker";
import { ThemeToggle } from "@/components/portal/theme-toggle";
import { GrievanceOfficer } from "@/components/site/grievance-officer";
import { emailProblem, isPhone, phoneProblem } from "@/lib/contact";
import { rupees, serviceDay } from "@/lib/format";
import { useDialog } from "@/lib/use-dialog";
import { checkoutMode, startCheckout } from "@/lib/payments";

// The minimum bookable day, in the operation's own timezone rather than UTC — see
// serviceDay(). This was `toISOString().slice(0, 10)`, so any resident booking after
// 05:30 IST was offered yesterday as the earliest pickup and the backend refused it.
const today = () => serviceDay();

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

type View = "home" | "book" | "orders" | "profile" | "wallet" | "plans" | "track" | "service" | "support" | "ticket";

// Where each role's portal lives, so the app entry (I-75) can redirect a supervisor
// or operator to their own portal instead of the resident app. Admin stays web-only.
const PORTAL_ROUTE: Record<string, string> = { admin: "/admin", supervisor: "/supervisor", operations: "/operations", resident: "/app" };
function portalFor(roles: string[]): "admin" | "supervisor" | "operations" | "resident" {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("supervisor")) return "supervisor";
  if (roles.includes("operator")) return "operations";
  return "resident";
}

export default function ResidentApp() {
  const [booted, setBooted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [view, setView] = useState<View>("home");
  const [trackId, setTrackId] = useState<string | null>(null);
  // An additional-service booking is a different thing from a laundry order and has
  // its own screen; keeping its id separate is what stops the two being confused.
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // I-82: booking is a modal wizard, not a page — it opens over whatever the resident
  // is looking at rather than swapping the view. So "Book Pickup" toggles this rather
  // than changing `view`.
  const [bookingOpen, setBookingOpen] = useState(false);
  // Set when a token was rejected mid-session rather than when somebody signed out,
  // so the sign-in screen can explain why they are back on it.
  const [sessionEnded, setSessionEnded] = useState(false);

  // A token expires, and an admin can revoke one. Before this the app carried on
  // rendering as though signed in while every call failed with 401, and only a
  // manual reload got the person back to a sign-in screen. Registered only once
  // signed in: a stale token found at boot is already handled below by falling
  // through to Login, and does not warrant an "your session ended" message to
  // somebody who has not been here in a month.
  useEffect(() => {
    if (!authed) return;
    setSessionExpiredHandler(() => {
      setAuthed(false);
      setNeedsOnboarding(false);
      setBookingOpen(false);
      setNotifOpen(false);
      setNavOpen(false);
      setSessionEnded(true);
    });
    return () => setSessionExpiredHandler(null);
  }, [authed]);

  useEffect(() => {
    const t = getToken();
    if (!t) { setBooted(true); return; }
    api.me()
      .then((m) => {
        // A staff member who still has a token from their own portal is sent there,
        // not shown the resident app.
        if (!m.roles.includes("resident")) { window.location.href = PORTAL_ROUTE[portalFor(m.roles)]; return; }
        setAuthed(true);
        setNeedsOnboarding(m.residentId === null);
      })
      .catch(() => setToken(null))
      .finally(() => setBooted(true));
  }, []);

  if (!booted) return <Splash />;
  if (!authed) return (
    <Login
      sessionEnded={sessionEnded}
      onLogin={(onboard) => { setSessionEnded(false); setAuthed(true); setNeedsOnboarding(onboard); setView("home"); }}
    />
  );
  if (needsOnboarding) return <Registration onDone={() => setNeedsOnboarding(false)} onLogout={async () => { await api.logout(); setToken(null); setAuthed(false); setNeedsOnboarding(false); }} />;

  const logout = async () => { await api.logout(); setToken(null); setAuthed(false); };

  const goto = (v: View) => {
    setNavOpen(false);
    // Book Pickup opens the wizard over the current page; every other destination is
    // a normal view change.
    if (v === "book") { setBookingOpen(true); return; }
    setView(v);
  };

  return (
    <div className="flex min-h-[100dvh]">
      {/* Persistent sidebar on desktop; a slide-in drawer on narrow screens. */}
      <Sidebar view={view} go={goto} open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <ResidentHeader onOpenNav={() => setNavOpen(true)}
          onOpenNotification={(id) => { setTrackId(id); setView("track"); }} notifOpen={notifOpen} setNotifOpen={setNotifOpen} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8">
          {/* popLayout (not "wait"): the entering view mounts immediately and the
              leaving one is popped out of flow, so a view change never stalls waiting
              on an exit animation to complete. */}
          <AnimatePresence mode="popLayout">
            <motion.div key={view + (trackId ?? "") + (serviceId ?? "") + (ticketId ?? "")} initial={fade.initial} animate={fade.animate} exit={fade.exit} transition={{ duration: 0.25 }}>
              {view === "home" && <Home go={goto} onTrack={(id) => { setTrackId(id); setView("track"); }} onShowUpdates={() => setNotifOpen(true)} />}
              {/* Two kinds of booking, two screens. Every card used to call onTrack,
                  so tapping a car wash opened the laundry tracking view and asked the
                  laundry tracking API about an id it had never heard of. */}
              {view === "orders" && (
                <Orders
                  onTrack={(id) => { setTrackId(id); setView("track"); }}
                  onOpenService={(id) => { setServiceId(id); setView("service"); }}
                />
              )}
              {view === "profile" && <Profile go={setView} onLogout={logout} />}
              {view === "wallet" && <WalletView onBack={() => setView("profile")} />}
              {view === "plans" && <Plans onBack={() => setView("profile")} />}
              {view === "track" && trackId && <TrackView orderId={trackId} onBack={() => setView("orders")} />}
              {view === "service" && serviceId && <ServiceDetail requestId={serviceId} onBack={() => setView("orders")} />}
              {view === "support" && <Support onOpen={(id) => { setTicketId(id); setView("ticket"); }} onBack={() => setView("profile")} />}
              {view === "ticket" && ticketId && <TicketDetail ticketId={ticketId} onBack={() => setView("support")} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* The booking wizard sits above every view as a modal overlay (I-82). */}
      {bookingOpen && (
        <BookingWizard
          onClose={() => setBookingOpen(false)}
          onDone={() => { setBookingOpen(false); setView("orders"); }}
        />
      )}
    </div>
  );
}

// The desktop left rail: brand and primary navigation. On desktop it is always
// visible; on smaller screens it slides in from the left over a scrim and closes when
// a destination or the scrim is tapped.
function Sidebar({ view, go, open, onClose }: {
  view: View; go: (v: View) => void; open: boolean; onClose: () => void;
}) {
  // The three things a resident came to do, and the way in to everything else.
  //
  // My Plan, Wallet and Help & Support were top-level entries here as well as cards
  // on Profile, so the rail carried seven destinations to the phone's four and every
  // account service was reachable two ways. They live on Profile now — where the
  // resident's own details already are, and where signing out already was — and the
  // rail says the same four things the tab bar does.
  const items: { id: View; label: string; icon: typeof HomeIcon }[] = [
    { id: "home", label: "Home", icon: HomeIcon },
    { id: "book", label: "Book Pickup", icon: CalendarClock },
    { id: "orders", label: "My Orders", icon: PackageSearch },
    { id: "profile", label: "Profile", icon: UserIcon },
  ];
  // Profile stays lit while the resident is inside one of the services it leads to,
  // so the rail never loses its place. Same rule the tab bar uses.
  const active = (id: View) => view === id
    || (id === "orders" && view === "track")
    || (id === "profile" && (view === "plans" || view === "wallet" || view === "support" || view === "ticket"));

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
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <NotificationBell onOpenNotification={onOpenNotification} open={notifOpen} setOpen={setNotifOpen} />
      </div>
    </header>
  );
}

function Splash() {
  return <div className="grid min-h-[100dvh] place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
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

  // Escape closes it. The dropdown is dismissible by clicking the scrim behind it and
  // by nothing else, which leaves a keyboard user with an open panel and no way to
  // shut it (SC 2.1.2). It is not a modal, so it gets the key without the focus trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <div className="relative">
      <button aria-label="Notifications" aria-expanded={open} onClick={() => setOpen(!open)} className="relative grid size-9 place-items-center rounded-full glass text-muted-foreground hover:text-foreground">
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

// Resident registration (I-75). A new mobile number becomes a resident on first
// verify; this collects their name and places them in an exact flat through dependent
// Society → Tower → Floor → Flat dropdowns backed by the supervisor-configured
// structure (I-74), offering only real, available flats.
function Registration({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const uid = useId();
  const opts = useAsync(() => api.getOnboarding(), []);
  const [fullName, setFullName] = useState("");
  const [societyId, setSocietyId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [floor, setFloor] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const societies = opts.data?.societies ?? [];
  const society = societies.find((s) => s.id === societyId);
  const block = society?.blocks.find((b) => b.id === blockId);
  const floors = block ? [...new Set(block.flats.map((f) => f.floor))].sort((a, b) => a - b) : [];
  const flats = block ? block.flats.filter((f) => String(f.floor) === floor) : [];

  const reset = (level: "society" | "block" | "floor") => {
    if (level === "society") { setBlockId(""); setFloor(""); setUnitNumber(""); }
    if (level === "block") { setFloor(""); setUnitNumber(""); }
    if (level === "floor") { setUnitNumber(""); }
  };

  const valid = fullName.trim().length >= 2 && societyId && blockId && unitNumber;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      // Onboarding reissues the session with the new resident scope; swap to that
      // token so the dashboard call that follows is made as the onboarded resident.
      const r = await api.submitOnboarding({ fullName: fullName.trim(), societyId, blockId, unitNumber });
      if (r.token) setToken(r.token);
      onDone();
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not complete registration"); } finally { setBusy(false); }
  };

  const selectCls = "w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4 py-8">
      <div className="fixed right-4 top-4 z-50"><ThemeToggle /></div>
      <motion.div initial={fade.initial} animate={fade.animate} className="w-full max-w-sm rounded-3xl glass-strong p-7">
        <h1 className="font-display text-2xl font-bold">Welcome — let&apos;s set you up</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tell us where you live so we can collect from the right door.</p>

        {/* The societies, towers and flats are fetched, and until now a failed fetch
            said nothing at all: the three dropdowns simply came up empty and the
            submit button stayed dead, which looks exactly like a resident whose
            society has not been set up yet. Somebody in that position has no reason
            to try again, so they leave. Say what happened, and offer the retry. */}
        {opts.error && (
          <div role="alert" className="mt-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">
            <p>Unable to load onboarding information. Please try again.</p>
            <p className="mt-1 text-xs opacity-80">{opts.error}</p>
            <button type="button" onClick={opts.reload}
              className="mt-3 rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/25">
              Retry
            </button>
          </div>
        )}
        {opts.loading && !opts.error && (
          <p role="status" className="mt-4 text-sm text-muted-foreground">Loading your society&apos;s details…</p>
        )}
        {/* Every label here was a bare <label> with no htmlFor and no id on the field
            it described, so nothing tied the two together: tapping the label did not
            focus the input and a screen reader read the controls unnamed (SC 1.3.1).
            The staff login already does this correctly; this is the same pattern. */}
        <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) submit(); }}>
          <div>
            <label htmlFor={`${uid}-name`} className="block text-xs text-muted-foreground">Full name</label>
            <input id={`${uid}-name`} name="name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name"
              className="mt-1 w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label htmlFor={`${uid}-society`} className="block text-xs text-muted-foreground">Society</label>
            <select id={`${uid}-society`} value={societyId} onChange={(e) => { setSocietyId(e.target.value); reset("society"); }} className={`mt-1 ${selectCls}`}>
              <option value="">Choose your society</option>
              {societies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-tower`} className="block text-xs text-muted-foreground">Tower</label>
            <select id={`${uid}-tower`} value={blockId} disabled={!society} onChange={(e) => { setBlockId(e.target.value); reset("block"); }} className={`mt-1 ${selectCls}`}>
              <option value="">{society ? "Choose your tower" : "Select a society first"}</option>
              {(society?.blocks ?? []).map((b) => <option key={b.id} value={b.id}>Tower {b.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-floor`} className="block text-xs text-muted-foreground">Floor</label>
              <select id={`${uid}-floor`} value={floor} disabled={!block} onChange={(e) => { setFloor(e.target.value); reset("floor"); }} className={`mt-1 ${selectCls}`}>
                <option value="">Floor</option>
                {floors.map((f) => <option key={f} value={String(f)}>Floor {f}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-flat`} className="block text-xs text-muted-foreground">Flat</label>
              <select id={`${uid}-flat`} value={unitNumber} disabled={!floor} onChange={(e) => setUnitNumber(e.target.value)} className={`mt-1 ${selectCls}`}>
                <option value="">Flat</option>
                {flats.map((f) => <option key={f.number} value={f.number}>{f.number}</option>)}
              </select>
            </div>
          </div>
          {block && block.flats.length === 0 && (
            <p role="alert" className="text-xs text-warning">No flats have been configured for this tower yet. Please contact your society supervisor.</p>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={!valid || busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Complete registration"}
          </button>
          <button type="button" onClick={onLogout} className="w-full py-2 text-center text-xs text-muted-foreground hover:text-foreground">Use a different number</button>
        </form>
      </motion.div>
    </div>
  );
}

function Login({ onLogin, sessionEnded }: { onLogin: (needsOnboarding: boolean) => void; sessionEnded?: boolean }) {
  const uid = useId();
  const [phone, setPhone] = useState("9876543210");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seconds left before the server will accept another send. It tells us how long
  // its cooldown is, so the button is never offered while it would be refused.
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.sendOtp(phone);
      setStage("otp");
      setResendIn(r.resendAfterSeconds ?? 30);
      if (r.otpForTesting) { setHint(r.otpForTesting); setOtp(r.otpForTesting); }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not send the code"); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.verifyOtp(phone, otp); setToken(r.token);
      // Role-based redirect (I-75): staff and admins go to their own portal; only a
      // resident stays in the app, going to registration first if they are new.
      if (r.portal !== "resident") { window.location.href = PORTAL_ROUTE[r.portal] ?? "/app"; return; }
      onLogin(r.needsOnboarding);
    }
    catch (e) { setError(e instanceof Error ? e.message : "That code did not work"); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4">
      <div className="fixed right-4 top-4 z-50"><ThemeToggle /></div>
      <motion.div initial={fade.initial} animate={fade.animate} className="w-full max-w-sm rounded-3xl glass-strong p-7">
        <h1 className="font-display text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to book laundry, ironing, dry clean, or a car wash.</p>
        {sessionEnded && (
          <p role="status" className="mt-4 rounded-xl bg-warning/10 p-3 text-sm text-warning">
            Your session ended, so we signed you out. Sign in again to pick up where you left off.
          </p>
        )}
        {/* A real <form>, so Enter submits. Both steps were bare inputs and a button:
            typing a number and pressing Enter did nothing at all. */}
        {stage === "phone" ? (
          <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && isPhone(phone)) send(); }}>
            <label htmlFor={`${uid}-phone`} className="block text-xs text-muted-foreground">Mobile number</label>
            {/* Digits only, and a real mobile number before the code is sent. The gate
                was `busy` alone, so "1234567890" cost a round trip to find out. */}
            <input id={`${uid}-phone`} name="phone" autoComplete="tel-national"
              value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} inputMode="tel" maxLength={10}
              aria-invalid={Boolean(phoneProblem(phone))} aria-describedby={phoneProblem(phone) ? `${uid}-phone-error` : undefined}
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-ring" />
            {phoneProblem(phone) && <p id={`${uid}-phone-error`} className="text-xs text-danger">{phoneProblem(phone)}</p>}
            <button type="submit" disabled={busy || !isPhone(phone)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy) verify(); }}>
            <label htmlFor={`${uid}-otp`} className="block text-xs text-muted-foreground">Enter the 6 digit code</label>
            {/* Digits only. `inputMode` asks a phone for a number pad; it does not stop
                a paste or a desktop keyboard, so "abc123" went to the server as typed. */}
            <input id={`${uid}-otp`} name="one-time-code" autoComplete="one-time-code"
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={6}
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-ring" />
            {hint && <p className="text-xs text-accent">Demo code: {hint}</p>}
            <button type="submit" disabled={busy || otp.length < 6} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Verify and continue"}
            </button>
            {/* An SMS that never arrives is the commonest way to be stuck here, and a
                mistyped number is the second. The screen offered neither way out: no
                resend, and no way back to the number without reloading the page. */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <button type="button" onClick={() => { setStage("phone"); setOtp(""); setHint(null); setError(null); setResendIn(0); }}
                className="text-xs text-muted-foreground hover:text-foreground">
                Use a different number
              </button>
              <button type="button" onClick={send} disabled={busy || resendIn > 0}
                className="text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
        {/* role="alert" so the failure is announced. Every error in this app was a
            silently-appearing paragraph — visible, and invisible to a screen reader
            (SC 4.1.3). */}
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
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
  if (error) return <div role="alert" className="rounded-2xl glass p-6 text-sm text-danger">{error}</div>;
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

// I-80: the resident Order Progress is a compact horizontal stepper driven by the
// real order state. Booked → Pickup → Processing → Ready → Delivered; the internal
// operator stages (washing/ironing/qc…) collapse into Processing, out-for-delivery
// into Ready. Completed and current steps take the primary accent; upcoming steps
// stay subtle. No glow, no gradients, no oversized elements.
const PROGRESS_STAGES = ["Booked", "Pickup", "Processing", "Ready", "Delivered"] as const;
function orderStageIndex(state: string): number {
  switch (state) {
    case "scheduled": return 0;
    case "picked_up": return 1;
    case "in_wash": case "washing": case "ironing":
    case "qc": case "qc_hold": case "qc_failed": case "disputed": return 2;
    case "ready_for_delivery": case "out_for_delivery": return 3;
    case "delivered": return 4;
    default: return 0;
  }
}
const STAGE_CAPTION = [
  "Your pickup is booked.",
  "Your laundry has been collected.",
  "Your laundry is being processed.",
  "Your laundry is ready for delivery.",
  "Your laundry has been delivered.",
];
function OrderProgress({ state }: { state: string }) {
  const current = orderStageIndex(state);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">Order Progress</h3>
      <div className="rounded-2xl glass p-4">
        <ol className="flex items-center">
          {PROGRESS_STAGES.map((label, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={label} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold tabular-nums transition-colors",
                      done && "border-primary bg-primary text-primary-foreground",
                      active && "border-primary bg-primary/15 text-primary ring-2 ring-primary/30",
                      !done && !active && "border-border bg-transparent text-muted-foreground/60",
                    )}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className={cn("whitespace-nowrap text-[10.5px] font-medium sm:text-xs", (done || active) ? "text-foreground" : "text-muted-foreground/60")}>{label}</span>
                </div>
                {i < PROGRESS_STAGES.length - 1 && (
                  <span className={cn("mx-1 mb-4 h-0.5 flex-1 rounded-full transition-colors sm:mx-2", i < current ? "bg-primary" : "bg-border")} />
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">{STAGE_CAPTION[current]}</p>
      </div>
    </section>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// The resident dashboard (I-80/I-85): a clean, minimal, backend-driven overview
// focused on the current order, its progress, the plan, and recent updates. The
// Schedule Pickup CTA, Additional Services block, and any Wallet / Help shortcut
// cards are intentionally absent — Book Pickup lives in the nav, and Plan/Wallet/
// Help are reached through the nav and Profile.
function Home({ go, onTrack, onShowUpdates }: { go: (v: View) => void; onTrack: (id: string) => void; onShowUpdates: () => void }) {
  const { data, loading, error } = useAsync<Dashboard>(() => api.dashboard(), []);
  const sub = data?.subscription ?? null;

  // The one order the resident is actively following — a live order if there is
  // one, otherwise the next upcoming pickup. Its state drives Order Progress, and
  // it is the single source of pickup information so nothing is repeated below.
  const currentOrder = data?.currentOrder ?? null;
  const upcoming = data?.upcomingPickup ?? null;
  const upcomingOrderId = upcoming?.orderId ?? data?.upcomingOrders?.[0]?.id ?? null;

  const used = sub ? Math.max(0, sub.allowance - sub.remaining) : 0;

  return (
    <Panel loading={loading} error={error}>
      {data && (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold">{greeting()}, {data.residentName ?? "there"} <span aria-hidden>👋</span></h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Here&apos;s what&apos;s happening with your laundry.</p>
          </div>

          {/* Current Order — the primary, single source of order information */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Current Order</h3>
            {currentOrder ? (
              <button onClick={() => onTrack(currentOrder.id)} className="flex w-full items-start gap-3 rounded-2xl glass p-4 text-left">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold">{currentOrder.orderCode ?? "Laundry order"}</p>
                  {(currentOrder.scheduledPickupAt || upcoming?.date) && (
                    <p className="text-xs text-muted-foreground">
                      Pickup {fmtDate(currentOrder.scheduledPickupAt ?? upcoming?.date)}
                      {upcoming?.window ? ` · ${upcoming.window}${upcoming.startTime ? ` ${upcoming.startTime}–${upcoming.endTime}` : ""}` : ""}
                    </p>
                  )}
                  {currentOrder.acceptedCount != null && <p className="text-xs text-muted-foreground">{currentOrder.acceptedCount} garments collected</p>}
                  <p className="pt-0.5 text-xs font-medium text-primary">View Order ›</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${stateTone(currentOrder.state)}`}>{dashStatus(currentOrder.state)}</span>
              </button>
            ) : upcomingOrderId ? (
              <button onClick={() => onTrack(upcomingOrderId)} className="flex w-full items-start gap-3 rounded-2xl glass p-4 text-left">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold">{upcoming?.orderCode ?? data.upcomingOrders[0]?.orderCode ?? "Pickup"}</p>
                  <p className="text-xs text-muted-foreground">
                    Pickup {fmtDate(upcoming?.date ?? data.upcomingOrders[0]?.scheduledPickupAt)}{upcoming?.window ? ` · ${upcoming.window}${upcoming.startTime ? ` ${upcoming.startTime}–${upcoming.endTime}` : ""}` : ""}
                  </p>
                  <p className="pt-0.5 text-xs font-medium text-primary">View Order ›</p>
                </div>
                <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning">Scheduled</span>
              </button>
            ) : (
              <div className="rounded-2xl glass p-5 text-center text-sm text-muted-foreground">
                No active orders. Book a pickup from the navigation to get started.
              </div>
            )}
          </section>

          {/* Order Progress — only while an order is in flight */}
          {(currentOrder || upcomingOrderId) && (
            <OrderProgress state={currentOrder?.state ?? "scheduled"} />
          )}

          {/* Your Plan — simplified, text-only usage, manage through the plan page */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">Your Plan</h3>
              {sub && <button onClick={() => go("plans")} className="text-xs font-medium text-primary">Manage Plan ›</button>}
            </div>
            <button onClick={() => go("plans")} className="w-full rounded-2xl glass p-4 text-left">
              {sub ? (
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold">{sub.planTier}</p>
                    <p className="text-xs text-muted-foreground">{rupees(sub.monthlyPaise)} / month</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{used} / {sub.allowance} garments used</p>
                  <p className="text-xs text-muted-foreground">{sub.remaining} garments remaining</p>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">No active plan</p>
                  <span className="text-xs font-medium text-primary">Choose a plan ›</span>
                </div>
              )}
            </button>
          </section>

          {/* Recent Updates — compact; communicates the event only, not order detail */}
          {data.notifications.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground">Recent Updates{data.unreadNotifications > 0 ? ` · ${data.unreadNotifications} new` : ""}</h3>
                <button onClick={onShowUpdates} className="text-xs font-medium text-primary">View All ›</button>
              </div>
              <div className="divide-y divide-border/60 overflow-hidden rounded-2xl glass">
                {data.notifications.slice(0, 3).map((n) => (
                  <div key={n.id} className="flex items-start gap-2.5 p-3">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.body}</p>
                    </div>
                    <p className="shrink-0 text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}

// I-82: the resident's booking is one clean centered wizard — a laundry pickup, an
// additional service, or both together — over a dimmed, non-interactive background
// with the page behind it locked. The steps adapt to the choice: choose → (laundry
// schedule) → (service schedule) → review → success. The success screen replaces the
// wizard rather than stacking on it. Slots inside the two-hour cutoff are refused by
// the backend, so they are never offered here.
function BookingWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const minDate = today();
  const offeringsQ = useAsync(() => api.serviceOfferings().catch(() => ({ offerings: [] as ServiceOfferingItem[] })), []);
  const offerings = (offeringsQ.data?.offerings ?? []).filter((o) => o.isActive !== false);

  const [wantLaundry, setWantLaundry] = useState(true);
  const [service, setService] = useState<ServiceOfferingItem | null>(null);
  const [lDate, setLDate] = useState(minDate);
  const [lSlot, setLSlot] = useState<string | null>(null);
  const [sDate, setSDate] = useState(minDate);
  const [sSlot, setSSlot] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A booking of laundry and a service is two requests, so it can half succeed. When
  // it does, `serviceError` says why the service did not go through while `laundry`
  // still carries the pickup that did.
  const [done, setDone] = useState<{ laundry: string | null; service: string | null; failedService?: string | null; serviceError?: string | null } | null>(null);

  // Escape, a focus trap, focus restoration and the body scroll lock. The wizard had
  // only the scroll lock, so a keyboard user could tab straight out of it into the
  // page underneath with no way back.
  const panelRef = useDialog(done ? onDone : onClose);

  // I-17: what the plan still covers, at the moment the resident is deciding whether
  // to book. Home and the Plan page both show it, but the wizard — the one screen
  // where "will this cost me anything?" is the live question — showed nothing.
  const subQ = useAsync(() => api.residentSubscription().catch(() => null), []);
  const plan = subQ.data?.current ?? null;

  const lSlotsQ = useAsync<{ slots: Slot[] }>(() => (wantLaundry ? api.slots(lDate) : Promise.resolve({ slots: [] })), [wantLaundry, lDate]);
  const sSlotsQ = useAsync<{ slots: ServiceDateSlot[] }>(() => (service ? api.serviceDateSlots(service.id, sDate) : Promise.resolve({ slots: [] })), [service?.id ?? "", sDate]);

  // The ordered steps for the current selection, so "Step X of N" and Back/Continue
  // always match what was actually chosen.
  const flow = ["choose", ...(wantLaundry ? ["laundry"] : []), ...(service ? ["service"] : []), "review"];
  const stepKey = flow[Math.min(step, flow.length - 1)];
  const isReview = stepKey === "review";

  const sQuoteQ = useAsync<{ quote: Record<string, unknown> } | null>(
    () => (service && isReview ? api.serviceQuote(service.id, sDate).catch(() => null) : Promise.resolve(null)),
    [service?.id ?? "", sDate, isReview]);
  const quote = sQuoteQ.data?.quote as { totalPaise?: number; planMode?: string } | undefined;
  const servicePrice = quote?.totalPaise ?? (service ? offeringPrice(service) : 0);

  const lChosen = (lSlotsQ.data?.slots ?? []).find((s) => s.id === lSlot) ?? null;
  const sChosen = (sSlotsQ.data?.slots ?? []).find((s) => s.id === sSlot) ?? null;

  const canContinue =
    stepKey === "choose" ? (wantLaundry || !!service)
      : stepKey === "laundry" ? !!lSlot
        : stepKey === "service" ? !!sSlot
          : true;

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      // Laundry first, then the service. Each is saved the moment it succeeds, so a
      // failure on the second does not undo the first.
      let laundryRef: string | null = null;
      if (wantLaundry && lSlot) {
        try {
          const r = await api.bookPickup(lSlot);
          laundryRef = r.order.orderCode ?? "Pickup booked";
        } catch (e) {
          // Nothing has been booked yet, so this is an ordinary failure.
          setError(e instanceof ApiError && e.status === 409 ? "A slot just filled up — go back and choose another." : (e instanceof Error ? e.message : "Booking failed"));
          return;
        }
      }
      let serviceRef: string | null = null;
      let serviceError: string | null = null;
      if (service && sSlot) {
        try {
          await api.bookServiceSlot({ serviceSlotId: sSlot });
          serviceRef = service.name;
        } catch (e) {
          const reason = e instanceof Error ? e.message : "It could not be booked.";
          if (!laundryRef) { setError(reason); return; }
          // ST1-I097. The pickup already exists. Showing only an error here told the
          // resident nothing had happened, so they pressed Confirm again and got a
          // second laundry pickup. Say exactly what went through and what did not.
          serviceError = reason;
        }
      }
      setDone({ laundry: laundryRef, service: serviceRef, failedService: serviceError ? service?.name ?? "The service" : null, serviceError });
    } finally { setBusy(false); }
  };

  const back = () => setStep((s) => Math.max(0, s - 1));
  const cont = () => (isReview ? confirm() : setStep((s) => Math.min(flow.length - 1, s + 1)));

  const slotLabel = (s: { window: string; startTime: string; endTime: string } | null) =>
    s ? `${s.window} · ${s.startTime}–${s.endTime}` : "—";

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <button aria-hidden tabIndex={-1} className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={done ? onDone : onClose} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="booking-wizard-title"
        className="relative z-10 flex max-h-[88vh] w-[min(94vw,30rem)] flex-col rounded-3xl glass-strong outline-none">
        <div className="flex items-start justify-between gap-3 p-6 pb-3">
          <div>
            <h3 id="booking-wizard-title" className="font-display text-lg font-bold">{done ? (done.serviceError ? "Partly booked" : "Booking confirmed") : "Book"}</h3>
            {!done && <p className="text-xs text-muted-foreground">Step {Math.min(step + 1, flow.length)} of {flow.length}</p>}
          </div>
          <button onClick={done ? onDone : onClose} aria-label="Close" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/10 hover:text-foreground"><XIcon className="size-4" /></button>
        </div>

        <div className="overflow-y-auto px-6 pb-6">
          {done ? (
            <div className="space-y-4 text-center">
              {done.serviceError ? (
                <>
                  <div className="mx-auto grid size-12 place-items-center rounded-full bg-warning/15 text-warning"><AlertTriangle className="size-6" /></div>
                  <p role="status" className="text-sm text-muted-foreground">Part of your booking went through. Your laundry pickup is booked; {done.failedService} is not.</p>
                </>
              ) : (
                <>
                  <div className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-success"><CheckCircle2 className="size-6" /></div>
                  <p className="text-sm text-muted-foreground">Your booking has been confirmed.</p>
                </>
              )}
              <div className="space-y-2 text-left">
                {done.laundry && (
                  <div className="rounded-2xl glass p-4">
                    <p className="text-sm font-semibold">Laundry Pickup</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{done.laundry} · {lDate} · {slotLabel(lChosen)}</p>
                  </div>
                )}
                {done.service && (
                  <div className="rounded-2xl glass p-4">
                    <p className="text-sm font-semibold">{done.service}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{sDate} · {slotLabel(sChosen)}</p>
                  </div>
                )}
                {done.serviceError && (
                  <div className="rounded-2xl border border-danger/30 p-4">
                    <p className="text-sm font-semibold">{done.failedService} — not booked</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{done.serviceError} Your laundry pickup stays booked, so book this again on its own from Book Pickup.</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onDone} className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow">View My Orders</button>
                <button onClick={onClose} className="flex-1 rounded-xl glass py-3 text-sm font-medium">Done</button>
              </div>
            </div>
          ) : stepKey === "choose" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">What would you like to book? You can book a laundry pickup, an additional service, or both.</p>
              <AllowanceNote plan={plan} loading={subQ.loading} />
              <button
                onClick={() => setWantLaundry((v) => !v)}
                className={cn("flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left transition", wantLaundry ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40")}
              >
                <span>
                  <span className="block text-sm font-semibold">Laundry Pickup</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">We collect and return your clothes. Priced at collection.</span>
                </span>
                {wantLaundry && <Check className="size-5 shrink-0 text-primary" />}
              </button>

              {offerings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Additional Services</p>
                  {offerings.map((o) => {
                    const on = service?.id === o.id;
                    return (
                      <button key={o.id} onClick={() => setService((cur) => (cur?.id === o.id ? null : o))}
                        className={cn("flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left transition", on ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40")}>
                        <span>
                          <span className="block text-sm font-semibold">{o.name}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">from {rupees(offeringPrice(o))} / {o.unit ?? "job"}</span>
                        </span>
                        {on && <Check className="size-5 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : stepKey === "laundry" ? (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Pickup day</p>
                <DatePicker value={lDate} min={minDate} clearable={false} ariaLabel="Choose a pickup day"
                  onChange={(v) => { setLDate(v ?? minDate); setLSlot(null); }} className="w-full" />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Available slots</p>
                <Panel loading={lSlotsQ.loading} error={lSlotsQ.error}>
                  {(lSlotsQ.data?.slots ?? []).length === 0 ? (
                    <p className="rounded-2xl glass p-4 text-sm text-muted-foreground">No slots available for this day. Slots close two hours before pickup — try another day.</p>
                  ) : (
                    /* Picking one of several is a radio group, not a row of unrelated
                       buttons: without aria-checked a screen reader announces every
                       slot identically and never says which one is chosen (SC 4.1.2). */
                    <div role="radiogroup" aria-label="Available pickup slots" className="grid grid-cols-3 gap-2">
                      {(lSlotsQ.data?.slots ?? []).map((s) => (
                        <button key={s.id} type="button" role="radio" aria-checked={lSlot === s.id} onClick={() => setLSlot(s.id)}
                          className={cn("rounded-xl p-3 text-center transition focus-visible:ring-focus", lSlot === s.id ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40")}>
                          <span className="block text-sm font-medium">{s.window}</span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{s.startTime}–{s.endTime}</span>
                          {typeof s.capacityRemaining === "number" && <span className="mt-0.5 block text-[11px] font-medium text-primary">{s.capacityRemaining} left</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            </div>
          ) : stepKey === "service" ? (
            <div className="space-y-4">
              <p className="text-sm font-semibold">{service?.name}</p>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Service day</p>
                <DatePicker value={sDate} min={minDate} clearable={false} ariaLabel="Choose a service day"
                  onChange={(v) => { setSDate(v ?? minDate); setSSlot(null); }} className="w-full" />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Available slots</p>
                <Panel loading={sSlotsQ.loading} error={sSlotsQ.error}>
                  {(sSlotsQ.data?.slots ?? []).length === 0 ? (
                    <p className="rounded-2xl glass p-4 text-sm text-muted-foreground">No slots offered for {service?.name} on this day. Try another day.</p>
                  ) : (
                    <div role="radiogroup" aria-label={`Available slots for ${service?.name ?? "this service"}`} className="grid grid-cols-3 gap-2">
                      {(sSlotsQ.data?.slots ?? []).map((s) => (
                        <button key={s.id} type="button" role="radio" aria-checked={sSlot === s.id} disabled={s.full} onClick={() => setSSlot(s.id)}
                          className={cn("rounded-xl p-3 text-center transition", s.full ? "cursor-not-allowed bg-foreground/5 text-muted-foreground" : sSlot === s.id ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40")}>
                          <span className="block text-sm font-medium">{s.window}</span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{s.full ? "Full" : `${s.capacityRemaining} left`}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm font-semibold">Booking summary</p>
              {wantLaundry && <AllowanceNote plan={plan} loading={subQ.loading} />}
              <div className="space-y-1.5 rounded-2xl glass p-4 text-sm">
                {wantLaundry && (
                  <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-2">
                    <div>
                      <p className="font-medium">Laundry Pickup</p>
                      <p className="text-xs text-muted-foreground">{lDate} · {slotLabel(lChosen)}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">Priced at collection</span>
                  </div>
                )}
                {service && (
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <p className="font-medium">{service.name}</p>
                      <p className="text-xs text-muted-foreground">{sDate} · {slotLabel(sChosen)}</p>
                    </div>
                    {/* Not "₹0". A slot booking records no hours or quantity up
                        front — the operator counts at the door, exactly as laundry
                        does — so a zero here means "not priced yet", and printing it
                        as a rupee figure told the resident the work was free. */}
                    <span className="font-medium">{sQuoteQ.loading ? "…" : servicePriceLabel({ quotedPaise: servicePrice })}</span>
                  </div>
                )}
                {service && (
                  <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border/50 pt-2 font-semibold">
                    <span>Total now</span>
                    <span className="font-display">{servicePrice > 0 ? rupees(servicePrice) : "—"}</span>
                  </div>
                )}
                {quote?.planMode && <p className="text-xs text-muted-foreground">{quote.planMode === "included" ? "Included with your plan" : quote.planMode === "covered" ? "Covered by your plan" : "Chargeable"}</p>}
              </div>
            </div>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </div>

        {!done && (
          <div className="flex gap-2 border-t border-border/50 p-4">
            {step > 0 ? (
              <button onClick={back} disabled={busy} className="flex-1 rounded-xl glass py-3 text-sm font-medium disabled:opacity-50">Back</button>
            ) : (
              <button onClick={onClose} className="flex-1 rounded-xl glass py-3 text-sm font-medium">Cancel</button>
            )}
            <button onClick={cont} disabled={!canContinue || busy}
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
              {busy ? <Loader2 className="mx-auto size-4 animate-spin" /> : isReview ? "Confirm Booking" : "Continue"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// What booking this pickup will draw on, said before it is booked.
//
// A laundry pickup has no price at booking time — the operator counts the garments at
// the door and the plan absorbs them until the allowance runs out. So the honest
// answer to "will this cost me anything?" is the allowance still standing, and it
// belongs here rather than only on Home and the Plan page, which is where it was.
function AllowanceNote({ plan, loading }: { plan: SubscriptionUsage | null; loading: boolean }) {
  if (loading) return null;

  if (!plan) {
    return (
      <p className="rounded-2xl bg-warning/10 p-3 text-xs text-warning">
        You have no active plan, so this pickup is charged per garment at collection.
      </p>
    );
  }

  const exhausted = plan.remaining <= 0;
  return (
    <p className={cn("rounded-2xl p-3 text-xs", exhausted ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary")}>
      {exhausted
        ? `Your ${plan.planName ?? plan.planTier} allowance of ${plan.allowance} garments is used up for this cycle. Anything collected now is charged per garment.`
        : `${plan.remaining} of ${plan.allowance} garments left on ${plan.planName ?? plan.planTier} this cycle. Garments beyond that are charged per garment at collection.`}
    </p>
  );
}

// The offerings endpoint returns the raw offering, so its price lives under one of a
// couple of field names depending on how it was created — read whichever is present.
// Used by the booking wizard to show "from ₹X" beside each additional service.
function offeringPrice(o: ServiceOfferingItem): number {
  const n = o.nonSubscriberPricePaise ?? (o.unitPricePaise as number) ?? (o.pricePaise as number);
  return Number.isFinite(n) ? n : 0;
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

function Orders({ onTrack, onOpenService }: { onTrack: (id: string) => void; onOpenService: (id: string) => void }) {
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
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by Order ID" aria-label="Search orders by order ID" className="w-full bg-transparent py-2.5 text-sm outline-none" />
      </div>

      {/* Both rows were plain buttons: nothing told assistive tech that they are a
          set, or which member of it is showing. Same pattern the mobile app uses. */}
      <div role="tablist" aria-label="Order status" className="mb-3 flex gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}
            className={`flex-1 rounded-xl py-2 text-sm font-medium focus-visible:ring-focus ${tab === t.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "glass text-muted-foreground"}`}>
            {t.label} <span className="text-xs opacity-70">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div role="tablist" aria-label="Order type" className="mb-4 flex gap-1.5">
        {kinds.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} tabIndex={kind === k.id ? 0 : -1} onClick={() => setKind(k.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium focus-visible:ring-focus ${kind === k.id ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
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
          {shown.map((c) => (
            <OrderCardRow key={`${c.kind}-${c.id}`} c={c}
              onClick={() => (c.kind === "additional" ? onOpenService(c.id) : onTrack(c.id))} />
          ))}
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

// What an additional-service booking costs, said honestly.
//
// A slot booking records no hours or quantity up front — the operator counts at the
// door, exactly as a laundry pickup does — so the quote is zero until they have been.
// The screens printed that as "₹0", which reads as free. Laundry has always said
// "Priced at collection" in the same situation; this says the same thing.
function servicePriceLabel(request: { payablePaise?: number; quotedPaise?: number }): string {
  const paise = request.payablePaise ?? request.quotedPaise ?? 0;
  return paise > 0 ? rupees(paise) : "Priced when the operator arrives";
}

function serviceWhenLabel(request: Record<string, unknown>): string {
  const when = (request.date ?? request.scheduledFor) as string | undefined;
  const slot = (request.slot ?? request.window) as string | undefined;
  if (!when) return slot ?? "Not scheduled";
  const day = new Date(when).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return [day, slot].filter(Boolean).join(" · ");
}

// An additional-service booking, on its own screen.
//
// There was no such screen. "View Details" on a car wash opened TrackView — the
// laundry tracking view — which then asked the laundry tracking API about a service
// request id it has never heard of. Cancel and reschedule, which the backend has
// supported all along at /v1/services/requests/:id/{cancel,reschedule}, were reachable
// from nowhere: a resident who booked the wrong day could only ring support.
function ServiceDetail({ requestId, onBack }: { requestId: string; onBack: () => void }) {
  const list = useAsync(() => api.serviceRequests(), [requestId]);
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [day, setDay] = useState(today());
  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const request = (list.data?.requests ?? []).find((r) => r.id === requestId) ?? null;
  const offeringId = typeof request?.offeringId === "string" ? request.offeringId : null;
  // Only a booking nobody has started on can be moved or given up; once an operator
  // is on the way, changing it is a conversation rather than a button.
  const changeable = Boolean(request && /^(requested|assigned)$/i.test(String(request.status)));

  const slots = useAsync(
    () => (rescheduling && offeringId ? api.serviceDateSlots(offeringId, day) : Promise.resolve({ slots: [] })),
    [rescheduling, offeringId, day],
  );

  const act = async (run: () => Promise<unknown>, done: string) => {
    setActing(true); setActionError(null);
    try {
      await run();
      setNotice(done);
      setRescheduling(false); setConfirmingCancel(false); setChosenSlot(null); setReason("");
      list.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That did not work.");
    } finally { setActing(false); }
  };

  return (
    <Panel loading={list.loading} error={list.error}>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-primary">
        <ArrowLeft className="size-4" /> Orders
      </button>
      {!request ? (
        <div role="alert" className="rounded-2xl glass p-6 text-sm text-danger">
          We could not find that booking. It may have been cancelled.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl glass p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold">
                  {String(request.offeringName ?? request.serviceName ?? "Additional service")}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {String(request.code ?? request.orderCode ?? requestId.slice(0, 8))}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${stateTone(String(request.status))}`}>
                {String(request.statusLabel ?? prettyState(String(request.status)))}
              </span>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">When</dt>
                <dd className="text-right">{serviceWhenLabel(request)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Price</dt>
                <dd className="text-right">{servicePriceLabel(request)}</dd>
              </div>
            </dl>
          </div>

          {notice && <p role="status" className="rounded-xl bg-primary/10 p-3 text-sm text-primary">{notice}</p>}
          {actionError && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{actionError}</p>}

          {changeable && !rescheduling && !confirmingCancel && (
            <div className="flex gap-2">
              <button onClick={() => { setRescheduling(true); setNotice(null); setActionError(null); }}
                className="flex-1 rounded-xl glass py-2.5 text-sm font-semibold">Reschedule booking</button>
              <button onClick={() => { setConfirmingCancel(true); setNotice(null); setActionError(null); }}
                className="flex-1 rounded-xl bg-danger/10 py-2.5 text-sm font-semibold text-danger">Cancel booking</button>
            </div>
          )}

          {rescheduling && (
            <div className="rounded-2xl glass p-5">
              <h3 className="text-sm font-semibold">Pick another slot</h3>
              <div className="mt-3">
                <DatePicker value={day} min={today()} clearable={false} ariaLabel="Choose a service day"
                  onChange={(v) => { setDay(v ?? today()); setChosenSlot(null); }} className="w-full" />
              </div>
              <Panel loading={slots.loading} error={slots.error}>
                {(slots.data?.slots ?? []).length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No slots offered for this service on that day. Try another day.
                  </p>
                ) : (
                  <div role="radiogroup" aria-label="Available service slots" className="mt-3 space-y-2">
                    {(slots.data?.slots ?? []).map((sl) => (
                      <button key={sl.id} role="radio" aria-checked={chosenSlot === sl.id} disabled={sl.full}
                        onClick={() => setChosenSlot(sl.id)}
                        className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm disabled:opacity-40 ${chosenSlot === sl.id ? "border-primary bg-primary/10" : "border-border"}`}>
                        <span>{sl.window}</span>
                        <span className="text-xs text-muted-foreground">{sl.startTime}–{sl.endTime} · {sl.capacityRemaining} left</span>
                      </button>
                    ))}
                  </div>
                )}
              </Panel>
              <div className="mt-4 flex gap-2">
                <button onClick={() => { setRescheduling(false); setChosenSlot(null); }}
                  className="flex-1 rounded-xl glass py-2.5 text-sm">Never mind</button>
                <button disabled={!chosenSlot || acting}
                  onClick={() => {
                    const slot = (slots.data?.slots ?? []).find((sl) => sl.id === chosenSlot);
                    if (!slot) return undefined;
                    // The chosen slot's own date and start time, which is the shape
                    // booking sends — so the server re-checks a real slot rather than
                    // trusting a time typed on this screen.
                    return act(
                      () => api.rescheduleServiceRequest(requestId, `${day}T${slot.startTime}:00`),
                      "Moved to the new slot.",
                    );
                  }}
                  className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  Confirm new slot
                </button>
              </div>
            </div>
          )}

          {confirmingCancel && (
            <div className="rounded-2xl border border-danger/25 p-5">
              <h3 className="text-sm font-semibold text-danger">Cancel this booking?</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                The operator will be told not to come. Any cancellation rule for this service is applied when
                you confirm, and the result is shown here.
              </p>
              <label htmlFor="service-cancel-reason" className="mt-3 block text-xs text-muted-foreground">
                Why are you cancelling?
              </label>
              <input id="service-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm" />
              <div className="mt-4 flex gap-2">
                <button onClick={() => setConfirmingCancel(false)} className="flex-1 rounded-xl glass py-2.5 text-sm">
                  Keep it
                </button>
                {/* The API requires a reason, so this asks for one rather than sending
                    a request that could only come back refused. */}
                <button disabled={!reason.trim() || acting}
                  onClick={() => act(() => api.cancelServiceRequest(requestId, reason.trim()), "Cancelled.")}
                  className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  Cancel booking
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

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

            {notice && <p role="status" className="mt-5 rounded-xl bg-primary/10 p-3 text-sm text-primary">{notice}</p>}
            {actionError && <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p>}

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
          <div role="radiogroup" aria-label="New pickup slot" className="grid grid-cols-3 gap-2">
            {(slotsQ.data?.slots ?? []).map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={slotId === s.id} onClick={() => setSlotId(s.id)}
                className={`rounded-xl p-2.5 text-left text-xs transition ${slotId === s.id ? "bg-primary/15 ring-1 ring-primary" : "glass-strong hover:ring-1 hover:ring-primary/40"}`}>
                <p className="font-semibold">{s.window}</p>
                <p className="text-muted-foreground">{s.startTime}</p>
              </button>
            ))}
          </div>
        )}
      </Panel>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
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
  const [deleting, setDeleting] = useState(false);

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

        {/* Apple 5.1.1(v): an app that creates an account must let the person delete
            it from inside the app, not only sign out of it. Google Play wants the
            same plus a public page describing it, which is /account/delete. Sign Out
            was the only way out of this account anywhere in the product. */}
        <section className="rounded-2xl border border-danger/25 p-4">
          <h3 className="text-sm font-semibold text-danger">Delete Account</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Closes your account and erases your personal data. Orders and invoices are kept for as
            long as tax law requires. This cannot be undone.
          </p>
          <button onClick={() => setDeleting(true)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-danger/10 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/15">
            <Trash2 className="size-4" /> Delete Account
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            <Link href="/account/delete" className="text-primary hover:underline">What happens to my data?</Link>
          </p>
        </section>
      </div>

      {editing && profile && <EditProfileModal profile={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {confirmOut && <SignOutDialog onClose={() => setConfirmOut(false)} onConfirm={onLogout} />}
      {deleting && <DeleteAccountDialog onClose={() => setDeleting(false)} onDeleted={onLogout} />}
    </Panel>
  );
}

function SignOutDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const panelRef = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <button aria-hidden tabIndex={-1} className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="signout-title"
        className="relative z-10 w-[min(92vw,22rem)] rounded-3xl glass-strong p-6 outline-none">
        <h3 id="signout-title" className="font-display text-lg font-bold">Sign out?</h3>
        <p className="mt-1 text-sm text-muted-foreground">You&apos;ll need your mobile number to sign back in.</p>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
          <button onClick={onConfirm} className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-white">Sign Out</button>
        </div>
      </div>
    </div>
  );
}

// Deleting an account is irreversible and takes a resident's history with it, so it
// asks for the word to be typed rather than for one more tap on a red button: a
// confirmation somebody can give by accident is not a confirmation.
const DELETE_CONFIRMATION = "DELETE";

function DeleteAccountDialog({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const uid = useId();
  const panelRef = useDialog(onClose);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"deleted" | "requested" | null>(null);

  const confirmed = typed.trim().toUpperCase() === DELETE_CONFIRMATION;

  const submit = async () => {
    if (!confirmed || busy) return;
    setBusy(true); setError(null);
    try { setOutcome(await deleteAccount(reason.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not delete the account"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <button aria-hidden tabIndex={-1} className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="delete-account-title"
        className="relative z-10 max-h-[88vh] w-[min(92vw,26rem)] overflow-y-auto rounded-3xl glass-strong p-6 outline-none">
        <h3 id="delete-account-title" className="flex items-center gap-2 font-display text-lg font-bold text-danger">
          <AlertTriangle className="size-5" /> Delete your account?
        </h3>

        {outcome ? (
          <>
            {/* Two different true statements. The app must not claim the account is
                gone when what actually happened is that the request was filed. */}
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {outcome === "deleted"
                ? "Your account has been deleted. You will be signed out now."
                : "Your deletion request has been recorded as a support ticket and our team will complete it. We acknowledge it within 48 hours. You will be signed out now."}
            </p>
            <button onClick={onDeleted} className="mt-5 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">Sign out</button>
          </>
        ) : (
          <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <p className="text-sm text-muted-foreground">
              This erases your name, contact details, residence, support conversations and
              notification settings. Orders and invoices are kept for as long as tax law requires.
              It cannot be undone.
            </p>
            <p className="rounded-xl bg-warning/10 p-3 text-xs text-warning">
              If you hold a wallet balance or an active subscription, cancel the subscription and
              contact support to get the balance back <em>before</em> deleting — deletion does not
              refund anything by itself.
            </p>
            <div>
              <label htmlFor={`${uid}-reason`} className="mb-1 block text-xs font-medium text-muted-foreground">Why are you leaving? (optional)</label>
              <input id={`${uid}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label htmlFor={`${uid}-confirm`} className="mb-1 block text-xs font-medium text-muted-foreground">
                Type {DELETE_CONFIRMATION} to confirm
              </label>
              <input id={`${uid}-confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                className="w-full rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm tracking-widest outline-none focus:ring-2 focus:ring-ring" />
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Keep my account</button>
              <button type="submit" disabled={!confirmed || busy}
                className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? <Loader2 className="mx-auto size-4 animate-spin" /> : "Delete Account"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function EditProfileModal({ profile, onClose, onSaved }: { profile: ResidentProfile; onClose: () => void; onSaved: () => void }) {
  const uid = useId();
  const panelRef = useDialog(onClose);
  const [fullName, setFullName] = useState(profile.fullName ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The field the report was about. It was a bare type="email" outside any form, so
  // the browser never validated it and nothing else did either — the address went to
  // the API and came back rejected.
  const emailError = emailProblem(email);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.updateProfile({ fullName: fullName.trim() || undefined, email: email.trim() });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <button aria-hidden tabIndex={-1} className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="edit-profile-title"
        className="relative z-10 w-[min(92vw,26rem)] rounded-3xl glass-strong p-6 outline-none">
        <h3 id="edit-profile-title" className="font-display text-lg font-bold">Edit Profile</h3>
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && !emailError) save(); }}>
          <div>
            <label htmlFor={`${uid}-name`} className="mb-1 block text-xs font-medium text-muted-foreground">Full Name</label>
            <input id={`${uid}-name`} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label htmlFor={`${uid}-phone`} className="mb-1 block text-xs font-medium text-muted-foreground">Mobile</label>
            <input id={`${uid}-phone`} value={profile.phone ?? ""} disabled className="w-full cursor-not-allowed rounded-xl border border-border bg-foreground/5 px-3.5 py-2.5 text-sm text-muted-foreground outline-none" />
          </div>
          <div>
            <label htmlFor={`${uid}-email`} className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <input id={`${uid}-email`} inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(emailError)} aria-describedby={emailError ? `${uid}-email-error` : undefined}
              className="w-full rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            {emailError && <p id={`${uid}-email-error`} role="alert" className="mt-1 text-xs text-danger">{emailError}</p>}
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={busy || Boolean(emailError)} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// The three top-up amounts offered, in paise.
const TOPUP_AMOUNTS = [20000, 50000, 100000];

function WalletView({ onBack }: { onBack?: () => void }) {
  const { data, loading, error, reload } = useAsync(() => api.wallet(), []);
  const txns = useAsync(() => api.walletTransactions(), []);
  const profileQ = useAsync(() => api.getProfile().catch(() => null), []);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  // The demo stand-in, held open over the amount it was opened for.
  const [demoFor, setDemoFor] = useState<{ amountPaise: number; providerOrderId: string } | null>(null);

  // Adding money used to POST /v1/wallet/topup, take the providerOrderId back and
  // print a sentence about it. Nothing ever opened a checkout, so no money could
  // enter the system at all. The order creation was always real — this is the half
  // that was missing.
  const topup = async (amountPaise: number) => {
    setNote(null); setFailure(null); setBusy(amountPaise);
    try {
      const r = await api.topup(amountPaise);
      const providerOrderId = r.paymentOrder?.providerOrderId;
      if (!providerOrderId) throw new Error("The payment could not be started. Please try again.");

      if (checkoutMode === "demo") { setDemoFor({ amountPaise, providerOrderId }); return; }

      const profile = profileQ.data?.profile;
      const outcome = await startCheckout({
        providerOrderId,
        amountPaise,
        description: `Wallet top-up of ${rupees(amountPaise)}`,
        prefill: { name: profile?.fullName, contact: profile?.phone, email: profile?.email },
      });
      if (outcome === "dismissed") { setNote("Payment cancelled. Nothing was charged."); return; }
      if (outcome === "failed") { setFailure("The payment did not go through. Nothing was charged."); return; }
      // Deliberately not "added to your wallet": the credit is posted by the signed
      // webhook, and saying otherwise would show a balance the ledger does not have.
      setNote("Payment submitted. Your balance updates as soon as the payment is confirmed — usually within a minute.");
      reload(); txns.reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Top up failed");
    } finally { setBusy(null); }
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
        {TOPUP_AMOUNTS.map((p) => (
          <button key={p} onClick={() => topup(p)} disabled={busy !== null}
            className="flex-1 rounded-xl glass py-3 text-sm font-semibold hover:ring-1 hover:ring-primary/40 disabled:opacity-50">
            {busy === p ? <Loader2 className="mx-auto size-4 animate-spin" /> : `Add ${rupees(p)}`}
          </button>
        ))}
      </div>
      {checkoutMode === "demo" && (
        <p className="mt-3 rounded-xl bg-warning/10 p-3 text-xs text-warning">
          <strong>Demo mode.</strong> No payment gateway is configured for this build, so adding
          money opens a demonstration checkout that takes no payment and adds no balance.
        </p>
      )}
      {note && <p role="status" className="mt-3 text-sm text-muted-foreground">{note}</p>}
      {failure && <p role="alert" className="mt-3 text-sm text-danger">{failure}</p>}
      {demoFor && (
        <DemoCheckoutDialog
          amountPaise={demoFor.amountPaise}
          providerOrderId={demoFor.providerOrderId}
          onClose={() => { setDemoFor(null); setNote("Demo checkout closed. No payment was taken and your balance is unchanged."); }}
        />
      )}
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

// The stand-in for a gateway that has no key configured for this build.
//
// It is deliberately incapable of doing anything: it opens, says what it is, and
// closes. There is no "Pay" button, because a button that appeared to take ₹500 and
// credited nothing would be worse than no button — and because the wallet is only
// ever credited by the backend's signed webhook, a front-end mock could not credit
// it honestly even if it tried.
//
// TO REPLACE: set NEXT_PUBLIC_RAZORPAY_KEY_ID (see lib/payments.ts). checkoutMode
// flips to "razorpay", the real sheet opens instead of this one, and this component
// stops being reachable.
function DemoCheckoutDialog({ amountPaise, providerOrderId, onClose }: {
  amountPaise: number; providerOrderId: string; onClose: () => void;
}) {
  const panelRef = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <button aria-hidden tabIndex={-1} className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="demo-checkout-title"
        className="relative z-10 w-[min(92vw,24rem)] rounded-3xl glass-strong p-6 outline-none">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-warning">
          <AlertTriangle className="size-3.5" /> Demo checkout
        </span>
        <h3 id="demo-checkout-title" className="mt-3 font-display text-lg font-bold">
          This is not a real payment page
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          No payment gateway is configured for this build, so there is nothing here to pay with.
          Your wallet balance will not change.
        </p>

        <dl className="mt-4 space-y-1.5 rounded-2xl glass p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-semibold">{rupees(amountPaise)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Payment order</dt>
            <dd className="truncate font-mono text-xs">{providerOrderId}</dd>
          </div>
        </dl>
        {/* The order above is genuine — the backend created it and recorded a pending
            intent against it. Saying so is the difference between a seam and a lie. */}
        <p className="mt-3 text-xs text-muted-foreground">
          That payment order is real: the backend created it and is waiting on a gateway to settle
          it. Supply a gateway key and this dialog is replaced by the gateway&apos;s own checkout.
        </p>

        <button onClick={onClose} className="mt-5 w-full rounded-xl glass py-2.5 text-sm font-medium">Close</button>
      </div>
    </div>
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
  // The current plan's description lives on the matching Available Plan entry.
  const currentPlanMeta = plans.find((p) => p.isCurrent) ?? null;
  const usagePct = current && current.allowance > 0 ? Math.round((current.used / current.allowance) * 100) : 0;

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
      {note && <p role="status" className="mb-3 rounded-xl bg-primary/10 p-3 text-sm text-foreground">{note}</p>}

      {/* Current plan — amount, garment usage (no progress bar), turnaround, dates */}
      {current && (
        <div className="mb-5 rounded-3xl glass-strong p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Plan</p>
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">Active</span>
          </div>
          {/* The name the admin gave the plan. The tier behind it is a slug, so this
              card used to announce "premium_care" to the person paying for it. */}
          <p className="mt-1 font-display text-2xl font-bold">{current.planName ?? currentPlanMeta?.name ?? current.planTier}</p>
          <p className="font-display text-lg font-semibold">{rupees(current.monthlyPaise)}<span className="text-xs font-normal text-muted-foreground"> / month</span></p>
          {(current.planDescription ?? currentPlanMeta?.description) && (
            <p className="mt-1 text-sm text-muted-foreground">{current.planDescription ?? currentPlanMeta?.description}</p>
          )}

          <div className="my-4 border-t border-border/60" />

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Garment Usage</dt>
              <dd className="mt-0.5 font-semibold">{current.used} of {current.allowance} garments used · {usagePct}% used</dd>
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
                aria-label="Reason for cancelling"
                onKeyDown={(e) => { if (e.key === "Enter" && cancelReason.trim() && !cancelBusy) { e.preventDefault(); cancelSubscription(); } }}
                className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              {cancelError && <p role="alert" className="text-xs text-danger">{cancelError}</p>}
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
            <p className="font-display text-lg font-bold">{pending.name ?? pending.tier}</p>
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
                <p className="mt-1 text-xs text-muted-foreground">Your scheduled change to {pending.name ?? pending.tier} will be cancelled. Your current plan will remain active.</p>
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
  // The scroll lock this had of its own is part of useDialog, which also brings the
  // Escape key, a focus trap and focus restoration that it did not have.
  const panelRef = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onClose}>
      <motion.div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="plan-change-title"
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl glass-strong p-6 outline-none">
        <h3 id="plan-change-title" className="font-display text-lg font-bold">{title}</h3>

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
            // What actually happens now that usage carries across an upgrade: the
            // allowance grows and the garments already collected this month stay
            // counted. The old wording promised a fresh allowance, which was the
            // behaviour this fixes.
            ? `Paying moves you to the new plan now. The ${current.used} garment${current.used === 1 ? "" : "s"} already collected this month stay counted, so you would have ${Math.max(0, plan.garmentCap - current.used)} of ${plan.garmentCap} left.`
            : "Your current plan will remain active until the end of your current billing period. The new plan will take effect from your next renewal date."}
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
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
  // The channels the operator has published. The backend has served these at
  // /v1/support/contact all along and the admin console shows whether each one is
  // set, but no resident screen had ever asked for them — so a person who wanted to
  // talk to somebody had only a ticket form.
  const contactQ = useAsync(() => api.supportContact().catch(() => null), []);
  const [composing, setComposing] = useState(false);

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-primary"><ArrowLeft className="size-4" /> Profile</button>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">Support</h2>
        {!composing && (
          <button onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110">
            <Plus className="size-4" /> New ticket
          </button>
        )}
      </div>

      {!composing && <SupportChannels contact={contactQ.data ?? null} />}

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

      {/* Consumer Protection (E-Commerce) Rules 2020, Rule 4(5): a named grievance
          officer with contact details has to be displayed. A resident should not have
          to leave the app and find the marketing site to reach one. */}
      <div className="mt-6">
        <GrievanceOfficer compact />
      </div>
    </div>
  );
}

// The published support channels, above the ticket list, for somebody who would
// rather speak to a person than file anything.
function SupportChannels({ contact }: { contact: SupportContact | null }) {
  if (!contact || contact.channels.length === 0) return null;
  const href = (channel: string, value: string) =>
    channel === "email" ? `mailto:${value}`
      : channel === "whatsapp" ? `https://wa.me/${value.replace(/\D/g, "")}`
        : `tel:${value.replace(/\s/g, "")}`;
  const icon = (channel: string) => (channel === "email" ? Mail : channel === "whatsapp" ? MessageSquare : Phone);
  const label = (channel: string) => (channel === "email" ? "Email" : channel === "whatsapp" ? "WhatsApp" : "Call us");

  return (
    <section className="mb-4 rounded-2xl glass p-4">
      <h3 className="text-sm font-semibold">Talk to us</h3>
      {contact.hours && <p className="mt-0.5 text-xs text-muted-foreground">{contact.hours}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {contact.channels.map((c) => {
          const Icon = icon(c.channel);
          return (
            <a key={c.channel} href={href(c.channel, c.value)}
              className="inline-flex items-center gap-2 rounded-xl glass px-3 py-2 text-sm font-medium hover:ring-1 hover:ring-primary/40">
              <Icon className="size-4 text-primary" />
              <span>{label(c.channel)}</span>
              <span className="text-xs text-muted-foreground">{c.value}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function NewTicketForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (ticketId: string) => void }) {
  const uid = useId();
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
    <form className="mb-5 space-y-4 rounded-3xl glass-strong p-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div>
        <label htmlFor={`${uid}-category`} className="mb-1.5 block text-xs font-semibold text-muted-foreground">Category</label>
        <Panel loading={types.loading} error={types.error}>
          <select id={`${uid}-category`} value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            {(types.data?.issueTypes ?? []).map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
        </Panel>
      </div>

      <div>
        <p className="mb-1.5 block text-xs font-semibold text-muted-foreground" id="ticket-priority-label">Priority</p>
        <div role="radiogroup" aria-labelledby="ticket-priority-label" className="flex gap-2">
          {RESIDENT_PRIORITIES.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={priority === p} onClick={() => setPriority(p)}
              className={`flex-1 rounded-xl py-2 text-xs font-medium capitalize transition ${priority === p ? "bg-primary/15 ring-1 ring-primary text-primary" : "glass text-muted-foreground"}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {allOrders.length > 0 && (
        <div>
          <label htmlFor={`${uid}-order`} className="mb-1.5 block text-xs font-semibold text-muted-foreground">Related order (optional)</label>
          <select id={`${uid}-order`} value={orderId} onChange={(e) => setOrderId(e.target.value)}
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">Not order specific</option>
            {allOrders.map((o) => <option key={o.id} value={o.id}>{o.orderCode ?? o.serviceName ?? "Order"}</option>)}
          </select>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor={`${uid}-description`} className="text-xs font-semibold text-muted-foreground">What&apos;s going on?</label>
          <span className="text-[11px] text-muted-foreground">{description.length}/{maxLen}</span>
        </div>
        <textarea id={`${uid}-description`} value={description} maxLength={maxLen} onChange={(e) => setDescription(e.target.value)} rows={4}
          placeholder="Describe the issue — as much detail as helps us sort it out."
          className="w-full resize-none rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium">Never mind</button>
        <button type="submit" disabled={busy || !category || !description.trim()}
          className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="mx-auto size-4 animate-spin" /> : "Submit ticket"}
        </button>
      </div>
    </form>
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
    // The conversation as well as the ticket. `canReply` lives on the conversation,
    // so reloading only the ticket flipped the badge to Closed and took the "Close
    // ticket" button away while leaving the reply box sitting there, still enabled.
    // A resident who typed "thanks, all sorted" and pressed Send got the backend's
    // refusal for their trouble — it answers 409 on a closed ticket, correctly.
    try { await api.closeTicket(ticketId); ticketQ.reload(); convoQ.reload(); }
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

            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

            {conversation && !conversation.canReply && (
              <p className="mt-4 rounded-xl bg-warning/10 p-3 text-sm text-warning">{conversation.readOnlyReason ?? "This conversation is read only."}</p>
            )}

            {conversation?.canReply && (
              <div className="mt-4 space-y-2">
                <div className="flex items-end gap-2">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder={conversation.replyLabel || "Write a reply…"}
                    aria-label="Write a reply"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
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
