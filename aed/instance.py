"""The shared data contract every module reads and writes (spec section 4).

Coordinates are local metres; origin_latlon anchors them for mapping.
"""
from dataclasses import dataclass

import numpy as np


@dataclass
class Instance:
    cell_xy: np.ndarray           # (I, 2) metres, cell centroids
    cell_rate: np.ndarray         # (I, P) public OHCA per year in cell i during period p
    site_xy: np.ndarray           # (J, 2) metres
    site_cost: np.ndarray         # (J,) cost units, 1.0 = one standard AED
    site_floor_delay: np.ndarray  # (J,) seconds to reach the AED inside the building
    site_open: np.ndarray         # (J, P) bool, accessible in period p
    site_existing: np.ndarray     # (J,) bool, already has an AED
    site_kind: list[str]          # (J,) building type label
    periods: list[str]
    period_hours: np.ndarray      # (P,) hours per day in each period, sums to 24
    origin_latlon: tuple[float, float]

    @property
    def n_cells(self) -> int:
        return self.cell_xy.shape[0]

    @property
    def n_sites(self) -> int:
        return self.site_xy.shape[0]

    @property
    def n_periods(self) -> int:
        return len(self.periods)

    def validate(self) -> None:
        I, J, P = self.n_cells, self.n_sites, self.n_periods
        shapes = {
            "cell_xy": (self.cell_xy.shape, (I, 2)),
            "cell_rate": (self.cell_rate.shape, (I, P)),
            "site_xy": (self.site_xy.shape, (J, 2)),
            "site_cost": (self.site_cost.shape, (J,)),
            "site_floor_delay": (self.site_floor_delay.shape, (J,)),
            "site_open": (self.site_open.shape, (J, P)),
            "site_existing": (self.site_existing.shape, (J,)),
            "period_hours": (np.shape(self.period_hours), (P,)),
        }
        for name, (got, want) in shapes.items():
            if got != want:
                raise ValueError(f"{name} has shape {got}, expected {want}")
        if len(self.site_kind) != J:
            raise ValueError(f"site_kind has {len(self.site_kind)} entries, expected {J}")
        for name in ("cell_rate", "site_cost", "site_floor_delay"):
            if np.any(getattr(self, name) < 0):
                raise ValueError(f"{name} has negative values")
        if abs(float(np.sum(self.period_hours)) - 24.0) > 1e-6:
            raise ValueError("period_hours must sum to 24")
        for name in ("site_open", "site_existing"):
            if getattr(self, name).dtype != bool:
                raise ValueError(f"{name} must be a bool array")


M_PER_DEG_LAT = 111_320.0


def metres_to_latlon(xy: np.ndarray, origin_latlon: tuple[float, float]) -> np.ndarray:
    """Local (x east, y north) metres -> (N, 2) array of (lat, lon) degrees."""
    lat0, lon0 = origin_latlon
    xy = np.asarray(xy, dtype=float)
    lat = lat0 + xy[:, 1] / M_PER_DEG_LAT
    lon = lon0 + xy[:, 0] / (M_PER_DEG_LAT * np.cos(np.radians(lat0)))
    return np.column_stack([lat, lon])
