import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PersonalLibrary } from "./personal-library";
import { usePersonalLibrary } from "./use-personal-library";

it("renders an explicit library action without selection or metadata requests", () => {
  function Host() {
    const library = usePersonalLibrary();
    return createElement(PersonalLibrary, {
      library,
      sourcePhrase: "",
      language: "ja",
      workTagIds: [],
      onWorkTagsChange: () => {},
      overlays: [],
    });
  }
  const html = renderToStaticMarkup(createElement(Host));
  expect(html).toContain("Load personal library");
  expect(html).not.toContain("Save personal phrase");
});

it("shows retained-record recovery separately from the usable library status", () => {
  function Host() {
    const library = usePersonalLibrary();
    return createElement(PersonalLibrary, {
      library: {
        ...library,
        pendingWarning:
          "Some saved edits cannot be read and remain unchanged on this device.",
      },
      sourcePhrase: "",
      language: "ja",
      workTagIds: [],
      onWorkTagsChange: () => {},
      overlays: [],
    });
  }
  const html = renderToStaticMarkup(createElement(Host));
  expect(html).toContain("Some saved edits cannot be read");
  expect(html).toContain("Recheck saved edits");
  expect(html).toContain("Load personal library");
});
