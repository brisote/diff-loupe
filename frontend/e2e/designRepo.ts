import { rmSync } from "node:fs";
import { join } from "node:path";
import { git, type Workspace } from "./fixtures";
import { invoiceExporterAfter, invoiceExporterBefore } from "./invoiceExporter";

export function designRepo(workspace: Workspace): string {
  const repo = workspace.repo("acme-billing");
  const kotlin = "billing/src/main/kotlin/acme/billing";
  workspace.write(repo, `${kotlin}/InvoiceExporter.kt`, invoiceExporterBefore);
  workspace.write(repo, `${kotlin}/TotalsCalculator.kt`, "class TotalsCalculator\n");
  workspace.write(repo, "config/legacy-export.yaml", "a: 1\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Billing");
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(repo, `${kotlin}/InvoiceExporter.kt`, invoiceExporterAfter);
  workspace.write(repo, `${kotlin}/TotalsCalculator.kt`, "class TotalsCalculator(val tax: Int)\n");
  workspace.write(repo, "README.md", "# acme-billing\n\nExports invoices.\n");
  workspace.write(repo, "web/src/invoices/exportButton.tsx", "export {}\n");
  git(repo, "add", "web/src/invoices/exportButton.tsx");
  rmSync(join(repo, "config/legacy-export.yaml"));
  workspace.write(repo, "docs/export-notes.md", "notes\n");
  return repo;
}

export function mergeRepo(workspace: Workspace): string {
  const repo = workspace.repo("acme-billing");
  const remote = join(workspace.dir, "remote.git");
  git(workspace.dir, "init", "-q", "--bare", "-b", "main", remote);
  git(repo, "remote", "add", "origin", remote);
  const kotlin = "billing/src/main/kotlin/acme/billing";
  const files = {
    exporter: `${kotlin}/InvoiceExporter.kt`,
    totals: `${kotlin}/TotalsCalculator.kt`,
    csv: `${kotlin}/csv/CsvWriter.kt`,
    legacy: "config/legacy-export.yaml",
  };
  workspace.write(repo, files.exporter, invoiceExporterBefore);
  workspace.write(repo, files.totals, "class TotalsCalculator\n");
  workspace.write(repo, files.csv, "class CsvWriter\n");
  workspace.write(repo, files.legacy, "export: old\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Billing");
  git(repo, "push", "-q", "-u", "origin", "main");
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(repo, files.exporter, invoiceExporterAfter);
  workspace.write(repo, files.totals, "class TotalsCalculator(val tax: Int)\n");
  rmSync(join(repo, files.legacy));
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Export invoices");
  git(repo, "switch", "-q", "main");
  workspace.write(
    repo,
    files.exporter,
    invoiceExporterBefore
      .replace("writer: CsvWriter,", "writer: CsvWriter,\n    private val metrics: ExportMetrics,")
      .replace("invoices.map { toRow(it) }", "invoices.filter { it.isBillable }.map(::toRow)")
      .replace(
        'listOf("number", "customer", "amount")',
        'listOf("invoice_no", "customer", "amount")',
      ),
  );
  workspace.write(repo, files.totals, "class TotalsCalculator(val rate: Int)\n");
  workspace.write(repo, files.csv, "class CsvWriter(val separator: Char)\n");
  workspace.write(repo, files.legacy, "export: new\n");
  workspace.write(repo, "README.md", "# acme-billing\n\nExports invoices.\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Main work");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "reset", "-q", "--hard", "HEAD~1");
  git(repo, "switch", "-q", "gs/invoice-export");
  return repo;
}

export function withBranches(workspace: Workspace, repo: string): string {
  const remote = join(workspace.dir, "remote.git");
  git(workspace.dir, "init", "-q", "--bare", "-b", "main", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main", "gs/invoice-export");
  for (const name of ["gs/ledger-sync", "release/2026.10"])
    git(repo, "push", "-q", "origin", `main:${name}`);
  git(repo, "branch", "gs/totals-rounding", "main");
  git(repo, "branch", "gs/csv-writer", "main");
  git(repo, "fetch", "-q");
  return remote;
}
