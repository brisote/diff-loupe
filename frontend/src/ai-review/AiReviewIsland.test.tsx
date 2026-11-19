import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeCore, renderWithStore, repoInfo } from "../test/render";
import { AiReviewIsland } from "./AiReviewIsland";

describe("AiReviewIsland", () => {
  it("shows disclosure and handles consent", async () => {
    let consentSet = false;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: false,
        account: null,
        review: null,
        chatMessages: [],
      }),
      ai_set_consent: () => {
        consentSet = true;
        return null;
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    expect(screen.getByText("AI code review disclosure")).toBeInTheDocument();
    expect(screen.getByText("What data is used")).toBeInTheDocument();
    expect(screen.getByText("Do we delete everything")).toBeInTheDocument();
    const allowButton = screen.getByRole("button", { name: "Allow AI review" });
    expect(allowButton).toBeInTheDocument();

    fireEvent.click(allowButton);
    await waitFor(() => {
      expect(consentSet).toBe(true);
      expect(store.getState().consentAccepted).toBe(true);
    });
  });

  it("shows sign-in prompt when consented but not signed in", async () => {
    let signInCalled = false;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: null,
        review: null,
        chatMessages: [],
      }),
      ai_sign_in: () => {
        signInCalled = true;
        return { userCode: "ABCD-1234", verificationUrl: "https://cloud.diffloupe.com/device" };
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    expect(await screen.findByText("Sign in to Diffloupe")).toBeInTheDocument();
    const signInButton = screen.getByRole("button", { name: "Sign in with browser" });
    fireEvent.click(signInButton);
    await waitFor(() => {
      expect(signInCalled).toBe(true);
    });
  });

  it("shows add-funds prompt when balance is zero", async () => {
    let fundsAmount: number | null = null;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "0.00" },
        review: null,
        chatMessages: [],
      }),
      ai_add_funds: (args: unknown) => {
        fundsAmount = Number((args as { amountUsd: bigint }).amountUsd);
        return { checkoutUrl: "https://checkout.stripe.com/pay" };
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    expect(await screen.findByText("Add review balance")).toBeInTheDocument();
    expect(screen.getByText("Balance $0.00")).toBeInTheDocument();

    const starterPack = screen.getByRole("button", { name: /\$10/ });
    fireEvent.click(starterPack);
    await waitFor(() => {
      expect(fundsAmount).toBe(10);
    });
  });

  it("shows active progress during a running review", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "10.00" },
        review: null,
        chatMessages: [],
      }),
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();
    store.setState({
      activeRun: {
        runId: "run-1",
        stage: "analysis",
        message: "Auditing 4 changed files and unit tests",
        thoughts: ["Comparing against repository conventions", "Checking type safety"],
        cancellable: true,
      },
    });

    expect(await screen.findByText("Review in progress")).toBeInTheDocument();
    expect(screen.getByText("Auditing 4 changed files and unit tests")).toBeInTheDocument();
    expect(screen.getByText("Model Thinking")).toBeInTheDocument();
    expect(screen.getByText("Comparing against repository conventions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel review" })).toBeInTheDocument();
  });

  it("renders report markdown with exact costs and balance", async () => {
    let reviewStarted = false;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: {
          repo: "/Users/ada/Workspace/acme-billing",
          branch: "gs/invoice-export",
          targetBranch: "main",
          reportMarkdown: "## Branch review\n\nFound 1 warning.",
          costUsd: "0.14",
          headOid: "abc",
          baseOid: "def",
          updatedAt: 1000,
        },
        chatMessages: [],
      }),
      ai_start_review: () => {
        reviewStarted = true;
        return null;
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    expect(await screen.findByText("Branch review")).toBeInTheDocument();
    expect(screen.getByText("Found 1 warning.")).toBeInTheDocument();
    expect(screen.getByText("Cost $0.14")).toBeInTheDocument();
    expect(screen.getByText("Balance $9.86")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Interactive chat" })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Ask about this review or request changes…"),
    ).toBeInTheDocument();

    const rerunButton = screen.getByRole("button", { name: "Re-run review" });
    fireEvent.click(rerunButton);
    expect(
      screen.getByText(
        "This will permanently delete this review report and its chat history, and start a fresh new review.",
      ),
    ).toBeInTheDocument();
    const confirmRerun = screen.getByRole("button", { name: "Re-run Review" });
    fireEvent.click(confirmRerun);
    await waitFor(() => {
      expect(reviewStarted).toBe(true);
    });
  });

  it("renders interactive chat panel, turn cost, and handles sending followups", async () => {
    let followupSent: { prompt: string; quotedText?: string } | null = null;
    let threadCleared = false;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: {
          repo: "/Users/ada/Workspace/acme-billing",
          branch: "gs/invoice-export",
          targetBranch: "main",
          reportMarkdown: "## Branch review\n\nIssue with currency serialization.",
          costUsd: "0.14",
          headOid: "abc",
          baseOid: "def",
          updatedAt: 1000,
        },
        chatMessages: [
          {
            id: 1,
            repo: "/Users/ada/Workspace/acme-billing",
            branch: "gs/invoice-export",
            targetBranch: "main",
            role: "user",
            content: "Where is currency validation defined?",
            quotedText: "Issue with currency serialization.",
            costUsd: null,
            createdAt: 1000,
          },
          {
            id: 2,
            repo: "/Users/ada/Workspace/acme-billing",
            branch: "gs/invoice-export",
            targetBranch: "main",
            role: "assistant",
            content: "Validation is in **CurrencyCode.kt**.\n\n--- REPORT UPDATE ---\nSpam report",
            quotedText: null,
            costUsd: "0.0034",
            createdAt: 1001,
          },
        ],
      }),
      ai_send_followup: (args: unknown) => {
        followupSent = args as { prompt: string; quotedText?: string };
        return null;
      },
      ai_clear_thread: () => {
        threadCleared = true;
        return null;
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    expect(await screen.findByRole("region", { name: "Interactive chat" })).toBeInTheDocument();
    expect(screen.getByText("Where is currency validation defined?")).toBeInTheDocument();
    expect(screen.getByText("CurrencyCode.kt")).toBeInTheDocument();
    expect(screen.queryByText("Spam report")).not.toBeInTheDocument();
    expect(screen.getByText("Cost <$0.01")).toBeInTheDocument();

    const composer = screen.getByPlaceholderText("Ask about this review or request changes…");
    fireEvent.change(composer, { target: { value: "Can you show sample code?" } });
    const sendButton = screen.getByRole("button", { name: "Send" });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(followupSent).toEqual({
        repo: "/Users/ada/Workspace/acme-billing",
        branch: "gs/invoice-export",
        targetBranch: "main",
        prompt: "Can you show sample code?",
        quotedText: undefined,
        sectionHeading: undefined,
      });
    });

    const clearButton = screen.getByRole("button", { name: "Clear thread" });
    fireEvent.click(clearButton);
    await waitFor(() => {
      expect(threadCleared).toBe(true);
      expect(store.getState().chatMessages).toHaveLength(0);
    });
  });

  it("selects model and effort from pickers and passes to review start", async () => {
    let reviewArgs: unknown = null;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "10.00" },
        review: null,
        chatMessages: [],
      }),
      ai_start_review: (args: unknown) => {
        reviewArgs = args;
        return null;
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();
    await store.getState().loadAiModels();

    const modelButton = screen.getByTitle("Model");
    expect(modelButton).toBeInTheDocument();
    fireEvent.click(modelButton);

    const bestModelOption = await screen.findByRole("button", { name: /Claude 3.7 Sonnet/i });
    fireEvent.click(bestModelOption);

    expect(store.getState().selectedModel).toBe("claude-3-7-sonnet");

    const effortButton = screen.getByTitle("Reasoning effort");
    expect(effortButton).toBeInTheDocument();
    fireEvent.click(effortButton);

    const highEffortOption = await screen.findByRole("button", { name: /High/i });
    fireEvent.click(highEffortOption);

    expect(store.getState().selectedEffort).toBe("high");

    const [runReviewButton] = screen.getAllByRole("button", { name: "Run review" });
    expect(runReviewButton).toBeDefined();
    if (!runReviewButton) throw new Error("Run review button not found");
    fireEvent.click(runReviewButton);

    await waitFor(() => {
      expect(reviewArgs).toEqual({
        repo: "/Users/ada/Workspace/acme-billing",
        branch: "gs/invoice-export",
        targetBranch: "main",
        model: "claude-3-7-sonnet",
        effort: "high",
      });
    });
  });

  it("handles multiple reviews switching and starting a new review", async () => {
    let loadedReviewId: number | null = null;
    let newReviewStarted = false;
    const r1 = {
      id: 1,
      repo: "/Users/ada/Workspace/acme-billing",
      branch: "gs/invoice-export",
      targetBranch: "main",
      reportMarkdown: "## Review 1\n\nFirst report.",
      costUsd: "0.10",
      headOid: "abc",
      baseOid: "def",
      model: "claude-3-5-sonnet",
      effort: "medium",
      createdAt: 1000,
      updatedAt: 1000,
      versions: [],
    };
    const r2 = {
      id: 2,
      repo: "/Users/ada/Workspace/acme-billing",
      branch: "gs/invoice-export",
      targetBranch: "main",
      reportMarkdown: "## Review 2\n\nSecond report.",
      costUsd: "0.15",
      headOid: "abc",
      baseOid: "def",
      model: "claude-3-7-sonnet",
      effort: "high",
      createdAt: 2000,
      updatedAt: 2000,
      versions: [],
    };
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: (args: unknown) => {
        const reviewId = (args as { reviewId?: number })?.reviewId;
        if (reviewId) loadedReviewId = reviewId;
        const active = reviewId === 1 ? r1 : r2;
        return {
          consentAccepted: true,
          account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
          review: active,
          reviews: [r2, r1],
          activeReviewId: active.id,
          chatMessages: [],
        };
      },
      ai_start_review: () => {
        newReviewStarted = true;
        return null;
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    expect(await screen.findByText("Review 2")).toBeInTheDocument();

    const switchBtn = screen.getByTitle("Review history");
    fireEvent.click(switchBtn);

    const review1Option = await screen.findByRole("button", { name: /Review #1/ });
    fireEvent.click(review1Option);

    await waitFor(() => {
      expect(loadedReviewId).toBe(1);
    });

    const newReviewBtn = screen.getByRole("button", { name: "New review" });
    fireEvent.click(newReviewBtn);
    await waitFor(() => {
      expect(newReviewStarted).toBe(true);
    });
  });

  it("handles cancelling re-run review dialog without deleting", async () => {
    let deletedReviewId: number | null = null;
    let reviewStarted = false;
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: {
          id: 42,
          repo: "/Users/ada/Workspace/acme-billing",
          branch: "gs/invoice-export",
          targetBranch: "main",
          reportMarkdown: "## Review 42",
          costUsd: "0.10",
          headOid: "abc",
          baseOid: "def",
          model: "claude-3-5-sonnet",
          effort: "medium",
          createdAt: 1000,
          updatedAt: 1000,
          versions: [],
        },
        reviews: [],
        activeReviewId: 42,
        chatMessages: [],
      }),
      ai_delete_review: (args: unknown) => {
        deletedReviewId = (args as { reviewId: number }).reviewId;
        return null;
      },
      ai_start_review: () => {
        reviewStarted = true;
        return null;
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();
    await store.getState().loadAiModels();

    const rerunButton = screen.getByRole("button", { name: "Re-run review" });
    fireEvent.click(rerunButton);

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(deletedReviewId).toBeNull();
    expect(reviewStarted).toBe(false);
  });

  it("renders report versions and handles revert", async () => {
    let revertedVersionNumber: number | null = null;
    const reviewWithVersions = {
      id: 5,
      repo: "/Users/ada/Workspace/acme-billing",
      branch: "gs/invoice-export",
      targetBranch: "main",
      reportMarkdown: "## Current Report (v2)",
      costUsd: "0.20",
      headOid: "abc",
      baseOid: "def",
      model: "claude-3-5-sonnet",
      effort: "medium",
      createdAt: 1000,
      updatedAt: 2000,
      versions: [
        {
          id: 101,
          reviewId: 5,
          versionNumber: 1,
          reportMarkdown: "## Initial Report (v1)",
          createdAt: 1000,
        },
        {
          id: 102,
          reviewId: 5,
          versionNumber: 2,
          reportMarkdown: "## Current Report (v2)",
          createdAt: 2000,
        },
      ],
    };
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: reviewWithVersions,
        reviews: [reviewWithVersions],
        activeReviewId: 5,
        chatMessages: [],
      }),
      ai_revert_version: (args: unknown) => {
        revertedVersionNumber = (args as { versionNumber: number }).versionNumber;
        return null;
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    expect(await screen.findByText("Version 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Current Report (v2)")).toBeInTheDocument();

    const prevButton = screen.getByTitle("Previous version");
    fireEvent.click(prevButton);

    expect(screen.getByText("Version 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Initial Report (v1)")).toBeInTheDocument();

    const revertButton = screen.getByRole("button", { name: "Revert to this version" });
    fireEvent.click(revertButton);

    await waitFor(() => {
      expect(revertedVersionNumber).toBe(1);
    });
  });

  it("shows 'No models available' when ACP reports no models", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "10.00" },
        review: null,
        reviews: [],
        activeReviewId: null,
        chatMessages: [],
      }),
      ai_get_models: () => ({
        models: [],
        efforts: [],
        defaultModel: "",
        defaultEffort: "",
      }),
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();
    await store.getState().loadAiModels();

    expect(screen.getAllByText("No models available").length).toBeGreaterThan(0);
    expect(screen.queryByTitle("Reasoning effort")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "There are currently no AI models available from the ACP agent. Ensure an ACP agent or language model server is running and configured.",
      ),
    ).toBeInTheDocument();
  });

  it("ensures current selected model is rendered in dropdown with fixed positioning", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "10.00" },
        review: null,
        reviews: [],
        activeReviewId: null,
        chatMessages: [],
      }),
      ai_get_models: () => ({
        models: [
          { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", description: null },
          { id: "claude-opus-5.5", name: "Claude Opus 5.5", description: null },
        ],
        efforts: [{ id: "medium", name: "Medium", description: null }],
        defaultModel: "gemini-3.8-flash",
        defaultEffort: "medium",
      }),
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    store.getState().setSelectedModel("Gemini 4 Argon");
    await store.getState().loadAiState();
    await store.getState().loadAiModels();

    const modelButton = screen.getByTitle("Model");
    expect(modelButton).toHaveTextContent("Gemini 4 Argon");

    fireEvent.click(modelButton);

    const popup = screen.getByRole("menu", { name: "Review model" });
    expect(popup).toHaveClass("app-model-picker");
    expect(popup.style.position).toBe("fixed");

    const argonOption = within(popup).getByRole("button", { name: /Gemini 4 Argon/i });
    expect(argonOption).toBeInTheDocument();
    expect(argonOption).toHaveClass("is-selected");
  });

  it("renders 13-category structured report with gauges, collapsible detail drawer, and operational risk sections", async () => {
    const structuredPayload = {
      schema_version: 1,
      overview: "Branch review: invoice export currency support",
      categories: [
        {
          id: "encapsulation",
          title: "Encapsulation",
          score: 9,
          summary: "Clean boundaries.",
          problems: [],
        },
        {
          id: "idempotency",
          title: "Idempotency",
          score: 8,
          summary: "Safe retries.",
          problems: [],
        },
        {
          id: "edge_cases",
          title: "Edge cases & inputs",
          score: 5,
          summary: "Currency header export accepts raw strings without ISO-4217 validation.",
          problems: [
            {
              title: "Unvalidated ISO-4217 currency code",
              description: "Reject blank or malformed currency codes before export.",
              location: "billing/InvoiceExporter.kt:41",
              severity: "high",
            },
          ],
        },
        {
          id: "error_handling",
          title: "Error handling",
          score: 7,
          summary: "Explicit error paths.",
          problems: [],
        },
        {
          id: "logs",
          title: "Logs",
          score: 9,
          summary: "Structured logs without secrets.",
          problems: [],
        },
        {
          id: "monitoring",
          title: "Monitoring",
          score: 8,
          summary: "Export latency metric added.",
          problems: [],
        },
        {
          id: "security",
          title: "Security",
          score: 3,
          summary: "Missing CSV formula escaping.",
          problems: [],
        },
        {
          id: "concurrency",
          title: "Concurrency",
          score: 9,
          summary: "Stateless exporter.",
          problems: [],
        },
        {
          id: "transactions",
          title: "Transactions & atomicity",
          score: 8,
          summary: "Single read transaction.",
          problems: [],
        },
        {
          id: "performance",
          title: "Performance",
          score: 9,
          summary: "Streaming writer.",
          problems: [],
        },
        {
          id: "breaking_changes",
          title: "Breaking changes",
          score: 7,
          summary: "Additive header column.",
          problems: [],
        },
        {
          id: "test_coverage",
          title: "Test coverage",
          score: 6,
          summary: "Covers happy path export.",
          problems: [
            {
              title: "Missing invalid currency test",
              description: "Add unit test for lowercase or invalid currency codes.",
              location: "billing/InvoiceExporterTest.kt:28",
              severity: "medium",
            },
          ],
          coverage_percent: 68,
          test_scenarios: ["Valid USD invoice export", "Empty invoice list export"],
        },
        {
          id: "dependencies",
          title: "New dependencies",
          score: 10,
          summary: "Uses standard library only.",
          problems: [],
          dependencies_introduced: false,
          dependency_tradeoff: "No new dependencies were introduced; zero supply-chain footprint.",
        },
      ],
      blast_radius: "Affects **invoice export** endpoints and CSV serializer.",
      deployment_risks: "Downstream CSV parsers must tolerate the new currency column.",
      rollback_plan: "Revert the currency-export commit and redeploy.",
    };

    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: {
          id: 10,
          repo: "/Users/ada/Workspace/acme-billing",
          branch: "gs/invoice-export",
          targetBranch: "main",
          reportMarkdown: JSON.stringify(structuredPayload),
          costUsd: "0.14",
          headOid: "abc",
          baseOid: "def",
          model: "claude-3-5-sonnet",
          effort: "medium",
          createdAt: 1000,
          updatedAt: 1000,
          versions: [],
        },
        reviews: [],
        activeReviewId: 10,
        chatMessages: [],
      }),
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    expect(
      await screen.findByText("Branch review: invoice export currency support"),
    ).toBeInTheDocument();

    const gaugeGroup = screen.getByRole("group", { name: "Review categories" });
    const gaugeButtons = within(gaugeGroup).getAllByRole("button");
    expect(gaugeButtons).toHaveLength(13);
    for (const btn of gaugeButtons) {
      expect(btn).toHaveAttribute("aria-expanded", "false");
    }

    const encapsulationBtn = within(gaugeGroup).getByRole("button", { name: /Encapsulation/i });
    expect(encapsulationBtn.querySelector(".dl-ai-gauge-ring")).toHaveClass("is-good");

    const edgeCasesBtn = within(gaugeGroup).getByRole("button", { name: /Edge cases & inputs/i });
    expect(edgeCasesBtn.querySelector(".dl-ai-gauge-ring")).toHaveClass("is-warn");

    const securityBtn = within(gaugeGroup).getByRole("button", { name: /Security/i });
    expect(securityBtn.querySelector(".dl-ai-gauge-ring")).toHaveClass("is-bad");

    expect(
      screen.queryByRole("region", { name: "Selected category details" }),
    ).not.toBeInTheDocument();

    fireEvent.click(edgeCasesBtn);
    expect(edgeCasesBtn).toHaveAttribute("aria-expanded", "true");
    const detailDrawer = screen.getByRole("region", { name: "Selected category details" });
    expect(
      within(detailDrawer).getByText(
        "Currency header export accepts raw strings without ISO-4217 validation.",
      ),
    ).toBeInTheDocument();
    expect(
      within(detailDrawer).getByText("Unvalidated ISO-4217 currency code"),
    ).toBeInTheDocument();
    expect(within(detailDrawer).getByText("high")).toBeInTheDocument();
    expect(within(detailDrawer).getByText("billing/InvoiceExporter.kt:41")).toBeInTheDocument();

    const coverageBtn = within(gaugeGroup).getByRole("button", { name: /Test coverage/i });
    fireEvent.click(coverageBtn);
    expect(coverageBtn).toHaveAttribute("aria-expanded", "true");
    expect(edgeCasesBtn).toHaveAttribute("aria-expanded", "false");
    expect(
      within(screen.getByRole("region", { name: "Selected category details" })).getByText(/68%/),
    ).toBeInTheDocument();
    expect(screen.getByText("Valid USD invoice export")).toBeInTheDocument();
    expect(screen.getByText("Empty invoice list export")).toBeInTheDocument();

    const depsBtn = within(gaugeGroup).getByRole("button", { name: /New dependencies/i });
    fireEvent.click(depsBtn);
    const depsDrawer = screen.getByRole("region", { name: "Selected category details" });
    expect(within(depsDrawer).getByText(/New dependency introduced: No/i)).toBeInTheDocument();
    expect(
      within(depsDrawer).getByText(
        "No new dependencies were introduced; zero supply-chain footprint.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(depsBtn);
    expect(
      screen.queryByRole("region", { name: "Selected category details" }),
    ).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Blast radius" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deployment risks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rollback plan" })).toBeInTheDocument();
    expect(screen.getByText("invoice export")).toBeInTheDocument();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const copyButton = screen.getByRole("button", { name: "Copy as Markdown" });
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0]?.[0]).toContain(
      "Branch review: invoice export currency support",
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("renders unified chat composer without toggle and displays Markdown follow-up replies below structured report", async () => {
    let followupSent: { prompt: string } | null = null;
    const structuredPayload = {
      schema_version: 1,
      overview: "Unified session review",
      categories: [
        { id: "encapsulation", title: "Encapsulation", score: 9, summary: "Good.", problems: [] },
      ],
      blast_radius: "Single module.",
      deployment_risks: "Low.",
      rollback_plan: "Revert commit.",
    };

    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: {
          id: 11,
          repo: "/Users/ada/Workspace/acme-billing",
          branch: "gs/invoice-export",
          targetBranch: "main",
          reportMarkdown: JSON.stringify(structuredPayload),
          costUsd: "0.12",
          headOid: "abc",
          baseOid: "def",
          model: "claude-3-5-sonnet",
          effort: "medium",
          createdAt: 1000,
          updatedAt: 1000,
          versions: [],
        },
        reviews: [],
        activeReviewId: 11,
        chatMessages: [
          {
            id: 1,
            repo: "/Users/ada/Workspace/acme-billing",
            branch: "gs/invoice-export",
            targetBranch: "main",
            role: "user",
            content: "How should we validate the currency code?",
            quotedText: null,
            costUsd: null,
            createdAt: 1001,
          },
          {
            id: 2,
            repo: "/Users/ada/Workspace/acme-billing",
            branch: "gs/invoice-export",
            targetBranch: "main",
            role: "assistant",
            content: "Use `Currency.getInstance(code)` inside **CurrencyValidator.kt**.",
            quotedText: null,
            costUsd: "0.01",
            createdAt: 1002,
          },
        ],
      }),
      ai_send_followup: (args: unknown) => {
        followupSent = args as { prompt: string };
        return null;
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    const session = await screen.findByRole("region", { name: "Interactive chat" });
    expect(within(session).getByText("Unified session review")).toBeInTheDocument();
    expect(
      within(session).getByText("How should we validate the currency code?"),
    ).toBeInTheDocument();
    expect(within(session).getByText("CurrencyValidator.kt")).toBeInTheDocument();

    const composer = within(session).getByPlaceholderText(
      "Ask about this review or request changes…",
    );
    fireEvent.change(composer, { target: { value: "Can you draft the test?" } });
    fireEvent.click(within(session).getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(followupSent?.prompt).toBe("Can you draft the test?");
    });
  });

  it("shows loading skeleton instead of raw JSON while initial review streams and disables follow-up composer", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "10.00" },
        review: null,
        reviews: [],
        activeReviewId: null,
        chatMessages: [],
      }),
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();
    store.setState({
      activeRun: {
        runId: "run-1",
        stage: "analysis",
        message: "Analyzing branch changes…",
        thoughts: [],
        cancellable: true,
      },
      reportMarkdown: '{"schema_version":1,"overview":"Streaming partial json',
    });

    await waitFor(() => {
      expect(document.querySelector(".dl-ai-skeleton")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Streaming partial json/)).not.toBeInTheDocument();
    const composer = screen.queryByPlaceholderText("Ask about this review or request changes…");
    if (composer) {
      expect(composer).toBeDisabled();
    }
  });

  it("disables or gates follow-up composer when activeReviewId is unavailable", async () => {
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "10.00" },
        review: null,
        reviews: [],
        activeReviewId: null,
        chatMessages: [],
      }),
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();
    store.setState({
      reportMarkdown: "## Legacy report without id",
      activeReviewId: null,
    });

    expect(await screen.findByText("Legacy report without id")).toBeInTheDocument();
    const composer = screen.queryByPlaceholderText("Ask about this review or request changes…");
    if (composer) {
      expect(composer).toBeDisabled();
    }
  });

  it("does not show top-level 'Review in progress' banner or report caret during follow-up turns", async () => {
    const structuredPayload = {
      schema_version: 1,
      overview: "Follow-up run distinction",
      categories: [
        { id: "encapsulation", title: "Encapsulation", score: 9, summary: "Clean.", problems: [] },
      ],
      blast_radius: "Single module.",
      deployment_risks: "Low.",
      rollback_plan: "Revert.",
    };
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: {
          id: 10,
          repo: "/Users/ada/Workspace/acme-billing",
          branch: "gs/invoice-export",
          targetBranch: "main",
          reportMarkdown: JSON.stringify(structuredPayload),
          costUsd: "0.14",
          headOid: "abc",
          baseOid: "def",
          model: "claude-3-5-sonnet",
          effort: "medium",
          createdAt: 1000,
          updatedAt: 1000,
          versions: [],
        },
        reviews: [],
        activeReviewId: 10,
        chatMessages: [],
      }),
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();
    expect(await screen.findByText("Follow-up run distinction")).toBeInTheDocument();

    store.setState({
      activeRun: {
        runId: "ai_followup",
        stage: "followup",
        message: "Analyzing follow-up question…",
        thoughts: [],
        cancellable: true,
      },
      streamingChat: "Checking CurrencyCode.kt",
    });

    await waitFor(() => {
      expect(screen.getByText("Checking CurrencyCode.kt")).toBeInTheDocument();
    });
    expect(screen.queryByText("Review in progress")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".dl-ai-session-stream > .dl-caret")).toHaveLength(0);
  });

  it("does not duplicate problem description when problem title is blank", async () => {
    const structuredPayload = {
      schema_version: 1,
      overview: "Blank title check",
      categories: [
        {
          id: "edge_cases",
          title: "Edge cases & inputs",
          score: 6,
          summary: "Input validation gap.",
          problems: [
            {
              title: "",
              description: "Missing null check on currency parameter.",
              location: "InvoiceExporter.kt:12",
              severity: "medium",
            },
          ],
        },
      ],
      blast_radius: "Low.",
      deployment_risks: "Low.",
      rollback_plan: "Revert.",
    };
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: {
          id: 12,
          repo: "/Users/ada/Workspace/acme-billing",
          branch: "gs/invoice-export",
          targetBranch: "main",
          reportMarkdown: JSON.stringify(structuredPayload),
          costUsd: "0.14",
          headOid: "abc",
          baseOid: "def",
          model: "claude-3-5-sonnet",
          effort: "medium",
          createdAt: 1000,
          updatedAt: 1000,
          versions: [],
        },
        reviews: [],
        activeReviewId: 12,
        chatMessages: [],
      }),
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    const edgeCasesBtn = await screen.findByRole("button", { name: /Edge cases & inputs/i });
    fireEvent.click(edgeCasesBtn);
    const detailDrawer = screen.getByRole("region", { name: "Selected category details" });
    expect(
      within(detailDrawer).getAllByText("Missing null check on currency parameter."),
    ).toHaveLength(1);
    expect(within(detailDrawer).getByText("medium")).toBeInTheDocument();
  });

  it("resets selectedId, prompt, and quotedSelection when switching activeReviewId", async () => {
    const makePayload = (overview: string) =>
      JSON.stringify({
        schema_version: 1,
        overview,
        categories: [
          {
            id: "encapsulation",
            title: "Encapsulation",
            score: 8,
            summary: `${overview} summary.`,
            problems: [],
          },
        ],
        blast_radius: "Low.",
        deployment_risks: "Low.",
        rollback_plan: "Revert.",
      });
    const r1 = {
      id: 1,
      repo: "/Users/ada/Workspace/acme-billing",
      branch: "gs/invoice-export",
      targetBranch: "main",
      reportMarkdown: makePayload("Review one"),
      costUsd: "0.10",
      headOid: "abc",
      baseOid: "def",
      model: "claude-3-5-sonnet",
      effort: "medium",
      createdAt: 1000,
      updatedAt: 1000,
      versions: [],
    };
    const r2 = {
      id: 2,
      repo: "/Users/ada/Workspace/acme-billing",
      branch: "gs/invoice-export",
      targetBranch: "main",
      reportMarkdown: makePayload("Review two"),
      costUsd: "0.15",
      headOid: "abc",
      baseOid: "def",
      model: "claude-3-7-sonnet",
      effort: "high",
      createdAt: 2000,
      updatedAt: 2000,
      versions: [],
    };
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: (args: unknown) => {
        const reviewId = (args as { reviewId?: number })?.reviewId;
        const active = reviewId === 1 ? r1 : r2;
        return {
          consentAccepted: true,
          account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
          review: active,
          reviews: [r2, r1],
          activeReviewId: active.id,
          chatMessages: [],
        };
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    expect(await screen.findByText("Review two")).toBeInTheDocument();
    const encapBtn = screen.getByRole("button", { name: /Encapsulation/i });
    fireEvent.click(encapBtn);
    const detailDrawer = screen.getByRole("region", { name: "Selected category details" });
    fireEvent.click(within(detailDrawer).getByRole("button", { name: "Ask about category" }));

    const composer = screen.getByPlaceholderText(
      "Ask about this review or request changes…",
    ) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "Draft follow-up" } });
    expect(composer.value).toBe("Draft follow-up");
    expect(document.querySelector(".dl-ai-composer .dl-ai-quote-text")).toHaveTextContent(
      "Review two summary.",
    );

    fireEvent.click(screen.getByTitle("Review history"));
    fireEvent.click(await screen.findByRole("button", { name: /Review #1/ }));

    expect(await screen.findByText("Review one")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Selected category details" }),
    ).not.toBeInTheDocument();
    expect(
      (
        screen.getByPlaceholderText(
          "Ask about this review or request changes…",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("");
    expect(document.querySelector(".dl-ai-composer .dl-ai-quote-text")).not.toBeInTheDocument();
  });

  it("preserves prompt and quotedSelection when aiSendFollowup fails", async () => {
    const structuredPayload = {
      schema_version: 1,
      overview: "Failure preservation test",
      categories: [
        {
          id: "security",
          title: "Security",
          score: 5,
          summary: "Check CSV escaping.",
          problems: [],
        },
      ],
      blast_radius: "Low.",
      deployment_risks: "Low.",
      rollback_plan: "Revert.",
    };
    const core = fakeCore({
      current_repo: () => repoInfo("acme-billing", "gs/invoice-export"),
      ai_get_state: () => ({
        consentAccepted: true,
        account: { id: "u1", email: "user@example.com", balanceUsd: "9.86" },
        review: {
          id: 15,
          repo: "/Users/ada/Workspace/acme-billing",
          branch: "gs/invoice-export",
          targetBranch: "main",
          reportMarkdown: JSON.stringify(structuredPayload),
          costUsd: "0.14",
          headOid: "abc",
          baseOid: "def",
          model: "claude-3-5-sonnet",
          effort: "medium",
          createdAt: 1000,
          updatedAt: 1000,
          versions: [],
        },
        reviews: [],
        activeReviewId: 15,
        chatMessages: [],
      }),
      ai_send_followup: () => {
        throw new Error("Network failure");
      },
    });

    const { store } = await renderWithStore(<AiReviewIsland />, core);
    await store.getState().loadAiState();

    const securityBtn = await screen.findByRole("button", { name: /Security/i });
    fireEvent.click(securityBtn);
    const detailDrawer = screen.getByRole("region", { name: "Selected category details" });
    fireEvent.click(within(detailDrawer).getByRole("button", { name: "Ask about category" }));

    const composer = screen.getByPlaceholderText(
      "Ask about this review or request changes…",
    ) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "Explain this security risk" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(store.getState().inlineError).toBe("Network failure");
    });
    expect(composer.value).toBe("Explain this security risk");
    expect(document.querySelector(".dl-ai-composer .dl-ai-quote-text")).toHaveTextContent(
      "Check CSV escaping.",
    );
  });
});
