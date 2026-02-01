/**
 * CLI Output Utility
 * Handles formatted output for the CLI with proper stderr/stdout separation
 */

import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";
import { Spinner } from "picospinner";
import type { OutputFormat } from "../cli";
import { createLogger } from "@/logging/logging.ts";

export interface OutputOptions {
  format: OutputFormat;
  verbose: boolean;
  quiet: boolean;
  noColor: boolean;
}

const logger = createLogger("bunatv:cli:output");

/**
 * CLI Output handler
 * - All logging/status messages go to stderr
 * - Only final results go to stdout via result()
 */
export class CliOutput {
  private options: OutputOptions;
  private spinner?: Spinner;

  constructor(options: Partial<OutputOptions> = {}) {
    this.options = {
      format: options.format || "text",
      verbose: options.verbose || false,
      quiet: options.quiet || false,
      noColor: options.noColor || false,
    };

    // Disable colors if requested
    if (this.options.noColor) {
      // @cliffy/ansi respects NO_COLOR env variable
      process.env.NO_COLOR = "1";
    }
  }

  /**
   * Log an info message to stderr
   */
  info(message: string): void {
    if (!this.options.quiet) {
      console.error(message);
    }
    logger.info(message);
  }

  /**
   * Log a success message to stderr
   */
  success(message: string): void {
    if (!this.options.quiet) {
      const formatted = this.options.noColor
        ? `✅ ${message}`
        : colors.green(`✅ ${message}`);
      console.error(formatted);
    }
    logger.info(message);
  }

  /**
   * Log an error message to stderr
   */
  error(message: string | Error): void {
    const text = message instanceof Error ? message.message : message;
    const formatted = this.options.noColor
      ? `❌ ${text}`
      : colors.red(`❌ ${text}`);
    console.error(formatted);
    logger.error(text);
  }

  /**
   * Log a warning message to stderr
   */
  warn(message: string): void {
    if (!this.options.quiet) {
      const formatted = this.options.noColor
        ? `⚠️  ${message}`
        : colors.yellow(`⚠️  ${message}`);
      console.error(formatted);
    }
    logger.warn(message);
  }

  /**
   * Log a verbose message to stderr (only if verbose mode is enabled)
   */
  debug(message: string): void {
    if (this.options.verbose && !this.options.quiet) {
      const formatted = this.options.noColor
        ? `[DEBUG] ${message}`
        : colors.gray(`[DEBUG] ${message}`);
      console.error(formatted);
    }
    logger.debug(message);
  }

  /**
   * Log a status/progress message to stderr
   */
  status(emoji: string, message: string, detail?: string): void {
    if (!this.options.quiet) {
      let formatted = `${emoji} ${message}`;
      if (detail && this.options.verbose) {
        formatted += this.options.noColor
          ? ` - ${detail}`
          : colors.gray(` - ${detail}`);
      }
      console.error(formatted);
    }
    logger.info(message);
  }

  newLine(): void {
    if (!this.options.quiet) {
      console.error("");
    }
  }
  /**
   * Start a loading spinner
   */
  startSpinner(message: string): void {
    if (!this.options.quiet && this.options.format !== "json") {
      this.newLine();
      this.stopSpinner(); // Stop any existing spinner
      this.spinner = new Spinner(message, { disableNewLineEnding: true });
      this.spinner.start();
    }
    logger.info({ spinner: "start" }, message);
  }

  /**
   * Stop the current spinner
   */
  stopSpinner(): void {
    if (this.spinner) {
      this.newLine();
      this.spinner.stop();
      this.spinner = undefined;
    }
    logger.info({ spinner: "stop" }, this.spinner);
  }

  /**
   * Stop spinner with success message
   */
  succeedSpinner(message?: string): void {
    if (this.spinner) {
      this.newLine();
      this.spinner.succeed(message);
      this.spinner = undefined;
      logger.info({ spinner: "succeed" }, message || "");
    } else if (message) {
      this.success(message);
    }
  }

  /**
   * Stop spinner with failure message
   */
  failSpinner(message?: string): void {
    if (this.spinner) {
      this.spinner.fail(message);
      this.spinner = undefined;
      logger.info({ spinner: "fail" }, message || "");
    } else if (message) {
      this.error(message);
    }
  }

  /**
   * Output the final result to stdout
   * Format is determined by the global --output option
   */
  result(data: unknown): void {
    logger.info({ outputFormat: this.options.format }, "Outputting result");
    switch (this.options.format) {
      case "json":
        this.outputJson(data);
        break;

      case "table":
        this.outputTable(data);
        break;

      default: // text
        this.outputText(data);
        break;
    }
  }

  /**
   * Output as JSON to stdout
   */
  private outputJson(data: unknown): void {
    console.log(JSON.stringify(data, null, 2));
    logger.info(data, "Outputted JSON result");
  }

  /**
   * Output as table to stdout
   */
  private outputTable(data: unknown): void {
    if (!Array.isArray(data)) {
      // For non-array data, create a key-value table
      if (typeof data === "object" && data !== null) {
        const table = new Table();
        Object.entries(data).forEach(([key, value]) => {
          table.push([
            this.options.noColor ? key : colors.bold(key),
            typeof value === "object" ? JSON.stringify(value) : String(value),
          ]);
        });
        console.log(table.toString());
        logger.info(data, "Outputted key-value table result");
      } else {
        console.log(String(data));
        logger.info(data, "Outputted single value result");
      }
      return;
    }

    if (data.length === 0) {
      console.log("No data to display");
      logger.info("Outputted empty table result");
      return;
    }

    // For array data, create a standard table
    const firstItem = data[0];
    if (typeof firstItem === "object" && firstItem !== null) {
      const headers = Object.keys(firstItem);
      const table = new Table()
        .header(headers.map((h) => (this.options.noColor ? h : colors.bold(h))))
        .body(
          data.map((item) =>
            headers.map((h) => {
              const value = (item as any)[h];
              return value === null || value === undefined
                ? ""
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value);
            })
          )
        );
      console.log(table.toString());
      logger.info(data, "Outputted array table result");
    } else {
      // Simple array of primitives
      data.forEach((item) => console.log(String(item)));
      logger.info(data, "Outputted array of primitives result");
    }
  }

  /**
   * Output as text to stdout
   */
  private outputText(data: unknown): void {
    if (data === null || data === undefined) {
      return;
    }

    if (typeof data === "string") {
      console.log(data);
      logger.info({ data }, "Outputted string result");
    } else if (Array.isArray(data)) {
      data.forEach((item, index) => {
        if (index > 0) console.log(""); // Empty line between items
        this.outputTextItem(item);
      });
    } else {
      this.outputTextItem(data);
    }
  }

  /**
   * Format and output a single item as text
   */
  private outputTextItem(item: unknown): void {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      console.log(String(item));
      logger.info({ item }, "Outputted primitive result");
    } else if (typeof item === "object" && item !== null) {
      // Format object as indented key-value pairs
      Object.entries(item).forEach(([key, value]) => {
        const formattedKey = this.options.noColor
          ? `${key}:`
          : colors.bold(`${key}:`);

        const formattedValue =
          typeof value === "object"
            ? JSON.stringify(value, null, 2)
                .split("\n")
                .map((line, i) => (i === 0 ? line : `  ${line}`))
                .join("\n")
            : String(value);

        console.log(`  ${formattedKey} ${formattedValue}`);
        logger.info({ [key]: value }, "Outputted object key-value pair");
      });
    } else {
      console.log(String(item));
      logger.info({ item }, "Outputted unknown type result");
    }
  }

  /**
   * Create a section header
   */
  section(title: string): void {
    if (!this.options.quiet) {
      const separator = "=".repeat(title.length);
      const formatted = this.options.noColor
        ? `\n${title}\n${separator}`
        : `\n${colors.bold.underline(title)}`;
      console.error(formatted);
      logger.info({ section: title }, "Outputted section header");
    }
  }

  /**
   * Create an indented list item
   */
  listItem(text: string, level: number = 1): void {
    if (!this.options.quiet) {
      const indent = "  ".repeat(level);
      console.error(`${indent}• ${text}`);
      logger.info({ listItem: text, level }, "Outputted list item");
    }
  }

  /**
   * Highlight important text
   */
  highlight(text: string): string {
    return this.options.noColor ? text : colors.bold.cyan(text);
  }

  /**
   * Dim less important text
   */
  dim(text: string): string {
    return this.options.noColor ? text : colors.gray(text);
  }

  /**
   * Check if verbose mode is enabled
   */
  isVerbose(): boolean {
    return this.options.verbose;
  }
}

/**
 * Create an output handler with the given options
 */
export function createOutput(options: Partial<OutputOptions> = {}): CliOutput {
  return new CliOutput(options);
}
