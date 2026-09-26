import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>界面遇到问题</h1>
        <p>工作空间文件没有被删除。请刷新后重新打开目录。</p>
      </main>
    ) : (
      this.props.children
    );
  }
}
