#!/usr/bin/env bun
/**
 * This script generates a map from ProtocolMessage_Type enum values
 * to their corresponding file paths and export names.
 *
 * Example:
 * ProtocolMessage_Type.DEVICE_INFO_MESSAGE = 15
 * -> { pathname: 'src/protocols/mrp/generated/DeviceInfoMessage.ts', exportName: 'deviceInfoMessage' }
 */

import { Project } from "ts-morph";
import { writeFileSync } from "fs";
import { join, basename } from "path";
import { format, resolveConfig } from "prettier";
interface MessageTypeMapEntry {
  pathname: string;
  exportName: string;
}
// New messages reusing inner message of another type
const REUSED_MESSAGES: Record<string, string> = {
  DEVICE_INFO_UPDATE_MESSAGE: "DEVICE_INFO_MESSAGE",
};
// Messages where the extension should NOT be set (type-only messages with string extensions)
// These messages only need the ProtocolMessage.type set, not the extension field
const SKIP_EXTENSION_MESSAGES = new Set(["GET_KEYBOARD_SESSION_MESSAGE"]);

type MessageTypeMap = Record<string, MessageTypeMapEntry>;

function convertEnumNameToFileName(enumName: string): string {
  const adjustedEnumName = REUSED_MESSAGES[enumName] || enumName;

  // Remove _MESSAGE suffix if present
  const withoutSuffix = adjustedEnumName.replace(/_MESSAGE$/, "");

  // Split by underscore and convert to PascalCase
  const words = withoutSuffix.split("_");
  const pascalCase = words
    .map((word) => {
      if (word === "HID") {
        return "HID";
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");

  return `${pascalCase}Message`;
}

function convertEnumNameToExportName(enumName: string): string {
  const adjustedEnumName = REUSED_MESSAGES[enumName] || enumName;

  // Remove _MESSAGE suffix if present
  const withoutSuffix = adjustedEnumName.replace(/_MESSAGE$/, "");

  // Split by underscore and convert to camelCase
  const words = withoutSuffix.split("_");
  const camelCase = words
    .map((word, index) => {
      if (index === 0) {
        return word.toLowerCase();
      }
      if (word === "HID") {
        return "HID";
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");

  return `${camelCase}Message`;
}

async function main() {
  const project = new Project({
    tsConfigFilePath: join(import.meta.dirname, "../tsconfig.json"),
  });

  // Get the ProtocolMessage.ts file
  const protocolMessageFile = project.getSourceFileOrThrow(
    "src/protocols/mrp/generated/ProtocolMessage.ts"
  );

  // Find the ProtocolMessage_Type enum
  const protocolMessageTypeEnum = protocolMessageFile.getEnumOrThrow(
    "ProtocolMessage_Type"
  );

  // Get all enum members
  const enumMembers = protocolMessageTypeEnum.getMembers();

  const messageTypeMap: MessageTypeMap = {};
  const generatedDir = "src/protocols/mrp/generated";

  console.log("Processing enum members...\n");

  for (const member of enumMembers) {
    const enumName = member.getName();
    const enumValue = member.getValue();

    // Skip UNKNOWN_MESSAGE, UNRECOGNIZED, and other special cases
    if (enumName === "UNKNOWN_MESSAGE" || enumName === "UNRECOGNIZED") {
      console.log(`⏭️  Skipping ${enumName}`);
      continue;
    }

    // Generate expected filename and export name
    const expectedFileName = convertEnumNameToFileName(enumName);
    const expectedExportName = convertEnumNameToExportName(enumName);
    const expectedFilePath = join(generatedDir, `${expectedFileName}.ts`);

    // Try to find the file
    const sourceFile = project.getSourceFile(expectedFilePath);

    if (sourceFile) {
      // Verify the export exists
      const exportDeclarations = sourceFile
        .getVariableDeclarations()
        .filter((decl) => decl.isExported());

      const matchingExport = exportDeclarations.find(
        (decl) => decl.getName() === expectedExportName
      );

      if (matchingExport) {
        console.log(`✅ ${enumName} (${enumValue})`);
        console.log(`   -> ${expectedFilePath}`);
        console.log(`   -> export: ${expectedExportName}\n`);

        messageTypeMap[`ProtocolMessage_Type.${enumName}`] = {
          pathname: expectedFilePath,
          exportName: expectedExportName,
        };
      } else {
        console.log(
          `⚠️  ${enumName} (${enumValue}): File found but export "${expectedExportName}" not found`
        );
        console.log(
          `   Available exports: ${exportDeclarations.map((d) => d.getName()).join(", ")}\n`
        );
      }
    } else {
      console.log(
        `❌ ${enumName} (${enumValue}): File not found at ${expectedFilePath}\n`
      );
    }
  }

  const upperFirstLetter = (str: string) =>
    str.charAt(0).toUpperCase() + str.slice(1);
  // Generate the output file
  const outputPath = join(
    process.cwd(),
    "src/protocols/mrp/generated/ProtocolMessageResolver.ts"
  );
  const createImportStatement = (entry: MessageTypeMapEntry) =>
    `import { ${entry.exportName}, type ${upperFirstLetter(entry.exportName)} } from "./${basename(entry.pathname)}"`;

  const createExtensionMapEntry = ([enumKey, entry]: [
    string,
    MessageTypeMapEntry,
  ]) => `  [${enumKey}]: ${entry.exportName},`;

  const fileHeader = `// Auto-generated by generate-message-type-map.ts
// DO NOT EDIT MANUALLY

  import { ProtocolMessage_Type, ProtocolMessage, type Extension  } from "./ProtocolMessage";`;

  const importStatements = Object.values(messageTypeMap)
    .map(createImportStatement)
    .reduce((acc, curr) => {
      if (!acc.includes(curr)) {
        acc.push(curr);
      }
      return acc;
    }, [] as string[])
    .join("\n");

  const protocolMessagePayload = `export type ProtocolMessagePayload = ${Object.entries(
    messageTypeMap
  )
    .map(
      ([enumKey, entry]) =>
        `| { extensionType: ${enumKey}; message: ${upperFirstLetter(entry.exportName)} }`
    )
    .join("\n  ")}`;

  const mapEntries = `const  ExtensionMap: Record<number,Extension<any>> = {
  ${Object.entries(messageTypeMap).map(createExtensionMapEntry).join("\n")}
  }`;

  const protocolMessageResultTypeExport = `export type ProtocolMessageResult =
     | { extensionType: undefined; message: ProtocolMessage; innerMessage: undefined }
  ${Object.entries(messageTypeMap)
    .map(
      ([enumKey, entry]) =>
        `| { extensionType: ${enumKey}; message: ProtocolMessage; innerMessage: ${upperFirstLetter(
          entry.exportName
        )} }`
    )
    .join("\n  ")}`;

  const extensionTypeDisplayName = `export const ProtocolMessageExtensionDisplayNameMap = {
  ${Object.entries(messageTypeMap)
    .map(
      ([enumKey, entry]) =>
        `  [${enumKey}]: "${enumKey.replace("ProtocolMessage_Type.", "")}",`
    )
    .join("\n  ")}
}`;

  // Build the skip extension set for runtime
  const skipExtensionEnumKeys = Object.keys(messageTypeMap).filter((key) =>
    SKIP_EXTENSION_MESSAGES.has(key.replace("ProtocolMessage_Type.", ""))
  );

  const skipExtensionSetCode =
    skipExtensionEnumKeys.length > 0
      ? `const SKIP_EXTENSION_TYPES = new Set([${skipExtensionEnumKeys.join(", ")}])`
      : `const SKIP_EXTENSION_TYPES = new Set<number>()`;

  const protocolMessageResolver = `
  ${skipExtensionSetCode}

  export const buildProtocolMessageForPayload = (message:ProtocolMessage, payload: ProtocolMessagePayload): ProtocolMessage => {
  // Some message types (like GET_KEYBOARD_SESSION_MESSAGE) don't use extension fields
  // They only need the type set on the ProtocolMessage
  if (SKIP_EXTENSION_TYPES.has(payload.extensionType)) {
    return message
  }

  const ext = ExtensionMap[payload.extensionType]
  if (!ext) {
    throw new Error(\`Unsupported ProtocolMessage type: \${ProtocolMessage_Type[payload.extensionType]} (\${payload.extensionType})\`)
  }
  ProtocolMessage.setExtension(message, ext, payload.message)
  return message
  }


  export const resolveProtocolMessage = (data: Buffer): ProtocolMessageResult => {
         const message = ProtocolMessage.decode(data)
         const extensionType = message.type
         if (!extensionType) {
            return { extensionType: undefined, message, innerMessage: undefined }
         }
         const extension = ExtensionMap[extensionType]
         if (!extension) {
            throw new Error(\`Unsupported ProtocolMessage type: \${ProtocolMessage_Type[extensionType]} (\${extensionType})\`)
         }
         const innerMessage =   ProtocolMessage.getExtension(message, extension)
         return { extensionType, message, innerMessage } as ProtocolMessageResult
  }
`;
  const fileContent = [
    fileHeader,
    importStatements,
    protocolMessagePayload,
    protocolMessageResultTypeExport,
    extensionTypeDisplayName,
    mapEntries,
    protocolMessageResolver,
  ].join("\n\n");

  const opts = await resolveConfig(import.meta.path);
  const formatted = await format(fileContent, {
    ...opts,
    parser: "typescript",
  });
  await Bun.write(outputPath, formatted);
}

await main();
