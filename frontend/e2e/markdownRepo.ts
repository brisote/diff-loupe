import { git, type Workspace } from "./fixtures";

export const readmeBefore = `# acme-billing

Billing services for Acme: invoices, totals and exports.

## How totals are rounded

Totals are rounded half-up to two decimals before export.

- Currency follows the invoice.

| Field | Format |
| --- | --- |
| amount | 1234.5 |
| customer | Name as on the contract |

## Export

\`\`\`
export --all
\`\`\`
`;

export const readmeAfter = `# acme-billing

Billing services for Acme: invoices, totals and exports.

## How totals are rounded

Totals are rounded half-even to two decimals before export.

- Currency follows the invoice.
- Empty invoices are skipped, see [export notes](docs/export-notes.md).

| Field | Format |
| --- | --- |
| amount | 1234.50 |
| customer | Name as on the contract |
| currency | ISO 4217 code |

## Export

\`\`\`
export --skip-empty
\`\`\`
`;

export function markdownRepo(workspace: Workspace, name = "acme-billing"): string {
  const repo = workspace.repo(name);
  workspace.write(repo, "README.md", readmeBefore);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Document the billing rules");
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(repo, "README.md", readmeAfter);
  return repo;
}
