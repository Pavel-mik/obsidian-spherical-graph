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

## Directory-owned spherical geography

Vault paths provide stable semantic ownership before layout, while detailed
land geometry is still derived only after the solver has produced and
validated the final unit-vector buffer:

1. group linked notes by their first path segment;
2. allocate deterministic macro folder centers on \(S^2\);
3. split each folder into subdirectory and topology cohorts, grow irregular
   district centers, and create only an unconstrained starting state;
4. solve with full same-folder springs, reduced cross-folder springs, bounded
   graph-distance landmark stress, a local initial-geodesic mesh connecting
   every region of each folder, reduced same-folder long-range repulsion, and
   folder-centroid coverage;
5. apply relative coastal-port bias and a marker-aware S² collision projection;
6. validate and fix the completed note positions;
7. build adaptive land support plus one protected raster backbone for each
   folder, then expand one connected ocean to approximately half the surface;
8. derive render-only coast, beach, and linked-root-note island geometry.

The worker receives compact owner indexes, explicit sparse target angles,
render-aware marker radii, port hints, and optional Refresh anchor buffers. It
never receives rendered coastlines, density rasters, colors, labels, or land
ownership. No folder boundary is enforced in latitude/longitude, tangent space,
or by an intrinsic cap.

### Folder ownership and cross-folder roads

Every linked note under one top-level folder belongs to that folder's
continent, including degree-one and degree-two notes. Degree-zero notes do not
create land. A linked note directly in the vault root becomes an island.

Same-folder edges retain their full spring weight. A bounded scaffold gives
each node up to three local initial-geometry neighbors, fills disconnected
components, and adds a small spatial mesh between regions of the same folder.
Its targets are initialized intrinsic distances, not a common radius or
distance from a centroid. At most six scaffold pairs are added per folder node.
The long-range part of same-folder repulsion is scaled to 24%, while the
collision term and cross-folder repulsion remain full strength. This keeps a
two-dimensional, flexible silhouette without recreating a circular territory
or allowing different folders to overlap. Edges between top-level
folders use 14% of their graph weight for layout; edges involving a root note
use 35%. All edges retain their original weight for rendering, selection, and
Route Finder. Cross-folder endpoints can therefore approach useful coastal
directions without letting inter-folder topology dominate the internal layout.

### Fixed-position cartography

After the solver stops, each folder's fixed member directions and short
same-folder roads seed compact land-support kernels on a subdivided icosphere.
A deterministic bounded 3-D spatial index estimates local bandwidth without an
all-pairs member sort. Support ownership is exclusive; competing owners leave
sea between them.
Disconnected support components with the same directory owner are connected
by a deterministic least-cost tree on the intrinsic icosphere. This narrow
backbone is protected while detached support without a member is removed.
When a coherent compact layout starts with too much water, topology-aware
multi-owner dilation fills concavities and single-owner pockets while
preserving a sea separator between competing owners. Only the connected
external ocean is then eroded to 52%, plus bounded compensation for the visible
area of root-note islands. A smooth deterministic multi-scale spherical bias
makes erosion advance farther through weak shoreline sectors, forming broad
bays and headlands. Coastal-port scores affect only a bounded number of cells
on this connected-ocean frontier. Raster clearance remains authoritative in
the interior; a sub-cell member Voronoi override can resolve competing land
owners but never turns water into a false beach-ringed island.

Previous geography is matched using both complete paths and paths relative to
their top-level folder. This preserves continent identity and color through
ordinary Refreshes and multi-note top-level folder renames. Labels always use
the current folder name.

## Deterministic initialization

Initialize and Renew distribute folder centers with a deterministically
permuted Fibonacci sphere. Within each folder, the first two path segments and
connected components form stable cohorts; oversized cohorts are split by
balanced chunks along a deterministic strongest-road depth-first sweep. This
keeps consecutive members topologically local without manufacturing
breadth-first distance rings, and uses linear memory instead of one full
distance buffer per cohort. District centers grow through seeded asymmetric
tangent steps instead of occupying one common radius. Notes use graph-aware
seeded best-candidate samples around those districts, so no radial sequence or
circular boundary is introduced. Candidate budgets shrink for unusually large
folders while preserving the full visual search for ordinary vaults. Linked
root notes start near the weighted mean of the continents they reference.
Orphans use seeded random ocean samples with local separation and remain
hard-fixed during the solve, so coverage regularization cannot turn them back
into a uniform lattice. Changing a Renew generation changes all seeded samples.

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
strengthens the spring without introducing a singularity. In addition, a
constant number of deterministic landmark BFS traversals per region adds sparse
graph-distance targets for non-adjacent pairs. Each node initiates at most three
such constraints and each region uses at most eight landmarks, keeping work
bounded while preventing the many leaves of one hub from sharing one geodesic
radius.

## Repulsion

Below the exact threshold, each relevant pair receives a capped smooth
geodesic repulsion proportional to a regularized
\(\cot(\theta/2)\).

Above the threshold, an iteration combines:

- local collision pairs from a 3D spatial hash over the unit sphere; and
- a fixed number of deterministic seed-driven global negative samples per
  movable node.

This makes global pair evaluation \(O(nk)\) for fixed sample count, except for
genuinely crowded local cells. At very short angular distance, a bounded smooth
collision term augments the ordinary cotangent response. Refresh skips
fixed–fixed force pairs.

## Coverage regularization

Repulsion alone is supplemented by two rotation-invariant surface-coverage
energies evaluated over top-level folder centroids (with root islands as
individual samples):

\[
\mu=\frac1n\sum_i u_i,\qquad E_\mu=\lVert\mu\rVert^2
\]

and

\[
C=\frac1n\sum_i u_i u_i^\mathsf{T},\qquad
E_C=\left\lVert C-\frac13I\right\rVert_F^2.
\]

Their negative tangent gradients translate folder populations as macro bodies,
discouraging hemisphere collapse without radially expanding every city in a
large folder. Diagnostics still report mean-vector norm and second-moment values
over the complete current graph.

## Port bias and final collision projection

For each continent, external link mass, external share, destination diversity,
and outgoing directional coherence are converted to peer-relative percentiles.
Only a bounded, angularly separated set of high-scoring candidates becomes
ports. Immediately after force convergence, each selected bearing is recomputed
from the final positions of its real cross-folder neighbors; synthetic sparse
stress pairs are ignored. The city then moves toward a robust directional
support quantile of its observed folder shape, capped at a small intrinsic
angle; no shared continent radius is created.

After port placement, a deterministic Gauss-Seidel projection resolves marker
overlap directly on \(S^2\). Required separation is the sum of angular radii
derived from rendered disc size, Globe size, and optional degree scaling.
Refresh fixed nodes never move, and movable old nodes remain inside their
geodesic anchor caps. Fixed-fixed conflicts are reported but not falsified by
moving committed anchors.

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

The post-layout directory geography is rendered on a finely subdivided
icosphere. Every linked member of a top-level folder seeds a density-aware
support kernel at its committed position. Samples along short same-folder
edges add narrow road corridors between nearby kernels. Edges longer
than a bounded angular distance do not add support, so a single graph link
cannot pull a land bridge across open water. The degree check is repeated at
render time so snapshots created by older plugin versions immediately gain the
new water/island behavior without moving their committed layout.
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
density plus a deterministic smooth three-scale spherical coastal bias. The
target connected-ocean fraction is 52%, plus bounded compensation for
root-island area. This widens river-like seams, cuts broad bays into weak
sectors, and avoids circular macro outlines without manufacturing inland lakes.

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
teeth while retaining a deterministic irregular silhouette. Only linked notes
stored directly in the vault root are eligible for independent island patches.
Candidates too close to supported continent territory or another island are
omitted, and island radius decreases with note count. Degree-zero notes remain
ordinary interactive cities over open water. Eligible islands are emitted as
small irregular tangent patches in the same batched land mesh.

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
