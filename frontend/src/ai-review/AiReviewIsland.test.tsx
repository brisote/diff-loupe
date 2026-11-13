import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

    const chatButton = screen.getByRole("button", { name: "Chat" });
    fireEvent.click(chatButton);
    expect(store.getState().isChatOpen).toBe(true);

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
    store.setState({ isChatOpen: true });

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
});
