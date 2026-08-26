import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { OnboardingStatus } from "../api/types";
import { Screen, PageTitle, SectionTitle, Field, Button, ErrorText, Notice, Loading } from "../components/ui";
import { Dropdown } from "../components/filters";

// A newly registered resident completes their profile before the rest of the app
// becomes usable. Once complete they are never asked again: the backend records
// the onboarding flag and the session is reissued with the resident scope.
export function OnboardingScreen({ token, onComplete }: { token: string; onComplete: (nextToken: string | null) => void }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [unitNumber, setUnitNumber] = useState("");
  const [towerBlock, setTowerBlock] = useState("");
  const [blockId, setBlockId] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.onboardingStatus(token);
      setStatus(r);
      if (r.completed) onComplete(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, onComplete]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!societyId) { setError("Choose your society."); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.completeOnboarding({
        fullName, societyId, unitNumber,
        email: email || undefined,
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
  const canSubmit = fullName.trim().length >= 2 && Boolean(societyId) && unitNumber.trim().length > 0 && (pickupAddress.trim() || address.trim()).length > 0;

  return (
    <Screen>
      <PageTitle title="Complete your profile" subtitle="A few details before your first pickup" />
      <Notice text="We need these details so the operations team can collect and return your garments." />
      <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Anusha" />
      <Field label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" />

      <Dropdown
        label="Society"
        value={societyId ?? undefined}
        allLabel="Choose your society"
        options={(status?.societies ?? []).map((sc) => ({ value: sc.id, label: sc.name }))}
        onChange={(id) => { setSocietyId(id ?? null); setBlockId(null); }}
      />

      {/* Which block somebody lives in decides who collects from them, so it is
          chosen from the towers that exist rather than typed. A society whose
          blocks have not been set up yet still accepts a written answer. */}
      {blocks.length ? (
        <Dropdown
          label="Tower / block"
          value={blockId ?? undefined}
          allLabel="Choose your block"
          options={blocks.map((b) => ({ value: b.id, label: b.name }))}
          onChange={(id) => setBlockId(id ?? null)}
          disabled={!societyId}
          hint={societyId ? undefined : "Choose your society first."}
        />
      ) : (
        <Field label="Tower / block (optional)" value={towerBlock} onChangeText={setTowerBlock} placeholder="A" />
      )}
      <Field label="Flat / unit number" value={unitNumber} onChangeText={setUnitNumber} placeholder="A-402" width="medium" />
      <Field label="Address" value={address} onChangeText={setAddress} placeholder="A-402, My Home Bhooja, Kavuri Hills" />
      <Field label="Pickup address" value={pickupAddress} onChangeText={setPickupAddress} placeholder="Same as address if left blank" />

      <Button label="Complete onboarding" onPress={submit} disabled={!canSubmit || busy} />
      <ErrorText error={error} />
    </Screen>
  );
}
