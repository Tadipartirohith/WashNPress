import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import { Button, ErrorText, Field, FieldRow, Notice, Row } from "../components/ui";
import { Dropdown } from "../components/filters";
import { CenteredModal, StepIndicator, WizardFooter } from "../components/modal";
import { font, theme } from "../theme";

// Creating a member of staff, in three steps, in the middle of the screen.
//
// The form used to be another section of the management page: the listing stayed
// live behind it, so a half-filled form sat above a grid of cards that could still
// be tapped, filtered and scrolled — and tapping one lost what had been typed.
//
// What it asks for has changed twice over. One box cannot hold a first name and a
// surname without whoever fills it in deciding where the split goes, and an employee
// id typed by hand is one that is eventually typed twice; both of those are settled.
//
// The verification codes are gone. Creating an account and authenticating as that
// account are two different things, and running them together meant whoever filled
// in this form had to hold an OTP sent to somebody else's phone before the account
// could exist at all. The number is proved by the person who owns it, with the code
// they receive the first time they sign in.

type Role = "supervisor" | "operator";

export interface StaffWizardResult { fullName: string | null; employeeId: string | null }

export interface SocietyChoice { id: string; name: string; supervisorUserId?: string | null }
export interface BlockChoice { id: string; name: string; flatCount?: number }

const STEPS = ["Details", "Assignment", "Review"];

export function StaffWizard({
  visible, role, token, societies, blocks, fixedSocietyId, fixedSocietyName, onClose, onCreated,
}: {
  visible: boolean;
  role: Role;
  token: string;
  // Where this person can be put. For a supervisor, one society each: a society
  // already run by somebody is named as taken rather than hidden, so an admin sees
  // why it cannot be chosen instead of wondering where it went.
  societies: SocietyChoice[];
  // For an operator: the towers of the chosen society. Blocks are the assignment
  // rather than a narrowing of one, so an operator with none has no work.
  blocks?: BlockChoice[];
  // A supervisor creating an operator works in their own society, so there is
  // nothing to choose: the assignment step says which it is rather than asking.
  fixedSocietyId?: string | null;
  fixedSocietyName?: string | null;
  onClose: () => void;
  onCreated: (created: StaffWizardResult) => void;
}) {
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [societyId, setSocietyId] = useState<string | undefined>(undefined);
  const [blockIds, setBlockIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening it again starts from an empty form rather than from whatever was left
  // behind the last time it was closed.
  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setFirstName(""); setLastName(""); setPhone(""); setEmail("");
    setSocietyId(fixedSocietyId ?? undefined);
    setBlockIds([]);
    setError(null); setBusy(false);
  }, [visible, fixedSocietyId]);

  const noun = role === "supervisor" ? "supervisor" : "operator";
  const chosenSociety = societies.find((s) => s.id === societyId) ?? null;
  const societyName = fixedSocietyName ?? chosenSociety?.name ?? null;
  // The towers of whichever society was chosen. A block belonging to another
  // society is a wider permission, not a narrower one, so it is not offered.
  const available = (blocks ?? []).filter(() => Boolean(societyId));

  const toggleBlock = (id: string) => {
    setBlockIds((current) => (current.includes(id) ? current.filter((b) => b !== id) : [...current, id]));
  };

  // An email is what a supervisor is sent things at; they are reached on their
  // phone and sign in with it. An operator's is asked for.
  const emailRequired = role === "operator";
  const detailsDone = firstName.trim().length > 0 && lastName.trim().length > 0
    && /^[6-9][0-9]{9}$/.test(phone.trim())
    && (emailRequired ? email.includes("@") : !email.trim() || email.includes("@"));
  const assignmentDone = Boolean(societyId);

  const create = async () => {
    if (!societyId) return;
    setBusy(true); setError(null);
    try {
      const base = {
        firstName: firstName.trim(), lastName: lastName.trim(),
        phone: phone.trim(), email: email.trim(),
      };
      const created = fixedSocietyId
        ? (await api.supCreateOperator({ ...base, blockIds }, token)).operator
        : role === "supervisor"
          ? (await api.adminCreateSupervisor({
            ...base, email: base.email || undefined, societyId,
          }, token)).supervisor
          : (await api.adminCreateOperator({ ...base, societyId, blockIds }, token)).operator;
      onCreated({ fullName: created.fullName, employeeId: created.employeeId });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const dirty = Boolean(firstName || lastName || phone || email
    || blockIds.length || (societyId && !fixedSocietyId));

  return (
    <CenteredModal
      visible={visible}
      title={`New ${noun}`}
      subtitle={STEPS[step]}
      onClose={onClose}
      width="wide"
      dirty={dirty}
      discardMessage={`Are you sure you want to discard the ${noun} details?`}
      footer={(
        <WizardFooter
          onBack={step > 0 ? () => setStep(step - 1) : undefined}
          onNext={step === 2 ? create : () => setStep(step + 1)}
          nextLabel={step === 2 ? `Create ${noun}` : "Next"}
          nextDisabled={step === 0 ? !detailsDone : step === 1 ? !assignmentDone : false}
          busy={busy}
        />
      )}
    >
      <StepIndicator steps={STEPS} current={step} />

      {/* ------------------------------------------------------- 1. details */}
      {step === 0 ? (
        <>
          <FieldRow>
            <Field label="First name" value={firstName} onChangeText={setFirstName} width="medium" />
            <Field label="Last name" value={lastName} onChangeText={setLastName} width="medium" />
          </FieldRow>
          <FieldRow>
            <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" width="medium" />
            <Field
              label={emailRequired ? "Email" : "Email (optional)"}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              width="wide"
            />
          </FieldRow>
          <Text style={styles.hint}>
            There is no code to send. The {noun} proves this number themselves, with the OTP they
            receive the first time they sign in.
          </Text>
        </>
      ) : null}

      {/* ---------------------------------------------------- 2. assignment */}
      {step === 1 ? (
        <>
          {fixedSocietyId ? (
            <Notice text={`This operator will work in ${societyName ?? "your society"}, which is the society you run.`} />
          ) : (
            <Dropdown
              label="Society"
              value={societyId}
              allLabel="Choose a society"
              options={societies.map((s) => ({
                value: s.id,
                // Named rather than hidden: an admin should see why a society
                // cannot be chosen instead of wondering where it went.
                label: role === "supervisor" && s.supervisorUserId ? `${s.name} · already run` : s.name,
              }))}
              onChange={(next) => { setSocietyId(next); setBlockIds([]); }}
              width="full"
            />
          )}

          {role === "operator" ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Assign blocks</Text>
              <Text style={styles.hint}>
                An operator reaches the blocks named here and nothing else. One with none has no work
                until somebody gives them a tower.
              </Text>
              <View style={styles.blockList}>
                {available.map((b) => (
                  <View key={b.id} style={styles.blockItem}>
                    <Button
                      label={b.name}
                      selected={blockIds.includes(b.id)}
                      variant={blockIds.includes(b.id) ? "primary" : "secondary"}
                      onPress={() => toggleBlock(b.id)}
                    />
                  </View>
                ))}
              </View>
              {societyId && available.length === 0 ? (
                <Notice tone="warn" text="That society has no blocks yet. Add them from Societies first." />
              ) : null}
            </View>
          ) : (
            <Text style={styles.hint}>
              A supervisor runs exactly one society, and the whole of it. Which operators cover which
              towers inside it is theirs to decide.
            </Text>
          )}
        </>
      ) : null}

      {/* -------------------------------------------------------- 3. review */}
      {step === 2 ? (
        <>
          <Row label="First name" value={firstName} />
          <Row label="Last name" value={lastName} />
          <Row label="Phone" value={phone} />
          <Row label="Email" value={email || "—"} />
          <Row label="Society" value={societyName ?? "—"} />
          {role === "operator" ? (
            <Row
              label="Assigned blocks"
              value={blockIds.length
                ? available.filter((b) => blockIds.includes(b.id)).map((b) => b.name).join(", ")
                : "None yet"}
            />
          ) : null}
          {/* Generated when the account is made, so there is nothing to show yet
              and nothing for anybody to type. */}
          <Row label="Employee ID" value="Generated on creation" />
        </>
      ) : null}

      <ErrorText error={error} />
    </CenteredModal>
  );
}

const styles = StyleSheet.create({
  block: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
    paddingTop: 10, marginTop: 10,
  },
  blockTitle: { fontSize: 14, fontFamily: font.bold, color: theme.deepTeal },
  blockList: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, marginHorizontal: -4 },
  blockItem: { minWidth: 130, paddingHorizontal: 4, marginBottom: 8 },
  hint: { fontSize: 12, color: theme.muted, marginTop: 10, lineHeight: 17 },
});
