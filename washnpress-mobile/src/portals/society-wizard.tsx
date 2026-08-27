import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { Society, SocietyAddress } from "../api/types";
import { Button, ErrorText, Field, FieldRow, Notice, Row } from "../components/ui";
import { Dropdown } from "../components/filters";
import { CenteredModal, StepIndicator, WizardFooter } from "../components/modal";
import { theme } from "../theme";

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

const STEPS = ["Details", "Blocks", "Review"];

const EMPTY: SocietyAddress = {
  house: "", street: "", locality: "", city: "", state: "", pincode: "",
};

interface DraftBlock { key: string; name: string; floorCount: string; flatCount: string }

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
    setError(null); setBusy(false);
  }, [visible, existing]);

  const set = (part: Partial<SocietyAddress>) => setAddress((current) => ({ ...current, ...part }));

  const named = blocks.filter((b) => b.name.trim());
  const detailsDone = name.trim().length > 1
    && Boolean(address.house.trim() && address.street.trim() && address.locality.trim())
    && Boolean(address.city.trim() && address.state.trim())
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
        blocks: named.map((b) => ({
          name: b.name.trim(),
          ...(Number(b.floorCount) > 0 ? { floorCount: Number(b.floorCount) } : {}),
          ...(Number(b.flatCount) > 0 ? { flatCount: Number(b.flatCount) } : {}),
        })),
      };
      // Editing does not rewrite the blocks: they are added and renamed from the
      // society's own page, where the operators standing on them are visible.
      const saved = existing
        ? (await api.adminUpdateSociety(existing.id, { name: body.name, address: body.address }, token)).society
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
          onNext={step === 2 ? save : () => setStep(step + 1)}
          nextLabel={step === 2 ? (existing ? "Save society" : "Create society") : "Next"}
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
          <Text style={styles.groupTitle}>Address</Text>
          <FieldRow>
            <Field label="House / building" value={address.house} onChangeText={(v) => set({ house: v })} width="medium" />
            <Field label="Street" value={address.street} onChangeText={(v) => set({ street: v })} width="medium" />
          </FieldRow>
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
          <Text style={styles.hint}>
            The address is kept in its parts rather than as one line, so it can be searched and shown
            properly. There is no society code: the name is what people use.
          </Text>
        </>
      ) : null}

      {/* -------------------------------------------------------- 2. blocks */}
      {step === 1 ? (
        existing ? (
          <Notice text="Blocks are added and renamed from the society's own page, where the operators standing on them are visible." />
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

      {/* -------------------------------------------------------- 3. review */}
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

const styles = StyleSheet.create({
  groupTitle: { fontSize: 13, fontWeight: "700", color: theme.deepTeal, marginTop: 12, marginBottom: 6 },
  addressLine: { fontSize: 14, color: theme.slate, paddingVertical: 2 },
  removeCell: { marginBottom: 10, justifyContent: "flex-end" },
  addRow: { marginTop: 4, alignSelf: "flex-start" },
  hint: { fontSize: 12, color: theme.muted, marginTop: 10, lineHeight: 17 },
});
