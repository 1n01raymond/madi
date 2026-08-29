import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { encodeSpatialDemandIndex } from "../../compiler/src/spatial-demand.js";
import * as runtime from "../src/index.js";
import { runPackageFuzzCampaign } from "../../../scripts/lib/package-fuzz.mjs";
import {
  buildPackageFuzzTargets,
  controlledErrorNames,
  fuzzCorpora,
  loadFuzzCorpora,
  spatialDemandSeed,
} from "../../../scripts/lib/package-fuzz-targets.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Bounded rerun of the campaign recorded in artifacts/security/package-fuzz.
 * The record proves the reader over 120,000 mutated packages once; this keeps
 * the invariant it rests on -- nothing but a declared error class leaves a
 * reader -- inside `pnpm test`, where a regression is caught before it is
 * recorded.
 */
describe("malformed package campaign", () => {
  it("refuses every mutated package through a declared error class", async () => {
    const corpora = await loadFuzzCorpora(repositoryRoot, fuzzCorpora);
    const targets = buildPackageFuzzTargets({
      corpora,
      runtime,
      spatial: spatialDemandSeed(encodeSpatialDemandIndex),
    });
    expect(targets).toHaveLength(6);

    const campaign = runPackageFuzzCampaign({
      targets,
      iterations: 400,
      seed: 20_260_829,
      controlledErrorNames,
    });

    expect(campaign.uncontrolledSamples).toEqual([]);
    expect(campaign.totals.uncontrolled).toBe(0);
    expect(campaign.totals.executions).toBe(2_400);
    // Both outcomes have to occur, or a campaign that rejected everything --
    // or accepted everything -- would pass while testing nothing.
    for (const target of campaign.targets) {
      expect(target.accepted).toBeGreaterThan(0);
      expect(target.rejected).toBeGreaterThan(0);
      expect(target.accepted + target.rejected + target.uncontrolled).toBe(target.executions);
    }
  });
});
