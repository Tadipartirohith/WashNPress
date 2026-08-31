#!/usr/bin/env node
// No pressable may be an ancestor of a text field.
//
// React Native Web turns every pressable into a keyboard-activatable control.
// Its key handler, in react-native-web/dist/modules/usePressEvents/PressResponder.js:
//
//   isValidKeyPress = event => key === 'Enter' || (isSpacebar && isButtonish)
//
// fires on `Enter` from *any* descendant, and on `Space` from any descendant
// carrying a button role — which every select, chip and stepper in these forms
// does. React's synthetic events bubble, so a dismissing backdrop wrapped around
// a form claims those keys from the form.
//
// That is what made pressing Space while typing "Carpet cleaning" ask whether to
// discard the record, and pressing Enter between fields close the form outright.
// The fix is structural rather than a handler tweak: the dismissing layer is a
// *sibling* of the panel, absolutely positioned behind it, so nothing inside the
// panel has a pressable ancestor to bubble into.
//
// This walks the real syntax tree — not a regex over the text — and fails if any
// pressable with an onPress has a TextInput anywhere beneath it.
//
//   node scripts/verify-modal-dismiss.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "src");

const PRESSABLE = new Set(["Pressable", "TouchableOpacity", "TouchableHighlight", "TouchableWithoutFeedback"]);
const FIELD = new Set(["TextInput"]);

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function tagName(node) {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return tag.getText(node.getSourceFile());
}

function hasOnPress(node) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  return opening.attributes.properties.some(
    (p) => ts.isJsxAttribute(p) && p.name.getText(node.getSourceFile()) === "onPress",
  );
}

const findings = [];

for (const file of files(src)) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Walk carrying the nearest enclosing pressable-with-onPress, if any.
  const walk = (node, guard) => {
    let next = guard;
    if (ts.isJsxElement(node)) {
      const name = tagName(node);
      if (PRESSABLE.has(name) && hasOnPress(node)) {
        next = next ?? { name, pos: node.getStart() };
      } else if (FIELD.has(name) && guard) {
        findings.push({ file, node: name, guard, at: node.getStart() });
      }
    } else if (ts.isJsxSelfClosingElement(node)) {
      const name = tagName(node);
      if (FIELD.has(name) && guard) {
        findings.push({ file, node: name, guard, at: node.getStart() });
      }
    }
    node.forEachChild((child) => walk(child, next));
  };

  walk(source, null);

  for (const finding of findings.filter((f) => f.file === file)) {
    const { line } = source.getLineAndCharacterOfPosition(finding.at);
    const guardLine = source.getLineAndCharacterOfPosition(finding.guard.pos).line;
    finding.where = `${relative(root, file).replace(/\\/g, "/")}:${line + 1}`;
    finding.guardWhere = `${relative(root, file).replace(/\\/g, "/")}:${guardLine + 1}`;
  }
}

console.log("No pressable wraps a text field\n");

if (findings.length === 0) {
  console.log(`  pass  every text field is clear of a pressable ancestor`);
  console.log("\nAll checks passed.");
  process.exit(0);
}

for (const f of findings) {
  console.log(`  FAIL  ${f.where} — ${f.node} sits inside <${f.guard.name} onPress> at ${f.guardWhere}`);
}
console.log(
  `\n${findings.length} text field(s) have a pressable ancestor. On web that ancestor claims Enter\n` +
    `from the field and Space from any button-role sibling. Make the pressable a sibling of the\n` +
    `content instead — absolutely positioned behind it — rather than its parent.`,
);
process.exit(1);
