// Runs the ILP off the main thread. Rebuilds the same deterministic coverage from (source, ems).
import highsLoader from "highs";
import wasmUrl from "highs/runtime?url";
import { leadInstance, loadLead } from "./data";
import type { Instance } from "./model/instance";
import { hasInstance, scenario, setInstance, setLeadInstance, Source } from "./scenario";
import { solveIlp } from "./model/solvers";

export interface IlpRequest {
  id: number; source: Source; emsResponseS: number; budget: number;
  inst?: Instance; // sent for York and custom sources: the worker cannot see the page's memory
}
export interface IlpReply { id: number; x?: Uint8Array; runtimeS?: number; status?: string; error?: string }

self.onmessage = async (e: MessageEvent<IlpRequest>) => {
  const { id, source, emsResponseS, budget, inst } = e.data;
  try {
    if (source.kind === "lead" && !hasInstance(source)) {
      const d = await loadLead();
      if (!d) throw new Error("lead.json not found");
      setLeadInstance(leadInstance(d));
    }
    if ((source.kind === "custom" || source.kind === "york") && !hasInstance(source)) {
      if (!inst) throw new Error(`${source.kind} dataset missing from request`);
      setInstance(source, inst);
    }
    // A fresh HiGHS per solve: highs-js can corrupt its heap across repeated large solves.
    const highs = await highsLoader({ locateFile: () => wasmUrl });
    const sol = solveIlp(highs, scenario(source, emsResponseS).cov, budget);
    self.postMessage({ id, x: sol.x, runtimeS: sol.runtimeS, status: sol.status } satisfies IlpReply);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies IlpReply);
  }
};
