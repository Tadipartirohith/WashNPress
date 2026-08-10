import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { theme } from "../theme";

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 20 },
  back: { color: theme.aqua, fontSize: 16, marginBottom: 8 },
  h1: { fontSize: 22, fontWeight: "800", color: theme.deepTeal },
  cameraWrap: { height: 260, borderRadius: 12, overflow: "hidden", marginTop: 16 },
  camera: { flex: 1 },
  hint: { color: theme.slate, marginTop: 16 },
  label: { fontSize: 13, color: theme.slate, marginTop: 20, marginBottom: 6 },
  input: { backgroundColor: "#fff", borderRadius: 10, padding: 14, fontSize: 16, borderWidth: 1, borderColor: "#ddd" },
  button: { backgroundColor: theme.aqua, borderRadius: 10, padding: 16, marginTop: 16, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700" },
});
