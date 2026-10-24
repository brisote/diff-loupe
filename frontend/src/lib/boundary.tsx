import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  onError: (error: unknown, componentStack?: string | null) => void;
  children: ReactNode;
};

export class Boundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError(error, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
