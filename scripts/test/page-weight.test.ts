import { describe, expect, it } from "vitest";
import { scriptSources } from "../page-weight";

describe("page-weight: the scripts a page loads up front", () => {
  it("lists each <script src> once and decodes entities, ignoring inline scripts", () => {
    const html = `<script src="/_next/a.js" async=""></script><script>self.x=1</script>
      <script nonce="n" src="/_next/b.js?v=1&amp;w=2"></script><script src="/_next/a.js"></script>`;
    expect(scriptSources(html)).toEqual(["/_next/a.js", "/_next/b.js?v=1&w=2"]);
  });
});
