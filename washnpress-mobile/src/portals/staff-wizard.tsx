import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { Area, StaffUser } from "../api/types";
import { Button, ErrorText, Field, FieldRow, Notice, Pill, Row } from "../components/ui";
import { Dropdown } from "../components/filters";
import { CenteredModal, StepIndicator, WizardFooter } from "../components/modal";
import { theme } from "../theme";

// Creating a member of staff, in three steps, in the middle of the screen.
//
// The form used to be another section of the Operator Management page: the listing
// stayed live behind it, so a half-filled form sat above a grid of cards that could
// still be tapped, filtered and scrolled — and tapping one lost what had been typed.
//
// The details it asks for changed too. One box cannot hold a first name and a
// surname without whoever fills it in deciding where the split goes. An employee id
// typed by hand is one that is eventually typed twice. And a phone number nobody has
// checked is a staff account nobody can sign into, which is discovered by the person
// trying to sign in, long after they were told they were set up.

type Role = "supervisor" | "operator";

export interface StaffWizardResult { fullName: string | null; employeeId: string | null }

const STEPS = ["Details", "Assignment", "Review"];

export function StaffWizard({ visible, role, token, areas, regions, fixedAreaId, onClose, onCreated }: {
  visible: boolean;
  role: Role;
  token: string;
  areas: Area[];
  // The states worth offering. Every area belongs to one, and the area list follows
  // from whichever is chosen.
  regions: string[];
  // A supervisor creating an operator works in their own area, so there is nothing
  // to choose: the assignment step says which it is rather than asking.
  fixedAreaId?: string | null;
  onClose: () => void;
  onCreated: (created: StaffWizardResult) => void;
}) {
  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [phoneVerificationId, setPhoneVerificationId] = useState<string | null>(null);
  const [phoneOtp, setPhoneOtp] = useState("");
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);

  const [emailVerificationId, setEmailVerificationId] = useState<string | null>(null);
  const [emailOtp, setEmailOtp] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  const [region, setRegion] = useState<string | undefined>(undefined);
  const [areaId, setAreaId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening it again starts from an empty form rather than from whatever was left
  // behind the last time it was closed.
  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setFirstName(""); setLastName(""); setPhone(""); setEmail("");
    setPhoneVerificationId(null); setPhoneOtp(""); setPhoneSent(false); setPhoneVerified(false);
    setEmailVerificationId(null); setEmailOtp(""); setEmailSent(false); setEmailVerified(false);
    setRegion(undefined); setAreaId(fixedAreaId ?? undefined);
    setError(null); setBusy(false);
  }, [visible, fixedAreaId]);

  const send = async (channel: "phone" | "email") => {
    setError(null);
    try {
      const value = channel === "phone" ? phone.trim() : email.trim();
      const sent = await api.sendVerification(channel, value, token);
      if (channel === "phone") { setPhoneVerificationId(sent.verificationId); setPhoneSent(true); setPhoneVerified(false); }
      else { setEmailVerificationId(sent.verificationId); setEmailSent(true); setEmailVerified(false); }
    } catch (e) { setError((e as Error).message); }
  };

  const confirm = async (channel: "phone" | "email") => {
    setError(null);
    try {
      const id = channel === "phone" ? phoneVerificationId : emailVerificationId;
      const otp = channel === "phone" ? phoneOtp : emailOtp;
      if (!id) return;
      await api.confirmVerification(id, otp.trim(), token);
      if (channel === "phone") setPhoneVerified(true); else setEmailVerified(true);
    } catch (e) { setError((e as Error).message); }
  };

  // Changing a number after it has been proved un-proves it: the confirmation
  // belongs to the value it was obtained for, and the backend refuses it otherwise.
  const changePhone = (next: string) => {
    setPhone(next);
    if (phoneVerified || phoneSent) { setPhoneVerified(false); setPhoneSent(false); setPhoneVerificationId(null); setPhoneOtp(""); }
  };
  const changeEmail = (next: string) => {
    setEmail(next);
    if (emailVerified || emailSent) { setEmailVerified(false); setEmailSent(false); setEmailVerificationId(null); setEmailOtp(""); }
  };

  // Choosing a different state drops an area picked inside the previous one, which
  // the backend would refuse anyway.
  const changeRegion = (next: string | undefined) => {
    setRegion(next);
    setAreaId(undefined);
  };

  const inRegion = areas.filter((a) => !region || a.region === region);
  const chosenArea = areas.find((a) => a.id === areaId) ?? null;

  const detailsDone = firstName.trim().length > 0 && lastName.trim().length > 0
    && phoneVerified && emailVerified;
  const assignmentDone = Boolean(fixedAreaId) || Boolean(region && areaId);

  const create = async () => {
    if (!phoneVerificationId || !emailVerificationId) return;
    setBusy(true); setError(null);
    try {
      const base = {
        firstName: firstName.trim(), lastName: lastName.trim(),
        phone: phone.trim(), email: email.trim(),
        phoneVerificationId, emailVerificationId,
      };
      const created = fixedAreaId
        ? (await api.supCreateOperator(base, token)).operator
        : role === "supervisor"
          ? (await api.adminCreateSupervisor({ ...base, region: region!, areaId: areaId! }, token)).supervisor
          : (await api.adminCreateOperator({ ...base, region: region!, areaId: areaId! }, token)).operator;
      onCreated({ fullName: created.fullName, employeeId: created.employeeId });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const noun = role === "supervisor" ? "supervisor" : "operator";
  const dirty = Boolean(firstName || lastName || phone || email || region || (areaId && !fixedAreaId));

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

          <View style={styles.block}>
            <FieldRow>
              <Field label="Phone number" value={phone} onChangeText={changePhone} keyboardType="phone-pad" width="medium" />
              {phoneVerified ? null : (
                <View style={styles.action}>
                  <Button
                    label={phoneSent ? "Resend code" : "Send code"}
                    variant="secondary"
                    disabled={phone.trim().length !== 10}
                    onPress={() => send("phone")}
                  />
                </View>
              )}
            </FieldRow>
            {phoneVerified ? (
              <Pill text="Number verified" color={theme.success} />
            ) : phoneSent ? (
              <FieldRow>
                <Field label="Code sent by SMS" value={phoneOtp} onChangeText={setPhoneOtp} keyboardType="number-pad" width="small" />
                <View style={styles.action}>
                  <Button label="Verify" onPress={() => confirm("phone")} disabled={phoneOtp.trim().length < 4} />
                </View>
              </FieldRow>
            ) : null}
          </View>

          <View style={styles.block}>
            <FieldRow>
              <Field label="Email" value={email} onChangeText={changeEmail} keyboardType="email-address" width="wide" />
              {emailVerified ? null : (
                <View style={styles.action}>
                  <Button
                    label={emailSent ? "Resend code" : "Send code"}
                    variant="secondary"
                    disabled={!email.includes("@")}
                    onPress={() => send("email")}
                  />
                </View>
              )}
            </FieldRow>
            {emailVerified ? (
              <Pill text="Email verified" color={theme.success} />
            ) : emailSent ? (
              <FieldRow>
                <Field label="Code sent by email" value={emailOtp} onChangeText={setEmailOtp} keyboardType="number-pad" width="small" />
                <View style={styles.action}>
                  <Button label="Verify" onPress={() => confirm("email")} disabled={emailOtp.trim().length < 4} />
                </View>
              </FieldRow>
            ) : null}
          </View>

          {!detailsDone ? (
            <Text style={styles.hint}>
              Both the number and the address have to be verified before the account can be created.
              An unverified account is one nobody can sign into.
            </Text>
          ) : null}
        </>
      ) : null}

      {/* ---------------------------------------------------- 2. assignment */}
      {step === 1 ? (
        fixedAreaId ? (
          <Notice text={`This ${noun} will work in ${chosenArea?.name ?? "your area"}, which is the area you run.`} />
        ) : (
          <>
            {/* The state comes first and the area list follows from it. */}
            <Dropdown
              label="Location / region"
              value={region}
              allLabel="Choose a state"
              options={regions.map((r) => ({ value: r, label: r }))}
              onChange={changeRegion}
              width="full"
            />
            <Dropdown
              label="Area"
              value={areaId}
              allLabel={region ? "Choose an area" : "Choose a state first"}
              options={inRegion.map((a) => ({ value: a.id, label: a.name }))}
              onChange={setAreaId}
              disabled={!region}
              hint={region ? undefined : "The area depends on the state."}
              width="full"
            />
            {region && inRegion.length === 0 ? (
              <Notice tone="warn" text={`There are no areas in ${region} yet. Create one from Areas first.`} />
            ) : null}
            {role === "supervisor" ? (
              <Text style={styles.hint}>
                No societies are chosen here. Which societies a supervisor covers follows from the
                area they are given, and is set from Societies.
              </Text>
            ) : null}
          </>
        )
      ) : null}

      {/* -------------------------------------------------------- 3. review */}
      {step === 2 ? (
        <>
          <Row label="First name" value={firstName} />
          <Row label="Last name" value={lastName} />
          <Row label="Phone" value={`${phone}  ·  verified`} />
          <Row label="Email" value={`${email}  ·  verified`} />
          <Row label="Location / region" value={chosenArea?.region ?? region} />
          <Row label="Area" value={chosenArea?.name} />
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
    paddingTop: 10, marginTop: 6,
  },
  action: { marginBottom: 10, justifyContent: "flex-end" },
  hint: { fontSize: 12, color: theme.muted, marginTop: 10, lineHeight: 17 },
});
