import { fireEvent, screen, waitFor } from "@testing-library/react";
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
            content: "Validation is in CurrencyCode.kt.",
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
    expect(screen.getByText("Validation is in CurrencyCode.kt.")).toBeInTheDocument();
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
});
