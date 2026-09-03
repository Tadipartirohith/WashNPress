import { useEffect, useState } from "react";
import { themed } from "../components/themed";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { NamingConvention, NamingStyles, Society, SocietyAddress } from "../api/types";
import { Button, ErrorText, Field, FieldRow, Notice, Row } from "../components/ui";
import { DataTable, Dropdown } from "../components/filters";
import { CenteredModal, StepIndicator, WizardFooter } from "../components/modal";
import { font, theme, titleCase } from "../theme";

// Creating a society, in three steps, in the middle of the screen.
//
// Two things about the old form were wrong rather than merely plain. The address
// was one free-text box beside a city and a state, which is three fields pretending
// to be an address: nothing could tell "Main Road" from "Madhapur" and nobody could
// search by pincode. And the towers were not asked for at all — but an operator is
// assigned to blocks, so a society whose blocks were never named is a society whose
// work cannot be handed to anybody.
//
// The society code went with them. It was a second name for a thing that already
// had one, kept unique by hand, and meaning nothing to whoever read it.

// Naming and structure were two steps that asked the same question from two sides —
// one for how towers, floors and flats are named, the next for how many there are —
// so the admin described the structure twice. They are one step now, and the last
// step only shows the result rather than asking for any of it again.
const STEPS = ["Details", "Naming & structure", "Review"];

const EMPTY: SocietyAddress = {
  house: "", street: "", locality: "", city: "", state: "", pincode: "",
};

interface DraftBlock { key: string; name: string; floorCount: string; flatCount: string }

// A block this society already has, as the summary endpoint reports it.
type ExistingBlock = NonNullable<Society["blocks"]>[number];

let blockKeySeed = 0;
const newBlock = (): DraftBlock => {
  blockKeySeed += 1;
  return { key: `b${blockKeySeed}`, name: "", floorCount: "", flatCount: "" };
};

export function SocietyWizard({ visible, token, states, existing, onClose, onSaved }: {
  visible: boolean;
  token: string;
  // The states the address may name, from the endpoint the list came from, so the
  // client neither invents the list nor makes a call of its own for it.
  states: string[];
  // Editing opens the same wizard rather than a different form, because a society
  // being changed is the same shape as one being made.
  existing?: Society | null;
  onClose: () => void;
  onSaved: (society: Society) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [address, setAddress] = useState<SocietyAddress>(EMPTY);
  const [blocks, setBlocks] = useState<DraftBlock[]>([newBlock()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // How this society names its towers, floors and flats, and what that produces.
  // The preview comes from the backend rather than being drawn here: a screen that
  // invents its own example is a screen that can be wrong about what saving does.
  const [naming, setNaming] = useState<NamingConvention>({ tower: "letter", floor: "number", flat: "tower_floor_unit" });
  const [namingInfo, setNamingInfo] = useState<NamingStyles | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setName(existing?.name ?? "");
    setAddress(existing?.address ?? EMPTY);
    setBlocks(existing?.blocks?.length
      ? existing.blocks.map((b, i) => ({
        key: `e${i}`, name: b.name,
        floorCount: String(b.floorCount || ""), flatCount: String(b.flatCount || ""),
      }))
      : [newBlock()]);
    setNaming(existing?.naming ?? { tower: "letter", floor: "number", flat: "tower_floor_unit" });
    setError(null); setBusy(false);
  }, [visible, existing]);

  // Reloaded whenever a choice or the structure changes, so the preview is always of
  // what is currently entered rather than of a fixed example: the towers actually
  // added, and the floors and flats of the first of them.
  const firstFloors = blocks.find((b) => b.name.trim() && Number(b.floorCount) > 0)?.floorCount ?? "";
  const firstFlats = blocks.find((b) => b.name.trim() && Number(b.flatCount) > 0)?.flatCount ?? "";
  const towerCount = blocks.filter((b) => b.name.trim()).length;
  useEffect(() => {
    if (!visible) return;
    let live = true;
    api.adminNaming({
      ...naming,
      towers: String(Math.max(1, towerCount)),
      floors: Number(firstFloors) > 0 ? firstFloors : "5",
      flatsPerFloor: Number(firstFlats) > 0 ? firstFlats : "4",
    }, token)
      .then((r) => { if (live) setNamingInfo(r); })
      .catch(() => { if (live) setNamingInfo(null); });
    return () => { live = false; };
  }, [visible, token, naming, towerCount, firstFloors, firstFlats]);

  const set = (part: Partial<SocietyAddress>) => setAddress((current) => ({ ...current, ...part }));

  const named = blocks.filter((b) => b.name.trim());
  // A society's address is the location of a complex, not of a front door. The
  // house and the street are kept for an operator finding the place, and neither is
  // required: "Aparna Apartments" with "House: Aparna Apartments" under it says the
  // same thing twice, and the individual flat belongs to the resident inside.
  const detailsDone = name.trim().length > 1
    && Boolean(address.locality.trim() && address.city.trim() && address.state.trim())
    && /^[1-9][0-9]{5}$/.test(address.pincode.trim());
  // Two towers with the same name is a typo, not two towers, and it is worth saying
  // so before the society exists rather than after.
  const duplicate = named.some((b, i) =>
    named.findIndex((o) => o.name.trim().toLowerCase() === b.name.trim().toLowerCase()) !== i);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = {
        name: name.trim(),
        address: {
          house: address.house.trim(), street: address.street.trim(), locality: address.locality.trim(),
          city: address.city.trim(), state: address.state.trim(), pincode: address.pincode.trim(),
        },
        // A count nobody typed is left out rather than sent as zero. Floors and
        // flats are positive numbers, and "not said" is a different answer from
        // "none of them".
        naming,
        blocks: named.map((b) => ({
          name: b.name.trim(),
          ...(Number(b.floorCount) > 0 ? { floorCount: Number(b.floorCount) } : {}),
          ...(Number(b.flatCount) > 0 ? { flatCount: Number(b.flatCount) } : {}),
        })),
      };
      // Editing does not rewrite the blocks: they are added and renamed from the
      // society's own page, where the operators standing on them are visible.
      const saved = existing
        ? (await api.adminUpdateSociety(existing.id, { name: body.name, address: body.address, naming }, token)).society
        : (await api.adminCreateSociety(body, token)).society;
      onSaved(saved);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const dirty = Boolean(name || address.house || address.street || named.length);

  return (
    <CenteredModal
      visible={visible}
      title={existing ? `Edit ${existing.name}` : "New society"}
      subtitle={STEPS[step]}
      onClose={onClose}
      width="wide"
      dirty={dirty}
      discardMessage="Are you sure you want to discard this society?"
      footer={(
        <WizardFooter
          onBack={step > 0 ? () => setStep(step - 1) : undefined}
          onNext={step === STEPS.length - 1 ? save : () => setStep(step + 1)}
          nextLabel={step === STEPS.length - 1 ? (existing ? "Save society" : "Create society") : "Next"}
          nextDisabled={step === 0 ? !detailsDone : step === 1 ? duplicate : false}
          busy={busy}
        />
      )}
    >
      <StepIndicator steps={STEPS} current={step} />

      {/* ------------------------------------------------------- 1. details */}
      {step === 0 ? (
        <>
          <Field label="Society name" value={name} onChangeText={setName} width="wide" />
          <Text style={styles.groupTitle}>Where the society is</Text>
          <FieldRow>
            <Field label="Area / locality" value={address.locality} onChangeText={(v) => set({ locality: v })} width="medium" />
            <Field label="City" value={address.city} onChangeText={(v) => set({ city: v })} width="medium" />
          </FieldRow>
          <FieldRow>
            <Dropdown
              label="State"
              value={address.state || undefined}
              allLabel="Choose a state"
              options={states.map((s) => ({ value: s, label: s }))}
              onChange={(v) => set({ state: v ?? "" })}
              width="medium"
            />
            <Field label="Pincode" value={address.pincode} onChangeText={(v) => set({ pincode: v })} keyboardType="number-pad" width="small" />
          </FieldRow>
          {/* Below the four that identify the society, and marked as optional, so
              the form reads as "where is it" first and "how do I find the gate"
              second. */}
          <Text style={styles.groupTitle}>Finding it (optional)</Text>
          <FieldRow>
            <Field label="Building" value={address.house} onChangeText={(v) => set({ house: v })} width="medium" />
            <Field label="Street / landmark" value={address.street} onChangeText={(v) => set({ street: v })} width="medium" />
          </FieldRow>
          <Text style={styles.hint}>
            The address is kept in its parts rather than as one line, so it can be searched and shown
            properly. A society is a complex rather than a front door, so the building and the street
            are only for finding it. There is no society code: the name is what people use.
          </Text>
        </>
      ) : null}

      {/* -------------------------------------------------------- 2. naming */}
      {step === 1 ? (
        <>
          <Text style={styles.hint}>
            How this society names its towers, floors and flats. It belongs to the society rather
            than to the platform, so two societies may both have a Tower A and neither is a
            duplicate — while one society may never have two.
          </Text>
          <Dropdown
            label="Towers"
            value={naming.tower}
            allowClear={false}
            options={(namingInfo?.styles.tower ?? []).map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => v && setNaming({ ...naming, tower: v as NamingConvention["tower"] })}
            width="wide"
          />
          <Dropdown
            label="Floors"
            value={naming.floor}
            allowClear={false}
            options={(namingInfo?.styles.floor ?? []).map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => v && setNaming({ ...naming, floor: v as NamingConvention["floor"] })}
            width="wide"
          />
          <Dropdown
            label="Flats"
            value={naming.flat}
            allowClear={false}
            options={(namingInfo?.styles.flat ?? []).map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => v && setNaming({ ...naming, flat: v as NamingConvention["flat"] })}
            width="wide"
          />

          {/* Chosen by looking at the result, not by reading a label. */}
          <Text style={styles.groupTitle}>Preview</Text>
          {namingInfo?.preview.length ? namingInfo.preview.map((tower) => (
            <View key={tower.tower} style={{ marginBottom: 8 }}>
              <Text style={styles.previewTower}>{tower.tower}</Text>
              {tower.floors.map((floor) => (
                <Text key={floor.floor} style={styles.previewFloor}>
                  {floor.floor} → {floor.flats.join(", ")}…
                </Text>
              ))}
            </View>
          )) : <Text style={styles.hint}>Loading the preview…</Text>}

          {existing ? (
            <Notice
              tone="warn"
              text="Changing this decides what new towers and flats are called. It does not rename the ones that already exist — renaming somebody's flat under them is a migration rather than a settings change."
            />
          ) : null}
        </>
      ) : null}

      {/* The structure itself, in the same step as how it is named: the towers this
          society has, and the floors and flats of each. What used to be a step of its
          own, so the admin gave the structure once here and confirmed it on the last
          step rather than entering it twice. */}
      {step === 1 ? (
        existing ? (
          // What this society already has, rather than a note saying it is
          // somewhere else. An admin on the Blocks step of an edit is asking what
          // the blocks *are*, and used to be told only where to go and look — so
          // they reached Review without having seen the thing the step is named
          // after, and had no way to tell a name they were about to reuse from one
          // that was free.
          <>
            {existing.blocks?.length ? (
              <DataTable
                columns={[
                  { key: "name", label: "Block", width: 90, render: (b: ExistingBlock) => <Text style={styles.cell}>{b.name}</Text> },
                  { key: "floors", label: "Floors", width: 70, render: (b: ExistingBlock) => <Text style={styles.cell}>{b.floorCount ?? 0}</Text> },
                  { key: "flats", label: "Flats", width: 70, render: (b: ExistingBlock) => <Text style={styles.cell}>{b.flatCount}</Text> },
                  {
                    key: "operator", label: "Operator", width: 160,
                    render: (b: ExistingBlock) => (
                      <Text style={styles.cell} numberOfLines={1}>
                        {b.operators?.length ? b.operators.map((o) => o.fullName ?? "Unnamed").join(", ") : "Nobody yet"}
                      </Text>
                    ),
                  },
                  { key: "status", label: "Status", width: 90, render: (b: ExistingBlock) => <Text style={styles.cell}>{titleCase(b.status)}</Text> },
                ]}
                rows={existing.blocks}
                keyOf={(b: ExistingBlock) => b.id}
              />
            ) : (
              <Notice tone="warn" text="This society has no blocks yet. Operators are assigned to blocks, so its work cannot be given to anybody until it has some." />
            )}
            <Notice text="Blocks are added and renamed from the society's own page, where the operators standing on them can be moved." />
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Add the blocks that belong to this society. Operators are assigned to blocks, so a
              society with none is a society whose work cannot be given to anybody.
            </Text>
            {blocks.map((block, index) => (
              <FieldRow key={block.key}>
                <Field
                  label="Tower"
                  value={block.name}
                  onChangeText={(v) => setBlocks(blocks.map((b) => (b.key === block.key ? { ...b, name: v } : b)))}
                  width="medium"
                />
                <Field
                  label="Floors"
                  value={block.floorCount}
                  onChangeText={(v) => setBlocks(blocks.map((b) => (b.key === block.key ? { ...b, floorCount: v.replace(/[^0-9]/g, "") } : b)))}
                  keyboardType="number-pad"
                  width="small"
                />
                <Field
                  label="Flats"
                  value={block.flatCount}
                  onChangeText={(v) => setBlocks(blocks.map((b) => (b.key === block.key ? { ...b, flatCount: v.replace(/[^0-9]/g, "") } : b)))}
                  keyboardType="number-pad"
                  width="small"
                />
                {blocks.length > 1 ? (
                  <View style={styles.removeCell}>
                    <Button
                      label="Remove"
                      variant="secondary"
                      onPress={() => setBlocks(blocks.filter((b) => b.key !== block.key))}
                    />
                  </View>
                ) : <View key={`gap-${index}`} />}
              </FieldRow>
            ))}
            <View style={styles.addRow}>
              <Button label="+ Add another block" variant="secondary" onPress={() => setBlocks([...blocks, newBlock()])} />
            </View>
            {duplicate ? <Notice tone="warn" text="This society has two blocks with the same name." /> : null}
          </>
        )
      ) : null}

      {/* ------------------------------------------------------- 3. review */}
      {step === 2 ? (
        <>
          <Row label="Society" value={name} />
          <Text style={styles.groupTitle}>Address</Text>
          <Text style={styles.addressLine}>{address.house}</Text>
          <Text style={styles.addressLine}>{address.street}</Text>
          <Text style={styles.addressLine}>{address.locality}</Text>
          <Text style={styles.addressLine}>{address.city}</Text>
          <Text style={styles.addressLine}>{address.state}</Text>
          <Text style={styles.addressLine}>{address.pincode}</Text>
          {existing ? null : (
            <>
              <Text style={styles.groupTitle}>Blocks</Text>
              {named.length
                ? named.map((b) => (
                  <Text key={b.key} style={styles.addressLine}>
                    {b.name}
                    {b.floorCount ? ` · ${b.floorCount} floors` : ""}
                    {b.flatCount ? ` · ${b.flatCount} flats` : ""}
                  </Text>
                ))
                : <Notice tone="warn" text="No blocks yet. Nobody can be assigned work here until there are." />}
            </>
          )}
        </>
      ) : null}

      <ErrorText error={error} />
    </CenteredModal>
  );
}

const styles = themed((theme) => ({
  groupTitle: { fontSize: 13, fontFamily: font.bold, color: theme.deepTeal, marginTop: 12, marginBottom: 6 },
  addressLine: { fontSize: 14, color: theme.slate, paddingVertical: 2 },
  removeCell: { marginBottom: 10, justifyContent: "flex-end" },
  addRow: { marginTop: 4, alignSelf: "flex-start" },
  hint: { fontSize: 12, color: theme.muted, marginTop: 10, lineHeight: 17 },
  cell: { fontSize: 13, color: theme.deepTeal },
  previewTower: { fontSize: 13, fontFamily: font.bold, color: theme.deepTeal },
  previewFloor: { fontSize: 12, color: theme.muted, marginLeft: 10, marginTop: 2 },
}));
