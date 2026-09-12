import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { OnboardingStatus } from "../api/types";
import { Screen, PageTitle, SectionTitle, Field, FieldRow, Button, ErrorText, Notice, Loading, Row } from "../components/ui";
import { Dropdown } from "../components/filters";
import { todayIso } from "../components/calendar";
import { dateOfBirthFrom, emailProblem, isEmail } from "../contact-rules";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const MONTH_OPTIONS = MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }));
// Newest first: most people signing up were born in the last few decades.
const YEAR_OPTIONS = Array.from({ length: new Date().getFullYear() - 1899 }, (_, i) => {
  const year = String(new Date().getFullYear() - i);
  return { value: year, label: year };
});

// A newly registered resident completes their profile before the rest of the app
// becomes usable. Once complete they are never asked again: the backend records
// the onboarding flag and the session is reissued with the resident scope.
export function OnboardingScreen({ token, onComplete }: { token: string; onComplete: (nextToken: string | null) => void }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  // The number the code was just sent to, shown rather than asked for again.
  const [phone, setPhone] = useState("");
  const [dobDay, setDobDay] = useState<string | undefined>(undefined);
  const [dobMonth, setDobMonth] = useState<string | undefined>(undefined);
  const [dobYear, setDobYear] = useState<string | undefined>(undefined);
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [unitNumber, setUnitNumber] = useState("");
  const [towerBlock, setTowerBlock] = useState("");
  const [blockId, setBlockId] = useState<string | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [address, setAddress] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Whether it was the *load* that failed, as opposed to the submit. Only a failed
  // load is worth a retry button: the lists this screen needs never arrived, so the
  // society dropdown is empty for a reason that has nothing to do with the resident.
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.onboardingStatus(token);
      setStatus(r);
      setLoadFailed(false);
      if (r.completed) onComplete(null);
      // Only for display; the form does not need it to be submitted.
      api.me(token).then((m) => setPhone(m.user.phone)).catch(() => {});
    } catch {
      setLoadFailed(true);
      setError("Unable to load onboarding information. Please try again.");
    }
    finally { setBusy(false); }
  }, [token, onComplete]);
  useEffect(() => { load(); }, [load]);

  const dateOfBirth = dateOfBirthFrom(dobYear, dobMonth, dobDay, todayIso());

  const submit = async () => {
    if (!societyId) { setError("Choose your society."); setLoadFailed(false); return; }
    if (!dateOfBirth) { setError("Choose a real date of birth."); setLoadFailed(false); return; }
    setBusy(true); setError(null); setLoadFailed(false);
    try {
      const r = await api.completeOnboarding({
        fullName, societyId, unitNumber,
        email: email.trim(),
        dateOfBirth,
        blockId: blockId || undefined,
        towerBlock: towerBlock || undefined,
        address: address || undefined, pickupAddress: pickupAddress || address || undefined,
      }, token);
      onComplete(r.token);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (busy && !status) return <Loading />;

  // The blocks of whichever society is chosen. A society with none set up yet asks
  // for the block in writing instead.
  const blocks = status?.societies.find((sc) => sc.id === societyId)?.blocks ?? [];
  const block = blocks.find((b) => b.id === blockId) ?? null;
  // The real, available Floor → Flat structure (I-74), from the backend. Floors are
  // the distinct floors that have an available flat; flats are those on the chosen
  // floor. A tower with a configured structure is validated against these exact
  // numbers; one without still takes a written answer.
  const blockFlats = block?.flats ?? [];
  const floorOptions = [...new Set(blockFlats.map((f) => f.floor))].sort((a, b) => a - b);
  const flatOptions = blockFlats.filter((f) => floor !== null && f.floor === floor).map((f) => f.number);
  const hasStructure = blockFlats.length > 0;
  const unitAnswered = hasStructure ? Boolean(unitNumber && flatOptions.includes(unitNumber)) : unitNumber.trim().length > 0;
  // Onboarding asked for an address and checked nothing, so a resident could set one
  // here that the profile screen would later refuse to save.
  const emailError = emailProblem(email);
  const canSubmit = fullName.trim().length >= 2 && Boolean(societyId) && unitAnswered
    && isEmail(email) && Boolean(dateOfBirth) && (pickupAddress.trim() || address.trim()).length > 0;
  // All three chosen and still not a date: 31 April, or a day that has not happened yet.
  const dobError = dobDay && dobMonth && dobYear && !dateOfBirth ? "Choose a real date of birth in the past." : null;

  return (
    <Screen>
      <PageTitle title="Complete your profile" subtitle="A few details before your first pickup" />
      <Notice text="We need these details so the operations team can collect and return your garments." />
      <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Anusha" />
      <Row label="Mobile number" value={phone} hint="Verified with the code we sent" figure />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="you@example.com" />
      {emailError ? <Notice tone="warn" text={emailError} /> : null}
      <FieldRow>
        <Dropdown label="Day of birth" value={dobDay} allLabel="Day" allowClear={false} width="small"
          options={DAY_OPTIONS} onChange={setDobDay} />
        <Dropdown label="Month" value={dobMonth} allLabel="Month" allowClear={false}
          options={MONTH_OPTIONS} onChange={setDobMonth} />
        <Dropdown label="Year" value={dobYear} allLabel="Year" allowClear={false} width="small"
          options={YEAR_OPTIONS} onChange={setDobYear} />
      </FieldRow>
      {dobError ? <Notice tone="warn" text={dobError} /> : null}

      <Dropdown
        label="Society"
        value={societyId ?? undefined}
        allLabel="Choose your society"
        options={(status?.societies ?? []).map((sc) => ({ value: sc.id, label: sc.name }))}
        // A different society means a different set of towers, so everything
        // chosen beneath it goes with it.
        onChange={(id) => { setSocietyId(id ?? null); setBlockId(null); setFloor(null); setUnitNumber(""); }}
      />

      {/* Tower, then floor, then flat — each list drawn from the one above it.
          Which flat somebody lives in decides who collects from them, and it used
          to be typed: "A-402", "402", "Flat 402" and "a 402" all arrived, none of
          them checked against the tower that had just been chosen. The floors and
          the flats come from the structure the supervisor configured, so a tower
          with ten floors and forty flats offers ten floors and four flats on each,
          and changing the tower changes them.

          A society whose towers have not been set up yet still takes a written
          answer, because refusing to onboard somebody over a structure their
          supervisor has not built yet would be the app's problem, not theirs. */}
      {blocks.length ? (
        <>
          <Dropdown
            label="Tower / block"
            value={blockId ?? undefined}
            allLabel="Choose your tower"
            options={blocks.map((b) => ({ value: b.id, label: b.name }))}
            onChange={(id) => {
              // A floor and a flat chosen under the old tower may not exist under
              // the new one, so they go rather than silently becoming wrong.
              setBlockId(id ?? null); setFloor(null); setUnitNumber("");
            }}
            disabled={!societyId}
            hint={societyId ? undefined : "Choose your society first."}
          />
          {block && hasStructure ? (
            <>
              <Dropdown
                label="Floor"
                value={floor !== null ? String(floor) : undefined}
                allLabel="Choose your floor"
                options={floorOptions.map((f) => ({ value: String(f), label: `Floor ${f}` }))}
                onChange={(next) => { setFloor(next ? Number(next) : null); setUnitNumber(""); }}
                disabled={!blockId}
                hint={blockId ? undefined : "Choose your tower first."}
              />
              <Dropdown
                label="Flat"
                value={unitNumber || undefined}
                allLabel="Choose your flat"
                options={flatOptions.map((f) => ({ value: f, label: f }))}
                onChange={(next) => setUnitNumber(next ?? "")}
                disabled={floor === null}
                hint={floor === null ? "Choose your floor first." : undefined}
              />
            </>
          ) : block ? (
            <Field label="Flat / unit number" value={unitNumber} onChangeText={setUnitNumber} placeholder="A-402" width="medium" />
          ) : null}
        </>
      ) : (
        <>
          <Field label="Tower / block (optional)" value={towerBlock} onChangeText={setTowerBlock} placeholder="A" />
          <Field label="Flat / unit number" value={unitNumber} onChangeText={setUnitNumber} placeholder="A-402" width="medium" />
        </>
      )}
      <Field label="Address" value={address} onChangeText={setAddress} placeholder="A-402, My Home Bhooja, Kavuri Hills" />
      <Field label="Pickup address" value={pickupAddress} onChangeText={setPickupAddress} placeholder="Same as address if left blank" />

      <Button label="Complete onboarding" onPress={submit} disabled={!canSubmit || busy} />
      <ErrorText error={error} onRetry={loadFailed ? load : undefined} />
    </Screen>
  );
}
