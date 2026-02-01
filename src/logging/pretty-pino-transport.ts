// pino-pretty-transport.js
// pino-pretty-transport.js
import type { PrettyOptions } from "pino-pretty";
import pinoPretty from "pino-pretty";
export default (opts: PrettyOptions) => {
  const colorModuleMap = new Map<string, (text: string) => string>();

  // Define background colors with their optimal contrasting text colors

  return pinoPretty({
    ...opts,
    messageFormat: (log, messageKey, _, extras) => {
      const COLORS = extras.colors;
      const bgColorPairs = [
        { bg: COLORS.bgCyan, text: COLORS.black, name: "bgCyan" },
        { bg: COLORS.bgRed, text: COLORS.white, name: "bgRed" },
        { bg: COLORS.bgYellow, text: COLORS.black, name: "bgYellow" },
        { bg: COLORS.bgWhite, text: COLORS.black, name: "bgWhite" },
        { bg: COLORS.bgWhiteBright, text: COLORS.black, name: "bgWhiteBright" },
        { bg: COLORS.bgBlackBright, text: COLORS.white, name: "bgBlackBright" },
        { bg: COLORS.bgBlueBright, text: COLORS.white, name: "bgBlueBright" },
        { bg: COLORS.bgGreenBright, text: COLORS.black, name: "bgGreenBright" },
        { bg: COLORS.bgCyanBright, text: COLORS.black, name: "bgCyanBright" },
        {
          bg: COLORS.bgMagentaBright,
          text: COLORS.white,
          name: "bgMagentaBright",
        },
        {
          bg: COLORS.bgYellowBright,
          text: COLORS.black,
          name: "bgYellowBright",
        },
        { bg: COLORS.bgRedBright, text: COLORS.white, name: "bgRedBright" },
      ];

      const module = (log as any).module
        ? ` ${(log as any).module} `
        : undefined;
      let moduleColorFunc = (text: string) => text.toString();
      if (module && !colorModuleMap.has(module)) {
        const pair = bgColorPairs[
          colorModuleMap.size % bgColorPairs.length
        ] ?? {
          bg: COLORS.bgWhite,
          text: COLORS.black,
          name: "bgWhite",
        };
        colorModuleMap.set(module, (text: string | number) =>
          pair.bg(pair.text(text))
        );
        moduleColorFunc = colorModuleMap.get(module)!;
      } else if (module) {
        moduleColorFunc = colorModuleMap.get(module)!;
      }

      return `${moduleColorFunc(module ?? "")} ${log[messageKey]}`;
    },
  });
};
