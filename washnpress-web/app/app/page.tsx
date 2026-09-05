"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Shirt, Car, Wind, Sparkles, Wallet as WalletIcon, CalendarClock, PackageSearch,
  ArrowLeft, LogOut, Loader2, Plus, CheckCircle2, Clock,
} from "lucide-react";
import {
  api, setToken, getToken, ApiError,
  type Dashboard, type Service, type Slot, type BookingOptionService, type Plan,
  type OrderCard, type Tracking,
} from "@/lib/api-client";

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

type View = "home" | "book" | "orders" | "wallet" | "plans" | "track";

export default function ResidentApp() {
  const [booted, setBooted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<View>("home");
  const [trackId, setTrackId] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken();
    if (!t) { setBooted(true); return; }
    api.me().then(() => setAuthed(true)).catch(() => setToken(null)).finally(() => setBooted(true));
  }, []);

  if (!booted) return <Splash />;
  if (!authed) return <Login onLogin={() => { setAuthed(true); setView("home"); }} />;

  return (
    <div className="mx-auto min-h-[100dvh] max-w-3xl px-4 pb-28 pt-6 sm:px-6">
      <TopBar onLogout={async () => { await api.logout(); setToken(null); setAuthed(false); }} />
      <AnimatePresence mode="wait">
        <motion.div key={view + (trackId ?? "")} initial={fade.initial} animate={fade.animate} exit={fade.exit} transition={{ duration: 0.25 }}>
          {view === "home" && <Home go={setView} />}
          {view === "book" && <Book onBooked={() => setView("orders")} />}
          {view === "orders" && <Orders onTrack={(id) => { setTrackId(id); setView("track"); }} />}
          {view === "wallet" && <WalletView />}
          {view === "plans" && <Plans />}
          {view === "track" && trackId && <TrackView orderId={trackId} onBack={() => setView("orders")} />}
        </motion.div>
      </AnimatePresence>
      <TabBar view={view} setView={setView} />
    </div>
  );
}

function Splash() {
  return <div className="grid min-h-[100dvh] place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
}

function TopBar({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/40 text-primary-foreground shadow-glow">
          <Sparkles className="size-4" />
        </span>
        <span className="font-display text-lg font-bold tracking-tight">Wash N Press</span>
      </div>
      <button onClick={onLogout} className="inline-flex items-center gap-1.5 rounded-full glass px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
        <LogOut className="size-3.5" /> Sign out
      </button>
    </header>
  );
}

function TabBar({ view, setView }: { view: View; setView: (v: View) => void }) {
  const tabs: { id: View; label: string; icon: typeof Shirt }[] = [
    { id: "home", label: "Home", icon: PackageSearch },
    { id: "book", label: "Book", icon: CalendarClock },
    { id: "orders", label: "Orders", icon: Clock },
    { id: "wallet", label: "Wallet", icon: WalletIcon },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(92%,26rem)] items-center justify-between rounded-2xl glass-strong p-1.5">
      {tabs.map((t) => {
        const active = view === t.id || (view === "track" && t.id === "orders");
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

function Home({ go }: { go: (v: View) => void }) {
  const { data, loading, error } = useAsync<Dashboard>(() => api.dashboard(), []);
  const svc = useAsync<{ services: Service[] }>(() => api.services(), []);
  return (
    <Panel loading={loading} error={error}>
      {data && (
        <div className="space-y-5">
          <div>
            <p className="text-sm text-muted-foreground">Good day</p>
            <h2 className="font-display text-2xl font-bold">{data.residentName}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => go("wallet")} className="rounded-2xl glass-strong p-4 text-left">
              <p className="text-xs text-muted-foreground">Wallet</p>
              <p className="mt-1 font-display text-2xl font-bold">{rupees(data.walletBalancePaise)}</p>
            </button>
            <button onClick={() => go("plans")} className="rounded-2xl glass-strong p-4 text-left">
              <p className="text-xs text-muted-foreground">Plan</p>
              <p className="mt-1 font-display text-lg font-semibold">{data.subscription?.planName ?? "Choose a plan"}</p>
            </button>
          </div>

          <button onClick={() => go("book")} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground shadow-glow hover:brightness-110">
            <Plus className="size-4" /> Book a pickup
          </button>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Services</h3>
            <Panel loading={svc.loading} error={svc.error}>
              <motion.div variants={listV} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(svc.data?.services ?? []).filter((s) => s.isActive !== false).map((s) => {
                  const Icon = serviceIcon(s.name);
                  return (
                    <motion.div key={s.id} variants={itemV} whileHover={{ y: -4 }} className="rounded-2xl glass p-4">
                      <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"><Icon className="size-5" /></span>
                      <p className="mt-3 text-sm font-medium leading-tight">{s.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{rupees(s.unitPricePaise)} / {s.unit}</p>
                    </motion.div>
                  );
                })}
              </motion.div>
            </Panel>
          </div>

          {data.recentOrders && data.recentOrders.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Recent</h3>
              <div className="space-y-2">{data.recentOrders.map((o) => <OrderRow key={o.id} o={o} onClick={() => go("orders")} />)}</div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Book({ onBooked }: { onBooked: () => void }) {
  const date = today();
  const opts = useAsync<{ services: BookingOptionService[] }>(() => api.bookingOptions(), []);
  const slotsQ = useAsync<{ slots: Slot[] }>(() => api.slots(date), []);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [qty, setQty] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!serviceId || !slotId) return;
    setBusy(true); setError(null);
    try { await api.bookPickup(slotId, serviceId, qty); onBooked(); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? "That slot just filled up. Pick another." : (e instanceof Error ? e.message : "Booking failed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-bold">Book a pickup</h2>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Choose a service</h3>
        <Panel loading={opts.loading} error={opts.error}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(opts.data?.services ?? []).map((s) => {
              const Icon = serviceIcon(s.name); const on = serviceId === s.id;
              return (
                <button key={s.id} onClick={() => setServiceId(s.id)}
                  className={`rounded-2xl p-4 text-left transition ${on ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40"}`}>
                  <span className={`grid size-9 place-items-center rounded-lg ${on ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary"}`}><Icon className="size-4" /></span>
                  <p className="mt-2.5 text-sm font-medium leading-tight">{s.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{rupees(s.pricePaise)} / {s.unit}</p>
                </button>
              );
            })}
          </div>
        </Panel>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Estimated garments</h3>
        <div className="inline-flex items-center gap-4 rounded-2xl glass p-2 pl-4">
          <button aria-label="Fewer" onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary text-lg">-</button>
          <span className="min-w-8 text-center font-display text-xl font-bold">{qty}</span>
          <button aria-label="More" onClick={() => setQty((q) => Math.min(50, q + 1))} className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary text-lg">+</button>
          <span className="pr-2 text-xs text-muted-foreground">confirmed on the scale at pickup</span>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Pick a slot for today</h3>
        <Panel loading={slotsQ.loading} error={slotsQ.error}>
          {(slotsQ.data?.slots ?? []).length === 0 ? (
            <p className="rounded-2xl glass p-5 text-sm text-muted-foreground">No slots left today. Try again tomorrow.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(slotsQ.data?.slots ?? []).map((s) => {
                const on = slotId === s.id;
                return (
                  <button key={s.id} onClick={() => setSlotId(s.id)}
                    className={`rounded-2xl p-4 text-left transition ${on ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40"}`}>
                    <p className="text-sm font-semibold">{s.window}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.startTime} to {s.endTime}</p>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </section>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button onClick={confirm} disabled={!serviceId || !slotId || busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Confirm pickup"}
      </button>
    </div>
  );
}

function OrderRow({ o, onClick }: { o: OrderCard; onClick: () => void }) {
  return (
    <motion.button variants={itemV} onClick={onClick} className="flex w-full items-center justify-between rounded-2xl glass p-4 text-left">
      <div>
        <p className="text-sm font-semibold">{o.orderCode ?? o.serviceName ?? "Order"}</p>
        <p className="text-xs text-muted-foreground">{o.serviceName ?? ""}</p>
      </div>
      <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs text-primary">{o.state.replace(/_/g, " ")}</span>
    </motion.button>
  );
}

function Orders({ onTrack }: { onTrack: (id: string) => void }) {
  const { data, loading, error } = useAsync(() => api.orders(), []);
  const groups: [string, OrderCard[]][] = data
    ? [["In progress", data.current], ["Upcoming", data.upcoming], ["Past", data.previous]]
    : [];
  return (
    <Panel loading={loading} error={error}>
      <h2 className="mb-4 font-display text-2xl font-bold">Your orders</h2>
      {data && data.current.length + data.upcoming.length + data.previous.length === 0 && (
        <div className="rounded-2xl glass p-6 text-center text-sm text-muted-foreground">No orders yet. Book your first pickup from the Book tab.</div>
      )}
      <motion.div variants={listV} initial="hidden" animate="show" className="space-y-6">
        {groups.map(([label, list]) => list.length > 0 && (
          <div key={label}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{label}</h3>
            <div className="space-y-2">{list.map((o) => <OrderRow key={o.id} o={o} onClick={() => onTrack(o.id)} />)}</div>
          </div>
        ))}
      </motion.div>
    </Panel>
  );
}

function TrackView({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { data, loading, error } = useAsync<Tracking>(() => api.tracking(orderId), [orderId]);
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
          </div>
        )}
      </Panel>
    </div>
  );
}

function WalletView() {
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

function Plans() {
  const { data, loading, error } = useAsync<{ plans: Plan[] }>(() => api.plans(), []);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const subscribe = async (p: Plan) => {
    setBusy(p.id); setNote(null);
    try { await api.subscribe(p.id); setNote(`Subscribed to ${p.name}.`); }
    catch (e) { setNote(e instanceof ApiError && e.status === 402 ? "Not enough wallet balance. Add money in the Wallet tab first." : (e instanceof Error ? e.message : "Could not subscribe")); }
    finally { setBusy(null); }
  };
  return (
    <Panel loading={loading} error={error}>
      <h2 className="mb-4 font-display text-2xl font-bold">Plans</h2>
      {note && <p className="mb-3 text-sm text-muted-foreground">{note}</p>}
      <motion.div variants={listV} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2">
        {(data?.plans ?? []).map((p) => (
          <motion.div key={p.id} variants={itemV} className="rounded-3xl glass-strong p-5">
            <p className="font-display text-lg font-bold">{p.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {p.services.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="size-4 text-primary" /> {s.includedQuantity} {s.unit} of {s.serviceName}</li>
              ))}
            </ul>
            <button onClick={() => subscribe(p)} disabled={busy === p.id}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : "Choose plan"}
            </button>
          </motion.div>
        ))}
      </motion.div>
    </Panel>
  );
}
