import { useEffect, useState } from "react";
import { themed } from "../components/themed";
import { View, Text, TouchableOpacity, StyleSheet, TextInput } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { theme, space, type, radius, border, size } from "../theme";

// Scans a QR batch code with the device camera. If permission is denied or the camera
// is unavailable, the operator can type the batch code by hand, which matches the
// manual fallback required by the specification.
export function QrScannerScreen({ onScanned, onBack }: { onScanned: (code: string) => void; onBack: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [scanned, setScanned] = useState(false);

  useEffect(() => { if (!permission) requestPermission(); }, [permission]);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>Back</Text></TouchableOpacity>
      <Text style={styles.h1}>Scan the batch QR</Text>
      {permission?.granted ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => { if (!scanned) { setScanned(true); onScanned(data); } }}
          />
        </View>
      ) : (
        <Text style={styles.hint}>Camera permission is not granted. Enter the batch code by hand.</Text>
      )}
      <Text style={styles.label}>Or enter the batch code</Text>
      <TextInput style={styles.input} value={manual} onChangeText={setManual} autoCapitalize="characters" placeholder="WNP-XXXXXXXX" />
      <TouchableOpacity style={styles.button} onPress={() => manual && onScanned(manual)}>
        <Text style={styles.buttonText}>Use this code</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = themed((theme) => ({
  container: { flex: 1, backgroundColor: theme.surface.page, padding: space.page },
  back: { ...type.body, color: theme.text.link, marginBottom: space.snug, minHeight: size.control.sm },
  h1: { ...type.title, color: theme.text.primary },
  cameraWrap: {
    height: 260, borderRadius: radius.lg, overflow: "hidden", marginTop: space.page,
    borderWidth: border.hairline, borderColor: theme.line.subtle,
  },
  camera: { flex: 1 },
  hint: { ...type.body, color: theme.text.secondary, marginTop: space.page },
  label: { ...type.caption, color: theme.text.tertiary, marginTop: space.section, marginBottom: space.tight },
  input: {
    backgroundColor: theme.surface.card, borderRadius: radius.md,
    minHeight: size.control.md, paddingHorizontal: space.base,
    ...type.body, borderWidth: border.hairline, borderColor: theme.line.strong,
    color: theme.text.primary,
  },
  button: {
    backgroundColor: theme.action.primary, borderRadius: radius.md,
    minHeight: size.control.md, justifyContent: "center",
    marginTop: space.page, alignItems: "center",
  },
  buttonText: { ...type.bodyStrong, color: theme.text.onAction },
}));
