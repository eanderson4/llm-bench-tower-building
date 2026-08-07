# LLM Tool Interface — Tower Building Benchmark

The LLM agent is given three tools (OpenAI-style function-calling schemas), defined in
`src/sdk/tools.ts` (`TOOL_DEFS`), plus a system-prompt doc (`SDK_DOC`, same file).

- Repo: https://github.com/eanderson4/llm-bench-tower-building
- Code: https://github.com/eanderson4/llm-bench-tower-building/blob/main/src/sdk/tools.ts

## Tools

### `get_inventory`
No parameters.

> List the blocks remaining in your inventory, with full shape and material specs. Blocks are used in the order you place them — any order is allowed.

### `observe`
No parameters.

> Get the current world state: status, remaining inventory, poses of all placed blocks, and tower stats (height, supported block count).

### `place_block`
> Place one block from your inventory into the world. The actual spawn pose and velocity are perturbed: sigmaX * sigmaV = K (challenge constant). `focus` trades position precision against velocity precision. The block then falls and the world simulates until it settles.

Parameters:

- `blockId` (string, **required**) — Id of a block in your remaining inventory.
- `position` (number[3], **required**) — Desired center [x, y, z] in meters. y is up; ground top is y=0.
- `focus` (number 0–1, **required**) — Precision allocation. 1 = max position precision (velocity very noisy), 0 = max velocity precision (position very noisy), 0.5 = balanced. `sigmaX = sigmaX0*(1-f)/f`, `sigmaV = sigmaV0*f/(1-f)`.
- `yawDeg` (number, optional) — Rotation about the vertical axis in degrees. Default 0.
- `orientation` (enum, optional) — `flat` | `side` | `upright`. Box: `flat` = height up (default), `side` = depth up, `upright` = standing on end (4.5x the height but a tiny, tippy footprint). Cylinder: `upright` (default) or `flat` (lying on its side — rolls; yaw picks the axis direction). Wedge: `flat` only.
- `quat` (number[4], optional) — Full-resolution rotation [x, y, z, w]. Takes precedence over orientation/yaw when given; normalized before use.
- `velocity` (number[3], optional) — Desired initial velocity [vx, vy, vz] in m/s — the MEAN of the sampled velocity. A small downward value (e.g. [0,-0.3,0]) is "placing with pressure". Magnitude is capped by the challenge maxSpeed. Default [0,0,0].

## SDK doc (system prompt)

```
# Tower Building SDK

## Goal
Build the tallest tower you can by placing every block in your inventory. The
score is the height of the tallest structure with a contact chain down to the
ground, measured after everything settles. A block dropped alone on empty
ground only scores its own height — stacking is what counts.

## World
- Units are meters. y is up. The ground plane's top surface is y = 0.
- Physics: gravity, collisions, friction, restitution — all simulated. Blocks
  can tip, slide, roll, and knock each other over.

## Rotation (pick your resolution)
- yawDeg: rotation about the vertical axis. Default 0.
- orientation: named poses. box: 'flat' (default), 'side', 'upright' (standing
  on end: 4.5x the height but a footprint that tips at ~12 degrees). cylinder:
  'upright' (default) or 'flat' (lying on its side — it rolls; yaw picks the
  axis). wedge: 'flat' only.
- quat: full-resolution [x, y, z, w] quaternion for arbitrary angles. Takes
  precedence over orientation/yaw when given. Use the quatFromAxisAngle helper
  rather than hand-rolling the math.

## Reading the tower (observe, and every place result)
- tower.height: supported height (the score) and supportedBlocks.
- tower.com: center of mass of the supported structure [x, y, z].
- tower.comMargin: how far the COM projection sits inside the base footprint,
  in meters. Near zero = on the edge; negative = overhanging — expect toppling.
- tower.baseWidth: smaller side of the base footprint (m).

## The uncertainty contract (READ CAREFULLY)
When you call place_block, the block does NOT spawn exactly where and how you
asked. The actual spawn position and velocity are Gaussian samples centered on
your request:

    sigmaX * sigmaV = K   (a constant of the challenge)

You control the trade-off with "focus" in [0, 1]:
- focus = 1: nearly exact position, but velocity is very noisy — the block may
  kick sideways at spawn and destabilize the tower.
- focus = 0: nearly exact velocity, but the block may appear offset from where
  you aimed — possibly overlapping the tower, which is dangerous.
- focus = 0.5: balanced (sigmaX = sigmaX0, sigmaV = sigmaV0).

The requested velocity is the MEAN of the sample. Requesting a slight downward
velocity (e.g. [0, -0.3, 0]) with some velocity precision is like a human
pressing a block gently into place. Dropping from height amplifies velocity
noise into impact energy; placing close to the support surface is gentler.

After each placement you learn the ACTUAL sampled position and velocity, the
sigmas that were applied, and the settled outcome — use that feedback. If the
world was still moving when the settle time cap was reached, the result is
reported as toppled with settleCapHit: true — treat that tower as unstable.

If the sampled spawn position overlaps an existing block, the physics resolves
the overlap — usually violently. There is no validation error for this; the
result reports it instead: spawnOverlap (bool) and spawnPenetration (meters).
Low position precision near the tower is how this happens.

## Utility functions (available in src/sdk/utils.ts; described here)
- rotatedExtents(shape, yawDeg) -> half-extents of the yaw-rotated AABB.
- stackCenterY(shape, supportTopY, clearance?) -> center-y to rest a block on
  a support whose top is at supportTopY.
- footprint(shape, center, yawDeg) / footprintsOverlap(a, b, margin?) ->
  horizontal overlap checks against existing blocks.
- previewSigmas(focus, noise) -> the sigmaX/sigmaV a focus value buys.
- rotateOffsetY(offset, yawDeg) -> rotate a local offset into world x/z.

## Strategy notes
- Towers fail by toppling: keep the center of mass over the support polygon.
- Wide bases and alternating yaw (brick-loom pattern) are robust to noise.
- In high-noise challenges, low placements with downward pressure beat drops.
- Validation errors are retryable and cost nothing; physics mistakes are not.

## Efficiency
- The place_block result already contains the settled tower stats and the
  block's final pose — you rarely need observe after every placement.
- place_blocks(placements: [...]) places up to 6 blocks sequentially in one
  call. Faster, but you forfeit adapting between batched placements — use it
  for the confident middle of a run; single placements when the tower gets
  tall or the last result surprised you.
```
