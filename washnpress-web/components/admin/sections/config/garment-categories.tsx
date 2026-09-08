"use client";

import * as React from "react";
import { Plus, Search, Trash2, ChevronRight } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { StatusBadge } from "@/components/portal/status-badge";
import { useToast } from "@/components/portal/toast";
import { useConfirm } from "@/components/portal/confirm-dialog";
import { useAsync, useAction } from "@/lib/use-async";
import { adminApi, type GarmentGroup, type CategoryGarment } from "@/lib/api/admin";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

// I-71: two-level garment categories. A category groups garment items, each priced
// per piece. Cards show the garment count and price range; the drawer edits the
// category's details, its items and their prices, and can delete it.
function priceRange(items: CategoryGarment[]): string {
  if (items.length === 0) return "—";
  const prices = items.map((i) => i.pricePaise);
  const lo = Math.min(...prices); const hi = Math.max(...prices);
  return lo === hi ? rupees(lo) : `${rupees(lo)} – ${rupees(hi)}`;
}

export function GarmentCategoriesManager() {
  const { data, loading, error, reload } = useAsync(() => adminApi.config.get(), []);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = React.useState<GarmentGroup | null>(null);
  const [creating, setCreating] = React.useState(false);

  const groups = data?.config.garmentGroups ?? [];
  const filtered = groups.filter((g) => {
    if (status === "active" && g.status !== "active") return false;
    if (status === "inactive" && g.status === "active") return false;
    if (q.trim() && !g.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <Panel loading={loading} error={error} onRetry={reload}>
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Group garments into categories and set each garment&apos;s per-piece price. All prices are GST-inclusive.</p>
          <button onClick={() => setCreating(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110">
            <Plus className="size-4" /> Add Category
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm">
            <Search className="size-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search categories" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="space-y-2.5">
          {filtered.map((g) => (
            <button key={g.id} onClick={() => setEditing(g)}
              className="flex w-full items-center gap-3 rounded-2xl glass p-4 text-left transition-colors hover:ring-1 hover:ring-primary/30">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{g.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {g.items.length} garment{g.items.length === 1 ? "" : "s"} · {priceRange(g.items)}
                </span>
                {g.description && <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{g.description}</span>}
              </span>
              <StatusBadge status={g.status} toneMap={{ active: "success", inactive: "muted" }} />
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="rounded-2xl glass p-8 text-center text-sm text-muted-foreground">
              {groups.length === 0 ? "No categories yet. Add one to get started." : "No categories match your search or filter."}
            </div>
          )}
        </div>
      </div>

      {creating && <CategoryDrawer existingNames={groups.map((g) => g.name)} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {editing && <CategoryDrawer group={editing} existingNames={groups.filter((g) => g.id !== editing.id).map((g) => g.name)}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} onDeleted={() => { setEditing(null); reload(); }} />}
    </Panel>
  );
}

function CategoryDrawer({ group, existingNames, onClose, onSaved, onDeleted }: {
  group?: GarmentGroup;
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [name, setName] = React.useState(group?.name ?? "");
  const [description, setDescription] = React.useState(group?.description ?? "");
  const [active, setActive] = React.useState(group ? group.status === "active" : true);
  const [items, setItems] = React.useState<{ name: string; price: string }[]>(
    group ? group.items.map((i) => ({ name: i.name, price: String(i.pricePaise / 100) })) : [{ name: "", price: "" }],
  );

  const nameTaken = name.trim().length > 0 && existingNames.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());
  const validItems = items.filter((i) => i.name.trim() && i.price !== "" && Number(i.price) >= 0);
  const canSave = name.trim().length > 0 && !nameTaken && validItems.length > 0;

  const save = useAction(() => {
    const body = {
      name: name.trim(), description: description.trim() || undefined,
      status: (active ? "active" : "inactive") as "active" | "inactive",
      items: validItems.map((i) => ({ name: i.name.trim(), pricePaise: Math.round(Number(i.price) * 100) })),
    };
    return group ? adminApi.garmentCategories.update(group.id, body) : adminApi.garmentCategories.create(body);
  });
  const del = useAction(() => adminApi.garmentCategories.remove(group!.id));

  const setItem = (idx: number, patch: Partial<{ name: string; price: string }>) =>
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addItem = () => setItems((rows) => [...rows, { name: "", price: "" }]);
  const removeItem = (idx: number) => setItems((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== idx)));

  const onDelete = async () => {
    if (!group) return;
    const ok = await confirm({ title: `Delete "${group.name}"?`, description: "This removes the category and its garments. A category with garments on an active order cannot be deleted — deactivate it instead.", confirmLabel: "Delete category", danger: true });
    if (!ok) return;
    del.run().then(() => { toast.push("Category deleted"); onDeleted?.(); }).catch((e) => toast.push(e?.message ?? "Could not delete category", "danger"));
  };

  return (
    <Modal open onClose={onClose} variant="drawer" title={group ? "Edit category" : "Add category"}>
      <div className="space-y-4">
        <FormField label="Category name" required value={name} onChange={(e) => setName(e.target.value)}
          error={nameTaken ? "A category with this name already exists." : undefined} placeholder="e.g. Tops" />
        <FormField as="textarea" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Garment items &amp; prices</span>
            <button type="button" onClick={addItem} className="inline-flex items-center gap-1 rounded-full glass px-2.5 py-1 text-xs hover:ring-1 hover:ring-primary/40"><Plus className="size-3.5" /> Add garment</button>
          </div>
          {items.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input value={it.name} onChange={(e) => setItem(idx, { name: e.target.value })} placeholder="Garment (e.g. Shirts)"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">₹</span>
                <input value={it.price} onChange={(e) => setItem(idx, { price: e.target.value })} type="number" min="0" step="0.01" placeholder="0"
                  className="w-24 rounded-lg border border-border bg-background/60 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <button type="button" onClick={() => removeItem(idx)} disabled={items.length === 1}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-30" aria-label="Remove garment">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Per-piece prices are GST-inclusive.</p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 rounded border-border" />
          Active — garments in this category can be booked
        </label>

        {save.error && <p className="text-sm text-danger">{save.error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {group && (
            <button type="button" onClick={onDelete} disabled={del.busy}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50">
              <Trash2 className="size-4" /> {del.busy ? "Deleting…" : "Delete"}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl glass px-4 py-2.5 text-sm font-medium hover:ring-1 hover:ring-border">Cancel</button>
            <button type="button" disabled={!canSave || save.busy}
              onClick={() => save.run().then(() => { toast.push(group ? "Category updated" : "Category created"); onSaved(); }).catch(() => {})}
              className={cn("rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50")}>
              {save.busy ? "Saving…" : group ? "Save Changes" : "Create Category"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
