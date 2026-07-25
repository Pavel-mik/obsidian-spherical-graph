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

## Deterministic initialization

Initialize and Renew assign deterministically permuted Fibonacci-sphere points
to the sorted node order. A seed-derived tangent jitter breaks symmetries.
Changing a Renew generation changes the permutation and jitter, not merely a
global rotation.

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

## Convergence and final validation

A batch ends after stable low displacement for the configured number of
reports, the iteration budget, or cancellation. Progress is rate-limited and
contains scalar diagnostics only.

Before success the solver:

1. normalizes all positions;
2. rejects non-finite, zero, or incorrectly sized buffers;
3. computes maximum unit-norm error;
4. verifies every Refresh old-node displacement cap;
5. applies proper-rotation alignment when required;
6. returns the final position buffer once.

After the main thread validates and atomically commits that result, velocities,
forces, temperature, worker, and all other working state are discarded. No
layout computation continues in `fixed-clean` or `fixed-dirty`.

## Numerical conventions

- vector degeneracy checks use small deterministic fallbacks rather than random
  axes;
- dot products are clamped before inverse trigonometric operations;
- pair singularities and force magnitudes are capped;
- persisted and completed vectors must be finite and normalizable;
- stored vectors are normalized on load;
- validation tolerances are substantially smaller than visible node spacing and
  are covered by deterministic unit tests.
