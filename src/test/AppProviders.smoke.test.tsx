import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsContext";

describe("App providers smoke", () => {
  it("SettingsProvider mounts children", () => {
    render(
      <SettingsProvider>
        <span data-testid="child">ok</span>
      </SettingsProvider>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("ok");
  });
});
