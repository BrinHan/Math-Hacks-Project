// Runs the ILP off the main thread. Rebuilds the same deterministic coverage from (seed, ems).
import highsLoader from "highs";
import wasmUrl from "highs/runtime?url";
import { scenario } from "./scenario";
import { solveIlp } from "./model/solvers";

export interface IlpRequest { id: number; seed: number; emsResponseS: number; budget: number }
export interface IlpReply { id: number; x?: Uint8Array; runtimeS?: number; status?: string; error?: string }

self.onmessage = async (e: MessageEvent<IlpRequest>) => {
  const { id, seed, emsResponseS, budget } = e.data;
  try {
    // A fresh HiGHS per solve: highs-js can corrupt its heap across repeated large solves.
    const highs = await highsLoader({ locateFile: () => wasmUrl });
    const sol = solveIlp(highs, scenario(seed, emsResponseS).cov, budget);
    self.postMessage({ id, x: sol.x, runtimeS: sol.runtimeS, status: sol.status } satisfies IlpReply);
  } catch (err) {
    self.postMessage({ id, error: String(err) } satisfies IlpReply);
  }
};
