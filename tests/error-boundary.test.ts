import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en, zh } from "../src/i18n/translations";

const boundary = readFileSync(new URL("../src/components/ErrorBoundary.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("page error boundary", () => {
  it("implements the React error boundary contract", () => {
    expect(boundary).toContain("static getDerivedStateFromError");
    expect(boundary).toContain("componentDidCatch");
  });

  it("wraps page content inside the layout so navigation survives a crash", () => {
    expect(app).toContain("<Layout><PageErrorBoundary resetKey={location.pathname}>{content}</PageErrorBoundary></Layout>");
  });

  it("clears the error when the route changes", () => {
    expect(boundary).toContain("previous.resetKey !== this.props.resetKey");
  });

  it("surfaces the message and a retry instead of a blank screen", () => {
    expect(boundary).toContain("data-error-boundary");
    expect(boundary).toContain('role="alert"');
    expect(boundary).toContain("this.state.message");
  });

  it("has both languages for every boundary string", () => {
    for (const key of ["error.boundaryTitle", "error.boundaryHint", "error.boundaryRetry"] as const) {
      expect(zh[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
});

describe("ci workflow", () => {
  it("runs the three checks that were previously manual only", () => {
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run build");
  });

  it("gates pull requests as well as pushes to main", () => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
  });
});
