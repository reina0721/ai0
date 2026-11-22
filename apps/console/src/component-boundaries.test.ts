import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const sourceRoot = import.meta.dirname;
const browserDialogs = new Set(["alert", "confirm", "prompt"]);

it("keeps selection menus and business dialogs inside the console design system", () => {
  const violations: string[] = [];

  for (const entry of readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name) || /\.(test|spec)\.tsx?$/u.test(entry.name)) continue;

    const path = resolve(entry.parentPath, entry.name);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const record = (node: ts.Node, reason: string) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push(`${relative(sourceRoot, path)}:${line + 1} ${reason}`);
    };

    function inspect(node: ts.Node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.includes("/NativeSelect")) {
        record(node, "Use CompactSelect with an in-app option menu.");
      }

      if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === "NativeSelect") {
        record(node, "Use CompactSelect with an in-app option menu.");
      }

      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (tag === "select" || tag === "datalist" || /(^|\.)NativeSelect$/u.test(tag)) {
          record(node, "Use CompactSelect with an in-app option menu.");
        }
        const native = node.attributes.properties.find(
          (attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "native"
        );
        if (/(^|\.)Select$/u.test(tag) && native &&
            !(native.initializer && ts.isJsxExpression(native.initializer) && native.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword)) {
          record(native, "The MUI Select menu must stay in the console DOM.");
        }
      }

      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const firstArgument = node.arguments[0];
        if (/(^|\.)createElement$/u.test(callee.getText(source)) && firstArgument &&
            ts.isStringLiteral(firstArgument) && (firstArgument.text === "select" || firstArgument.text === "datalist")) {
          record(node, "Use CompactSelect with an in-app option menu.");
        }
        if ((ts.isIdentifier(callee) && browserDialogs.has(callee.text)) ||
            (ts.isPropertyAccessExpression(callee) && browserDialogs.has(callee.name.text) &&
             /^(window|globalThis|self)$/u.test(callee.expression.getText(source)))) {
          record(node, "Use an in-app Dialog for business actions.");
        }
      }

      ts.forEachChild(node, inspect);
    }

    inspect(source);
  }

  expect(violations).toEqual([]);
});
