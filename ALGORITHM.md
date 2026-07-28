# Intrinsic spherical layout algorithm

## Representation and distance

Each node position is a unit vector:

\[
u_i \in \mathbb{R}^3,\qquad \lVert u_i\rVert = 1.
\]

Latitude and longitude are diagnostics only. The stable geodesic angle is:

\[
d_{S^2}(u,v)=
\operatorname{atan2}(\lVert u\times v\rVert,
\operatorname{clamp}(u\cdot v,-1,1)).
\]

This treats points around \(+180^\circ/-180^\circ\) as neighbors and has no
rectangular-map seam.

### Derived tag orbit

Tag positions do not participate in this layout. A normalized tag identifier
is hashed deterministically to a unit vector \(q_t\), and its rendered
satellite center is:

\[
p_t = R_t q_t,\qquad
R_t = R_\text{globe}+h_t,\qquad
0.25 \le h_t \le 5.
\]

For a note direction \(u_i\), a tag link samples a spherical spiral. Its
direction follows the same deterministic SLERP used by geodesic edges while
the radius increases linearly:

\[
p(s)=
\left(R_0+s(R_t-R_0)\right)
\operatorname{SLERP}(u_i,q_t,s),\qquad s\in[0,1].
\]

The tag layer is derived from metadata on every render-snapshot rebuild. It is
never passed to Initialize, Refresh, Renew, the worker protocol, or persisted
position maps. A camera-to-tag segment/sphere intersection test suppresses a
satellite when the main globe lies in front of it, independently of the
selected surface mode.

An arbitrary vector is projected into the tangent plane at \(u\):

\[
P_u(f)=f-(u\cdot f)u.
\]

The tangent direction from \(u\) to \(v\) is the normalized projection of
\(v\). Nearly coincident and antipodal inputs use a deterministic orthogonal
axis derived from node-pair hashes; no uncontrolled `Math.random()` is used.

## Integration on \(S^2\)

For a tangent step \(\delta\), the exponential map is:

\[
\exp_u(\delta)=
\cos(\lVert\delta\rVert)u+
\sin(\lVert\delta\rVert)\frac{\delta}{\lVert\delta\rVert}.
\]

Small steps use a stable normalized approximation. After every move, position
is normalized and velocity is reprojected into the new tangent plane. The
integrator sums tangent forces, applies damping, caps angular velocity, applies
the exponential map, and then applies any Refresh anchor cone.

## Post-layout spatial geography

Geography is derived only after the solver has produced and validated the
final unit-vector buffer. The dependency order is strict:

1. compute the classic deterministic graph layout on \(S^2\);
2. fix the completed note positions;
3. choose an intrinsic spherical-grid resolution from observed note spacing;
4. evaluate an adaptive multi-scale density field;
5. construct and reconcile watershed basins;
6. select exclusive spatial continents and one connected ocean;
7. derive the render-only coast and beach geometry.

No value produced by steps 3–7 is present in `LayoutSolverInput`, the worker
protocol, force evaluation, or integration. In particular, there is no
geographic boundary force and no continent cap. This one-way dependency keeps
the map from becoming a self-fulfilling collection of circular regions.

### Soft graph-community prior

After positions are fixed, the note graph is also partitioned by a
deterministic multiresolution Constant Potts Model (CPM) local-moving
optimizer. It runs seeded orders at four resolutions, forms consensus
components within each resolution, and reconciles candidates using stability,
conductance, topology cohesion, and sublinear size signals. The existing
bounded affinity completion can recover uncertain graph-boundary notes.

These graph communities are marker priors, not continents by themselves.
They may lower or raise a watershed merge threshold, support a spatial basin,
contribute stability and conductance diagnostics, and help preserve a region's
semantic identity. They cannot choose an initial position, pull a node toward
a center, reserve surface area, or override the final spatial ownership.

### Intrinsic grid and adaptive density

The analytical surface is a deterministically subdivided icosahedron. Grid
resolution is selected from the characteristic sixth-neighbor angular spacing,
so a large dense vault receives finer cells without imposing one fixed global
map resolution. Every committed note is mapped to its nearest grid vertex, but
only notes with graph degree at least three participate in the spacing estimate
and continental density field.

Each note's sixth-neighbor distance supplies a locally adaptive bandwidth,
clamped around the global characteristic spacing. The density field combines a
fine compact kernel and a broader compact kernel with weights 0.82 and 0.18.
Dense local structures therefore retain detail while sparse but coherent areas
receive enough support to remain connected.

Degree filtering is cartographic rather than positional: it never changes a
committed vector. Orphan notes have zero land weight, and degree-one/two notes
are excluded from continent basins so sparse appendices cannot close an ocean
or enlarge a major landmass.

### Watershed and connected ocean

Every grid cell ascends deterministically to a neighboring density maximum,
forming initial watershed basins. Adjacent basins record their highest saddle.
Shallow saddles are merged by a deterministic union process. A shared CPM
prior can make a merge easier, conflicting priors make it harder, and small
unsupported basins use a conservative threshold; density remains the geometric
evidence in every case.

Candidate land basins must be sufficiently large and have either graph support
or spatial prominence above the local density background. At most seven are
retained. Ownership grows only through sufficiently dense cells in the
candidate's watershed basin, with eligible degree-three-or-higher node cells
protected as seeds.
Neighboring owners are separated by an explicit sea cell. The remaining sea
components are reconciled so the analytical map contains exactly one connected
ocean rather than accidental enclosed holes. Degree-one/two notes without a
selected owner remain island candidates; degree-zero notes remain ordinary
cities over ocean and create no land.

The final note assignments come from this exclusive spatial ownership, not
from the CPM assignment. Jaccard matching against the previous committed
geography may preserve a compatible continent's ID, label, and color. Its
center and diagnostic angular extent are always re-derived from the fixed
positions. That extent is metadata for labeling and rendering, never a layout
constraint.

## Deterministic initialization

Initialize and Renew always begin with a globally distributed, deterministically
permuted Fibonacci sphere plus small seeded tangent jitter. Community detection
is not consulted. The ordinary intrinsic springs, repulsion, and coverage
regularizers are then free to reveal topology over the full sphere. Changing a
Renew generation changes the permutation and jitter, not merely a global
rotation.

Refresh begins existing nodes exactly at their committed unit vectors. A new
node with committed neighbors begins near their weighted spherical mean plus a
small deterministic tangent jitter. A node without a usable neighbor begins at
a low-occupancy Fibonacci candidate. Invalid saved vectors are treated as
missing.

Graphs with zero, one, or two nodes have explicit stable paths.

## Edge springs

Every edge uses geodesic length and separate tangent directions at its two
endpoints:

\[
F_i^\text{spring} =
k_s\,g(w_{ij})\,(\theta_{ij}-\theta_{0,ij})
t_{i\rightarrow j}.
\]

The base target angle scales with expected surface spacing,
\(\sqrt{4\pi/n}\), and is clamped. Edge weight mildly shortens the target and
strengthens the spring without introducing a singularity.

## Repulsion

Below the exact threshold, each relevant pair receives a capped smooth
geodesic repulsion proportional to a regularized
\(\cot(\theta/2)\).

Above the threshold, an iteration combines:

- local collision pairs from a 3D spatial hash over the unit sphere; and
- a fixed number of deterministic seed-driven global negative samples per
  movable node.

This makes global pair evaluation \(O(nk)\) for fixed sample count, except for
genuinely crowded local cells. Refresh skips fixed–fixed force pairs.

## Coverage regularization

Repulsion alone is supplemented by two rotation-invariant surface-coverage
energies:

\[
\mu=\frac1n\sum_i u_i,\qquad E_\mu=\lVert\mu\rVert^2
\]

and

\[
C=\frac1n\sum_i u_i u_i^\mathsf{T},\qquad
E_C=\left\lVert C-\frac13I\right\rVert_F^2.
\]

Their negative tangent gradients discourage hemisphere collapse and a
degenerate great-circle distribution. Diagnostics report mean-vector norm and
second-moment values over the complete current graph.

## Refresh preservation

`RefreshPlanner` marks as directly affected:

- new nodes and their existing neighbors;
- endpoints of added, removed, or reweighted edges;
- existing neighbors of removed nodes;
- nodes affected by filter changes.

It expands this set by the configured number of graph hops. Remote old nodes
stay hard-fixed.

Refresh has two phases:

1. **New-node warm-up:** only new nodes move.
2. **Anchored local relaxation:** new nodes and affected old nodes move; all
   other old nodes remain fixed.

For a movable old node with committed anchor \(a_i\):

\[
E_\text{anchor} =
\lambda_i\,d_{S^2}(u_i,a_i)^2.
\]

The restoring force follows the geodesic direction toward \(a_i\). Directly
affected nodes use a weaker multiplier than boundary nodes. After proposing a
move, the solver geodesically clamps every old node to its configured maximum
angular displacement (12° by default) and records capped-node diagnostics.

If a large change leaves no stable fixed frame, a best proper 3D rotation
(Kabsch/orthogonal Procrustes without reflection) aligns shared nodes to the
previous snapshot. Proper rotation preserves every pairwise geodesic distance.

A Refresh with an empty diff is a no-op and never creates a worker. A change
above the warning ratio suggests Renew but does not switch modes automatically.

## Geodesic rendering

An edge from \(u\) to \(v\) uses normalized SLERP samples:

\[
q(t)=
\frac{\sin((1-t)\theta)}{\sin\theta}u+
\frac{\sin(t\theta)}{\sin\theta}v.
\]

Close points use normalized linear interpolation. Antipodes use a deterministic
hashed orthogonal plane. Every sampled point is normalized and scaled to
\(R+\varepsilon\), so edges follow the surface instead of cutting through the
sphere. Segment count adapts to angular length.

### Land and sea

The post-layout spatial geography is rendered on a finely subdivided
icosphere. Every degree-three-or-higher spatial-continent member seeds a
density-aware support kernel at its committed position. Samples along short
internal edges add narrow road corridors between nearby kernels. Edges longer
than a bounded angular distance do not add support, so a single graph link
cannot pull a land bridge across open water. The degree check is repeated at
render time so snapshots created by older plugin versions immediately gain the
new water/island behavior without regenerating or moving their layout.
All semantic continent positions are also indexed as territory sites: a closer
competing continent site carves sea out of another continent's support. A
single free note does not punch a lake into otherwise supported land. Free
notes acquire sea-carving influence only when at least two nearby graph-linked
free neighbors form a spatially coherent group whose internal weight is not
weaker than its continent-facing weight. Cartesian spatial buckets keep these
local queries bounded for large vaults.

After enclosed sea components are reconciled, the renderer expands only the
already connected external ocean, one weak coastal raster ring at a time.
Member support cells are protected, and candidate cells are ordered by land
density. The target is 34% for one continent, rises by 2.5 percentage points
for each additional continent, and is capped at 46%. This widens river-like
seams into readable seas without manufacturing inland lakes.

The persisted angular extent is a diagnostic summary, not a placement
constraint or coastline primitive. Coast ownership is the positive union of
node and short-road support with deterministic anisotropy and multi-scale
boundary variation. A dominance margin assigns at most one owner and
deliberately leaves sea where continent potentials compete. This lets one
landmass be concave or split around an unsupported gulf while guaranteeing
surface beneath its member cities.

Mixed land/sea triangles are clipped by bisection at the ownership boundary
instead of being accepted wholesale from their centroid. The outer ownership
mask forms a sand underlay; a second, deterministically varying inset mask
forms the land interior, leaving an irregular beach band. The outer
intersections also form the detailed coastline batch, eliminating regular mesh
teeth while retaining a deterministic irregular silhouette. Degree-one/two
notes are eligible for independent island patches. Candidates too close to
supported continent territory or another island are omitted, and island radius
decreases with note count. Degree-zero notes and any weak-note candidate
without a safe patch remain ordinary interactive cities over open water, so
layout, links, routes, labels, and persistence are unchanged. Eligible islands
are emitted as small irregular tangent patches in the same batched land mesh.

Ocean and land use separate offline procedural shaders. Seamless spherical
multi-octave noise supplies subtle water depth, terrain relief, strata, fine
grain, and restrained contour traces without image assets or runtime network
access. Ocean, land, coastlines, roads, markers, and graticule still have
separate materials, so geographic structure cannot be confused with links.

## Convergence and final validation

A batch ends after stable low displacement for the configured number of
reports, the iteration budget, or cancellation. Progress is rate-limited and
contains scalar diagnostics only.

Before the final snapshot is committed, the layout pipeline:

1. normalizes all positions;
2. rejects non-finite, zero, or incorrectly sized buffers;
3. computes maximum unit-norm error;
4. verifies every Refresh old-node displacement cap;
5. applies proper-rotation alignment when required;
6. returns the final position buffer once;
7. treats that buffer as fixed input to grid, density, watershed, and spatial
   region derivation;
8. atomically persists positions and the resulting semantic geography.

Geographic analysis cannot feed a result back into the solver. After the main
thread atomically commits the completed snapshot, velocities, forces,
temperature, worker, analytical grid, and all other working state are
discarded. No layout computation continues in `fixed-clean` or `fixed-dirty`.

## Numerical conventions

- vector degeneracy checks use small deterministic fallbacks rather than random
  axes;
- dot products are clamped before inverse trigonometric operations;
- pair singularities and force magnitudes are capped;
- persisted and completed vectors must be finite and normalizable;
- stored vectors are normalized on load;
- validation tolerances are substantially smaller than visible node spacing and
  are covered by deterministic unit tests.
