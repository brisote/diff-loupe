import { execFileSync } from "node:child_process";
import { git, gitEnv, type Workspace } from "./fixtures";

const kotlin = "billing/src/main/kotlin/acme/billing";
export const totalsPath = `${kotlin}/TotalsCalculator.kt`;

const totals = (sum: string, rounding = "") =>
  `package acme.billing\n\nimport java.math.BigDecimal\nimport java.math.RoundingMode\nimport java.text.NumberFormat\nimport java.util.Locale\n\nclass TotalsCalculator(private val locale: Locale) {\n    fun total(lines: List<Line>): BigDecimal =\n        lines.sumOf { it.${sum} * it.quantity.toBigDecimal() }\n            .setScale(2, RoundingMode.${rounding || "HALF_UP"})\n\n    fun format(amount: BigDecimal): String =\n        NumberFormat.getCurrencyInstance(locale).format(amount)\n}\n`;

export const logNow = new Date(2026, 9, 22, 18, 0);

function at(hoursAgo: number): string {
  return `@${Math.floor(logNow.getTime() / 1000 - hoursAgo * 3600)} +0000`;
}

function commit(repo: string, message: string, hoursAgo: number, author = "Ada Lovelace") {
  const email = author === "Ada Lovelace" ? "ada@example.com" : "grace@example.com";
  const date = at(hoursAgo);
  git(repo, "add", "-A");
  execFileSync("git", ["commit", "-q", "-m", message, `--author=${author} <${email}>`], {
    cwd: repo,
    env: { ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

export function logRepo(workspace: Workspace): string {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, totalsPath, totals("price"));
  commit(repo, "Add the totals calculator", 24 * 9);
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  for (const name of ["Export", "Csv", "Row", "Header", "Format"]) {
    workspace.write(repo, `${kotlin}/export/${name}.kt`, `class ${name}\n`);
  }
  workspace.write(repo, `${kotlin}/export/README.md`, "# Export\n");
  commit(repo, "Scaffold the billing export module", 24 * 5, "Grace Hopper");
  workspace.write(repo, `${kotlin}/export/Csv.kt`, "class Csv(val separator: Char)\n");
  workspace.write(repo, `${kotlin}/export/Writer.kt`, "class Writer\n");
  workspace.write(repo, totalsPath, totals("price", "HALF_DOWN"));
  commit(repo, "Add CSV writer for invoices", 24 * 3);
  git(repo, "switch", "-q", "main");
  workspace.write(repo, totalsPath, totals("netPrice"));
  workspace.write(repo, "docs/tax.md", "# Tax\n");
  commit(repo, "Use the net price for totals", 24 * 2);
  git(repo, "switch", "-q", "gs/invoice-export");
  try {
    git(repo, "merge", "-q", "main");
  } catch {
    workspace.write(repo, totalsPath, totals("netPrice", "HALF_DOWN"));
  }
  const date = at(27);
  git(repo, "add", "-A");
  execFileSync("git", ["commit", "-q", "--no-edit"], {
    cwd: repo,
    env: { ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  workspace.write(repo, totalsPath, totals("netPrice", "HALF_EVEN"));
  workspace.write(repo, "README.md", "# acme-billing\n\nTotals round half-even.\n");
  commit(
    repo,
    "Round totals half-even to two decimals\n\nBanker's rounding keeps the monthly totals stable when many invoices end in a half cent.",
    25,
  );
  workspace.write(repo, `${kotlin}/export/Export.kt`, "class Export(val skipEmpty: Boolean)\n");
  workspace.write(
    repo,
    `${kotlin}/export/Row.kt`,
    "class Row(val cells: List<String>) {\n    val empty get() = cells.isEmpty()\n}\n",
  );
  commit(repo, "Skip empty invoices before export", 2);
  workspace.write(repo, "README.md", "# acme-billing\n\nWork in progress.\n");
  return repo;
}
