"""Sparse gradual-cover structure shared by every solver (spec section 5, incremental form).

One row per (cell i, period p, band k): weight = rate_ip * (b_k - b_{k+1}), and the row
marks the sites open in p that reach i within T_k. Sets are nested in k, so summing the
weights of covered rows telescopes to rate_ip * b(fastest band reached).
"""
from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp

from aed.instance import Instance
from aed.params import Params
from aed.survival import band_benefits


@dataclass
class Coverage:
    A: sp.csr_matrix          # (R, J) 0/1
    weights: np.ndarray       # (R,) expected lives per year if row r is covered
    row_cell: np.ndarray      # (R,) int
    row_period: np.ndarray    # (R,) int
    row_band: np.ndarray      # (R,) int
    site_cost: np.ndarray     # (J,)
    site_existing: np.ndarray  # (J,) bool
    n_periods: int

    @property
    def n_rows(self) -> int:
        return self.A.shape[0]

    def max_lives(self) -> float:
        """Lives saved with an AED at every site: an upper bound for any budget."""
        return float(self.weights.sum())

    def summary(self) -> dict:
        return {"rows": self.n_rows, "sites": self.A.shape[1], "nonzeros": int(self.A.nnz),
                "max_lives": round(self.max_lives(), 4)}


def build_coverage(inst: Instance, tau: np.ndarray, params: Params) -> Coverage:
    edges, b = band_benefits(params)
    delta_b = b - np.append(b[1:], 0.0)
    J = inst.n_sites
    rows_i, rows_p, rows_k, weights, coo_r, coo_c = [], [], [], [], [], []
    r0 = 0
    for k, (edge, db) in enumerate(zip(edges, delta_b)):
        if db <= 0:
            continue
        within = tau <= min(edge, params.max_tau_s)                 # (I, J)
        for q in range(inst.n_periods):
            mask = within & inst.site_open[None, :, q]
            w = inst.cell_rate[:, q] * db
            cells = np.flatnonzero((w > 0) & mask.any(axis=1))
            if cells.size == 0:
                continue
            ri, cj = np.nonzero(mask[cells])
            coo_r.append(ri + r0)
            coo_c.append(cj)
            rows_i.append(cells)
            rows_p.append(np.full(cells.size, q))
            rows_k.append(np.full(cells.size, k))
            weights.append(w[cells])
            r0 += cells.size

    def cat(parts, dtype):
        return np.concatenate(parts).astype(dtype) if parts else np.zeros(0, dtype)

    r, c = cat(coo_r, np.int64), cat(coo_c, np.int64)
    A = sp.csr_matrix((np.ones(r.size), (r, c)), shape=(r0, J))
    return Coverage(A=A, weights=cat(weights, float), row_cell=cat(rows_i, np.int64),
                    row_period=cat(rows_p, np.int64), row_band=cat(rows_k, np.int64),
                    site_cost=inst.site_cost.astype(float).copy(),
                    site_existing=inst.site_existing.copy(), n_periods=inst.n_periods)
