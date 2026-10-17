// Runs the ILP off the main thread. Rebuilds the same deterministic coverage from (source, ems).
import highsLoader from "highs";
import wasmUrl from "highs/runtime?url";
import { leadInstance, loadLead } from "./data";
import { scenario, setLeadInstance, Source } from "./scenario";
import { solveIlp } from "./model/solvers";

export interface IlpRequest { id: number; source: Source; emsResponseS: number; budget: number }
export interface IlpReply { id: number; x?: Uint8Array; runtimeS?: number; status?: string; error?: string }

let leadReady = false;

self.onmessage = async (e: MessageEvent<IlpRequest>) => {
  const { id, source, emsResponseS, budget } = e.data;
  try {
    if (source.kind === "lead" && !leadReady) {
      const d = await loadLead();
      if (!d) throw new Error("lead.json not found");
      setLeadInstance(leadInstance(d));
      leadReady = true;
    }
    // A fresh HiGHS per solve: highs-js can corrupt its heap across repeated large solves.
    const highs = await highsLoader({ locateFile: () => wasmUrl });
    const sol = solveIlp(highs, scenario(source, emsResponseS).cov, budget);
    self.postMessage({ id, x: sol.x, runtimeS: sol.runtimeS, status: sol.status } satisfies IlpReply);
  } catch (err) {
    self.postMessage({ id, error: String(err) } satisfies IlpReply);
  }
};
