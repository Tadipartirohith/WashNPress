import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { BlockAllocation, SocietyAssignment } from "../api/types";
import {
  Button, Card, CardGrid, Empty, ErrorText, Field, FieldRow, Notice, Pill, Row, SectionTitle,
} from "../components/ui";
import { Dropdown } from "../components/filters";
import { theme } from "../theme";

// Society → Supervisor → Blocks → Operators, on one screen.
//
// The chain used to be two fields on a user record, so nothing could show a society
// and say who ran it, or show a tower and say who collected from it. Deciding who
// takes a tower means seeing how big the tower is, how many people live in it and
// how much work is on it right now, so all four are on the same row as the choice.
//
// The same panel serves an admin and a supervisor. An admin chooses who runs the
// society; a supervisor cannot — that is not their decision — but everything inside
// it is theirs to arrange, so the difference between the two is one dropdown.

export interface AssignmentApi {
  load: () => Promise<SocietyAssignment>;
  setSupervisor?: (supervisorUserId: string | null) => Promise<unknown>;
  createBlock: (body: { name: string; flatCount?: number }) => Promise<unknown>;
  updateBlock: (blockId: string, body: { name?: string; flatCount?: number; status?: string }) => Promise<unknown>;
  setOperators: (blockId: string, operatorUserIds: string[]) => Promise<unknown>;
}

export function adminAssignmentApi(societyId: string, token: string): AssignmentApi {
  return {
    load: () => api.adminAssignments(societyId, token),
    setSupervisor: (id) => api.adminAssignSocietySupervisor(societyId, id, token),
    createBlock: (body) => api.adminCreateBlock(societyId, body, token),
    updateBlock: (blockId, body) => api.adminUpdateBlock(blockId, body, token),
    setOperators: (blockId, ids) => api.adminSetBlockOperators(blockId, ids, token),
  };
}

export function supervisorAssignmentApi(societyId: string, token: string): AssignmentApi {
  return {
    load: () => api.supMySociety(token),
    // No setSupervisor: a supervisor cannot change which society is theirs.
    createBlock: (body) => api.supCreateBlock(societyId, body, token),
    updateBlock: (blockId, body) => api.supUpdateBlock(blockId, body, token),
    setOperators: (blockId, ids) => api.supSetBlockOperators(blockId, ids, token),
  };
}

export function AssignmentPanel({ source, title = "Assignments", subtitle }: {
  source: AssignmentApi;
  title?: string;
  subtitle?: string;
}) {
  const [data, setData] = useState<SocietyAssignment | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFlats, setNewFlats] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftFlats, setDraftFlats] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await source.load()); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
    // The api object is rebuilt on every render of the caller, so depending on it
    // would reload forever. What it points at is the society and the token, and
    // both are in the caller's own dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (what: () => Promise<unknown>, said: string) => {
    setError(null); setNote(null);
    try { await what(); setNote(said); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  if (busy && !data) return <Text style={styles.muted}>Loading assignments…</Text>;
  if (!data?.society) {
    return (
      <Notice
        tone="warn"
        text="No society is assigned to you yet. An admin assigns one from Societies, and this page fills in as soon as they do."
      />
    );
  }

  const supervisorOptions = data.supervisorOptions ?? [];
  const operatorOptions = data.operatorOptions ?? [];

  return (
    <View>
      <SectionTitle
        action={<Button label={adding ? "Close" : "Add block"} variant="secondary" onPress={() => setAdding(!adding)} />}
      >
        {title}
      </SectionTitle>
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}

      {/* ------------------------------------------------------ the supervisor */}
      <Card>
        <Text style={styles.cardTitle}>Supervisor</Text>
        {source.setSupervisor ? (
          <>
            <Dropdown
              label="Runs this society"
              value={data.supervisor?.id}
              allLabel="Unassigned"
              options={supervisorOptions.map((s) => ({
                value: s.id,
                // A supervisor who already runs somewhere else is named with the
                // society they hold rather than hidden, so an admin can see why
                // choosing them will be refused instead of wondering where they went.
                label: s.heldSocietyName
                  ? `${s.fullName ?? s.phone} — runs ${s.heldSocietyName}`
                  : (s.fullName ?? s.phone),
              }))}
              onChange={(id) => act(
                () => source.setSupervisor!(id ?? null),
                id ? "Supervisor assigned." : "Supervisor cleared. The society is waiting for one.",
              )}
            />
            <Text style={styles.hint}>
              One supervisor per society, and one society per supervisor. Somebody already running
              another society has to be released from it first.
            </Text>
          </>
        ) : (
          <>
            <Row label="Runs this society" value={data.supervisor?.fullName ?? "Unassigned"} />
            {/* Said plainly rather than shown as a dropdown that refuses. */}
            <Text style={styles.hint}>
              Which society you run is an admin's decision. Everything inside it is yours to arrange.
            </Text>
          </>
        )}
      </Card>

      {/* ----------------------------------------------------------- new block */}
      {adding ? (
        <Card>
          <Text style={styles.cardTitle}>Add a block</Text>
          <FieldRow>
            <Field label="Name" value={newName} onChangeText={setNewName} placeholder="A, Tower 1, North Wing" width="medium" />
            <Field label="Flats" value={newFlats} onChangeText={setNewFlats} keyboardType="number-pad" width="small" />
          </FieldRow>
          <Button
            label="Add block"
            disabled={newName.trim().length === 0}
            onPress={() => act(async () => {
              await source.createBlock({
                name: newName.trim(),
                flatCount: newFlats ? Number(newFlats) : undefined,
              });
              setNewName(""); setNewFlats(""); setAdding(false);
            }, "Block added.")}
          />
        </Card>
      ) : null}

      {/* -------------------------------------------------------- the blocks */}
      <CardGrid columns={{ desktop: 3, tablet: 2, mobile: 1 }}>
        {data.blocks.map((block) => (
          <BlockCard
            key={block.blockId}
            block={block}
            operatorOptions={operatorOptions}
            editing={editing === block.blockId}
            draftName={draftName}
            draftFlats={draftFlats}
            onDraftName={setDraftName}
            onDraftFlats={setDraftFlats}
            onEdit={() => {
              setEditing(block.blockId);
              setDraftName(block.blockName);
              setDraftFlats(String(block.flatCount));
            }}
            onCancel={() => setEditing(null)}
            onSave={() => act(async () => {
              await source.updateBlock(block.blockId, {
                name: draftName.trim() || undefined,
                flatCount: draftFlats ? Number(draftFlats) : undefined,
              });
              setEditing(null);
            }, "Block saved.")}
            onToggle={() => act(
              () => source.updateBlock(block.blockId, { status: block.status === "active" ? "inactive" : "active" }),
              block.status === "active" ? "Block deactivated." : "Block activated.",
            )}
            onAssign={(operatorId) => act(
              () => source.setOperators(block.blockId, operatorId ? [operatorId] : []),
              operatorId ? "Operator assigned to the block." : "Block left unassigned.",
            )}
            onAdd={(operatorId) => act(
              () => source.setOperators(
                block.blockId,
                Array.from(new Set([...block.operators.map((o) => o.id), operatorId])),
              ),
              "Operator added to the block.",
            )}
            onRemove={(operatorId) => act(
              () => source.setOperators(
                block.blockId,
                block.operators.map((o) => o.id).filter((id) => id !== operatorId),
              ),
              "Operator taken off the block.",
            )}
          />
        ))}
      </CardGrid>
      {!data.blocks.length ? <Empty text="This society has no blocks yet. Add one to start assigning operators." /> : null}

      {data.unassignedResidentCount > 0 ? (
        <Notice
          tone="warn"
          text={`${data.unassignedResidentCount} resident${data.unassignedResidentCount === 1 ? "" : "s"} here have not recorded which block they live in, so no block assignment covers them yet.`}
        />
      ) : null}
      {note ? <Notice tone="good" text={note} /> : null}
      <ErrorText error={error} />
    </View>
  );
}

function BlockCard({
  block, operatorOptions, editing, draftName, draftFlats,
  onDraftName, onDraftFlats, onEdit, onCancel, onSave, onToggle, onAssign, onAdd, onRemove,
}: {
  block: BlockAllocation;
  operatorOptions: { id: string; fullName: string | null; phone: string; status: string }[];
  editing: boolean;
  draftName: string;
  draftFlats: string;
  onDraftName: (v: string) => void;
  onDraftFlats: (v: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onToggle: () => void;
  onAssign: (operatorId: string | undefined) => void;
  onAdd: (operatorId: string) => void;
  onRemove: (operatorId: string) => void;
}) {
  const covering = block.operators;
  const free = operatorOptions.filter((o) => !covering.some((c) => c.id === o.id));
  return (
    <Card>
      <View style={styles.headRow}>
        <Text style={styles.cardTitle}>{block.blockName}</Text>
        <Pill
          text={block.status === "active" ? "Active" : "Inactive"}
          color={block.status === "active" ? theme.success : theme.muted}
        />
      </View>
      {/* How big the tower is, who lives in it and what is on it now: everything
          the decision below actually depends on. */}
      <Row label="Flats" value={block.flatCount} />
      <Row label="Residents" value={block.residentCount} />
      <Row label="Active orders" value={block.activeOrderCount} />
      <Row
        label="Operators"
        value={covering.length ? covering.map((o) => o.fullName ?? o.id).join(", ") : "Unassigned"}
      />

      {editing ? (
        <>
          <FieldRow>
            <Field label="Name" value={draftName} onChangeText={onDraftName} width="medium" />
            <Field label="Flats" value={draftFlats} onChangeText={onDraftFlats} keyboardType="number-pad" width="small" />
          </FieldRow>
          <View style={styles.buttonRow}>
            <View style={{ flex: 1, marginRight: 6 }}><Button label="Save" onPress={onSave} /></View>
            <View style={{ flex: 1, marginLeft: 6 }}><Button label="Cancel" variant="secondary" onPress={onCancel} /></View>
          </View>
        </>
      ) : (
        <>
          {covering.length === 0 ? (
            <Dropdown
              label="Assign operator"
              value={undefined}
              allLabel="Unassigned"
              options={operatorOptions.map((o) => ({
                value: o.id,
                label: o.status === "on_leave" ? `${o.fullName ?? o.phone} (on leave)` : (o.fullName ?? o.phone),
              }))}
              onChange={onAssign}
              width="full"
            />
          ) : (
            <>
              {/* More than one operator on a block is normal: a morning and an
                  evening round are two people on the same tower. */}
              {covering.map((o) => (
                <View key={o.id} style={styles.assignedRow}>
                  <Text style={styles.assignedName} numberOfLines={1}>{o.fullName ?? o.id}</Text>
                  <Button label="Remove" variant="secondary" onPress={() => onRemove(o.id)} />
                </View>
              ))}
              {free.length ? (
                <Dropdown
                  label="Add another operator"
                  value={undefined}
                  allLabel="Choose somebody"
                  options={free.map((o) => ({
                    value: o.id,
                    label: o.status === "on_leave" ? `${o.fullName ?? o.phone} (on leave)` : (o.fullName ?? o.phone),
                  }))}
                  onChange={(id) => { if (id) onAdd(id); }}
                  width="full"
                />
              ) : null}
            </>
          )}
          <View style={styles.buttonRow}>
            <View style={{ flex: 1, marginRight: 6 }}><Button label="Edit" variant="secondary" onPress={onEdit} /></View>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <Button label={block.status === "active" ? "Deactivate" : "Activate"} variant="secondary" onPress={onToggle} />
            </View>
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 16, fontWeight: "800", color: theme.deepTeal },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  muted: { fontSize: 12, color: theme.muted, marginBottom: 8 },
  hint: { fontSize: 12, color: theme.muted, marginTop: 6, lineHeight: 17 },
  buttonRow: { flexDirection: "row", marginTop: 10 },
  assignedRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: 8, marginTop: 8,
  },
  assignedName: { flex: 1, fontSize: 14, color: theme.slate, marginRight: 8 },
});
