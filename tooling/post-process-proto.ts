#!/usr/bin/env bun
/**
 * This script generates a map from ProtocolMessage_Type enum values
 * to their corresponding file paths and export names.
 */

import { Project } from "ts-morph";
import { join } from "path";
import { format, resolveConfig } from "prettier";
import { Glob } from "bun";

interface MessageTypeMapEntry {
  pathname: string; // absolute path to the message file on disk
  exportName: string;
}

// New messages reusing inner message of another type
const REUSED_MESSAGES: Record<string, string> = {
  DEVICE_INFO_UPDATE_MESSAGE: "DEVICE_INFO_MESSAGE",
  REMOVE_FROM_PARENT_GROUP_MESSAGE: "REMOVE_OUTPUT_DEVICES_MESSAGE",
  CONFIGURE_CONNECTION_SERVICE_MESSAGE: "CONFIGURE_CONNECTION_MESSAGE",
};

// Messages where the extension should NOT be set (type-only messages with string extensions)
const SKIP_EXTENSION_MESSAGES = new Set(["GET_KEYBOARD_SESSION_MESSAGE"]);

type MessageTypeMap = Record<string, MessageTypeMapEntry>;

async function getFirstGlobMatch(
  iter: AsyncIterableIterator<string>
): Promise<string | undefined> {
  for await (const value of iter) return value;
  return undefined;
}

function convertEnumNameToFileName(enumName: string): string {
  const adjustedEnumName = REUSED_MESSAGES[enumName] || enumName;
  const withoutSuffix = adjustedEnumName.replace(/_MESSAGE$/, "");

  const words = withoutSuffix.split("_");
  const pascalCase = words
    .map((word) => {
      if (word === "HID") return "HID";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");

  return `${pascalCase}Message`;
}

function convertEnumNameToExportName(enumName: string): string {
  const adjustedEnumName = REUSED_MESSAGES[enumName] || enumName;
  const withoutSuffix = adjustedEnumName.replace(/_MESSAGE$/, "");

  const words = withoutSuffix.split("_");
  const camelCase = words
    .map((word, index) => {
      if (index === 0) return word.toLowerCase();
      if (word === "HID") return "HID";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");

  return `${camelCase}Message`;
}

const upperFirstLetter = (str: string) =>
  str.charAt(0).toUpperCase() + str.slice(1);

async function main() {
  const project = new Project({
    tsConfigFilePath: join(import.meta.dirname, "../tsconfig.json"),
  });

  // Get the ProtocolMessage.ts file
  const protocolMessageFile = project.getSourceFileOrThrow(
    "src/protocols/mrp/generated/protocol/ProtocolMessage.ts"
  );

  // Find the ProtocolMessage_Type enum
  const protocolMessageTypeEnum = protocolMessageFile.getEnumOrThrow(
    "ProtocolMessage_Type"
  );
  const enumMembers = protocolMessageTypeEnum.getMembers();

  const messageTypeMap: MessageTypeMap = {};
  const messagesDir = "src/protocols/mrp/generated/messages";

  console.log("Processing enum members...\n");

  for (const member of enumMembers) {
    const enumName = member.getName();
    const enumValue = member.getValue();

    // Skip special cases
    if (enumName === "UNKNOWN_MESSAGE" || enumName === "UNRECOGNIZED") {
      console.log(`⏭️  Skipping ${enumName}`);
      continue;
    }

    const expectedFileName = convertEnumNameToFileName(enumName);
    const expectedExportName = convertEnumNameToExportName(enumName);

    const globFileSearch = new Glob(
      join(messagesDir, `**/${expectedFileName}.ts`)
    );
    const expectedFilePath = await getFirstGlobMatch(
      globFileSearch.scan({ absolute: true })
    );

    if (!expectedFilePath) {
      console.log(
        `${enumName} (${enumValue}): Expected file not found for ${expectedFileName}.ts in ${messagesDir}\n`
      );
      return;
    }

    const sourceFile = project.getSourceFile(expectedFilePath);
    if (!sourceFile) {
      console.log(
        `${enumName} (${enumValue}): File not found at ${expectedFilePath}\n`
      );
      return;
    }

    // Verify the export exists
    const exportDeclarations = sourceFile
      .getVariableDeclarations()
      .filter((decl) => decl.isExported());

    const matchingExport = exportDeclarations.find(
      (decl) => decl.getName() === expectedExportName
    );

    if (!matchingExport) {
      console.log(
        `${enumName} (${enumValue}): File found but export "${expectedExportName}" not found`
      );
      console.log(
        `Available exports: ${exportDeclarations.map((d) => d.getName()).join(", ")}\n`
      );
      continue;
    }

    messageTypeMap[`ProtocolMessage_Type.${enumName}`] = {
      pathname: expectedFilePath,
      exportName: expectedExportName,
    };
  }

  // Create the output source file via ts-morph
  const outputPath = join(
    process.cwd(),
    "src/protocols/mrp/generated/ProtocolMessageResolver.ts"
  );

  // create/overwrite the output file in the project
  const outFile = project.createSourceFile(outputPath, "", { overwrite: true });

  // Ensure the ProtocolMessage.ts is in the project & get it as a SourceFile to resolve specifiers
  const protocolMessageSource = project.getSourceFileOrThrow(
    "src/protocols/mrp/generated/protocol/ProtocolMessage.ts"
  );

  // Collect unique imports keyed by absolute pathname
  const uniqueMessageFiles = new Map<
    string,
    { exportName: string; typeName: string }
  >();

  // 1) Import ProtocolMessage bits
  outFile.addImportDeclaration({
    namedImports: ["ProtocolMessage_Type", "ProtocolMessage"],
    moduleSpecifier: outFile.getRelativePathAsModuleSpecifierTo(
      protocolMessageSource
    ),
  });

  outFile.addImportDeclaration({
    namedImports: [{ name: "Extension", isTypeOnly: true }],
    moduleSpecifier: outFile.getRelativePathAsModuleSpecifierTo(
      protocolMessageSource
    ),
  });

  for (const entry of Object.values(messageTypeMap)) {
    const typeName = upperFirstLetter(entry.exportName);
    const existing = uniqueMessageFiles.get(entry.pathname);
    if (!existing)
      uniqueMessageFiles.set(entry.pathname, {
        exportName: entry.exportName,
        typeName,
      });
  }

  // 2) Import all message factories + types, with resolved module specifiers
  for (const [absPath, { exportName, typeName }] of uniqueMessageFiles) {
    const msgFile = project.getSourceFile(absPath);
    if (!msgFile) {
      throw new Error(
        `Internal error: expected SourceFile not loaded: ${absPath}`
      );
    }

    outFile.addImportDeclaration({
      namedImports: [exportName],
      moduleSpecifier: outFile.getRelativePathAsModuleSpecifierTo(msgFile),
    });

    outFile.addImportDeclaration({
      namedImports: [{ name: typeName, isTypeOnly: true }],
      moduleSpecifier: outFile.getRelativePathAsModuleSpecifierTo(msgFile),
    });
  }

  // Build the skip extension set for runtime
  const skipExtensionEnumKeys = Object.keys(messageTypeMap).filter((key) =>
    SKIP_EXTENSION_MESSAGES.has(key.replace("ProtocolMessage_Type.", ""))
  );

  const skipExtensionSetCode =
    skipExtensionEnumKeys.length > 0
      ? `const SKIP_EXTENSION_TYPES = new Set([${skipExtensionEnumKeys.join(", ")}])`
      : `const SKIP_EXTENSION_TYPES = new Set<number>()`;

  // Types + runtime maps
  const protocolMessagePayload = `export type ProtocolMessagePayload =
  ${Object.entries(messageTypeMap)
    .map(
      ([enumKey, entry]) =>
        `| { extensionType: ${enumKey}; message: ${upperFirstLetter(entry.exportName)} }`
    )
    .join("\n  ")};
`;

  const protocolMessageResultTypeExport = `export type ProtocolMessageResult =
  | { extensionType: undefined; message: ProtocolMessage; innerMessage: undefined }
  ${Object.entries(messageTypeMap)
    .map(
      ([enumKey, entry]) =>
        `| { extensionType: ${enumKey}; message: ProtocolMessage; innerMessage: ${upperFirstLetter(
          entry.exportName
        )} }`
    )
    .join("\n  ")};
`;

  const extensionTypeDisplayName = `export const ProtocolMessageExtensionDisplayNameMap = {
  ${Object.entries(messageTypeMap)
    .map(
      ([enumKey]) =>
        `  [${enumKey}]: "${enumKey.replace("ProtocolMessage_Type.", "")}",`
    )
    .join("\n")}
} as const;
`;

  const mapEntries = `const ExtensionMap: Record<number, Extension<any>> = {
${Object.entries(messageTypeMap)
  .map(([enumKey, entry]) => `  [${enumKey}]: ${entry.exportName},`)
  .join("\n")}
};
`;

  const protocolMessageResolver = `
${skipExtensionSetCode}

export const buildProtocolMessageForPayload = (
  message: ProtocolMessage,
  payload: ProtocolMessagePayload
): ProtocolMessage => {
  // Some message types (like GET_KEYBOARD_SESSION_MESSAGE) don't use extension fields
  // They only need the type set on the ProtocolMessage
  if (SKIP_EXTENSION_TYPES.has(payload.extensionType)) {
    return message;
  }

  const ext = ExtensionMap[payload.extensionType];
  if (!ext) {
    throw new Error(
      \`Unsupported ProtocolMessage type: \${ProtocolMessage_Type[payload.extensionType]} (\${payload.extensionType})\`
    );
  }

  ProtocolMessage.setExtension(message, ext, payload.message);
  return message;
};

export const resolveProtocolMessage = (data: Buffer): ProtocolMessageResult => {
  const message = ProtocolMessage.decode(data);
  const extensionType = message.type;

  if (!extensionType) {
    return { extensionType: undefined, message, innerMessage: undefined };
  }

  const extension = ExtensionMap[extensionType];
  if (!extension) {
    throw new Error(
      \`Unsupported ProtocolMessage type: \${ProtocolMessage_Type[extensionType]} (\${extensionType})\`
    );
  }

  const innerMessage = ProtocolMessage.getExtension(message, extension);
  return { extensionType, message, innerMessage } as ProtocolMessageResult;
};
`;

  // Set the rest of the file's body (imports already emitted)
  outFile.addStatements([
    protocolMessagePayload,
    protocolMessageResultTypeExport,
    extensionTypeDisplayName,
    mapEntries,
    protocolMessageResolver,
  ]);

  // Format + write
  const opts = await resolveConfig(import.meta.path);
  outFile.insertStatements(0, [
    `// Auto-generated by tooling/post-process-proto.ts`,
    `// DO NOT EDIT MANUALLY`,
    ``,
  ]);
  const formatted = await format(outFile.getFullText(), {
    ...opts,
    parser: "typescript",
  });

  outFile.replaceWithText(formatted);

  await project.save();
}

await main();
