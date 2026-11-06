/* Island landmark props for the isometric eco-island: a south entrance gate,
 * cherry groves around the plaza and the flower fields, timber boardwalks and
 * lookout decks, small stepped cascades, lamps and signposts along the roads,
 * plus a few stone lanterns, barrels and benches. Pure geometry, no textures.
 *
 * Design notes (why it is built this way):
 * - Draw calls are the budget that matters on the map camera, so the layer
 *   commits exactly four meshes: one merged static geometry (gate, decks,
 *   cascades and the one-off props are unique objects that would each cost a
 *   draw call if they stayed separate) and one InstancedMesh per repeated
 *   family (cherries, lamps, signs). Nothing is a per-object Mesh.
 * - Every placement is decided before a single triangle is written, by four
 *   independent mulberry32 streams derived from the caller's seed. Independent
 *   streams keep the lamp spacing stable when the cherry count changes with
 *   the quality preset, while the whole layer still rebuilds byte-identical
 *   from the same seed and the same world input; the platform RNG is never
 *   consulted.
 * - Rejection sampling follows the map-wide contract: stay inside bounds, keep
 *   clear of every building circle (radius + 0.35), keep off the carriageway
 *   (route distance < 1.6) except the gate that straddles it and the lamps and
 *   signposts that line it, and stay above seaLevel + 0.55. Decks and cascades
 *   add their own footprint test because they are wide objects.
 * - The terrain is never modified. Decks plank per segment from sampled corner
 *   heights, cascades hang a thin water sheet down the measured local drop and
 *   drop back to a fixed fallback height when a map has no real ledge, so the
 *   river bed and the height field stay exactly as the caller built them.
 * - One MeshLambertMaterial with vertex colors is shared by all four meshes.
 *   Instance colors only modulate the authored vertex colors, so bark stays
 *   dark under a pink tint and the lamp shade stays warm yellow at night while
 *   the scene's own lights keep working. There is no light source here.
 * - instanceMatrix/instanceColor live on the InstancedMesh, not the geometry,
 *   so dispose() releases them explicitly and detaches the group.
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var DEFAULT_SEED = 0x4c4d4b31; /* 'LMK1' */
  var TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- helpers */

  function clamp(value, lo, hi) { return value < lo ? lo : value > hi ? hi : value; }
  function smooth(lo, hi, x) { var t = clamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); }
  function finite(value, fallback) { return typeof value === 'number' && isFinite(value) ? value : fallback; }

  // mulberry32: integer state only, so the stream is identical on every engine
  // and across repeat builds of the same seed.
  function randomStream(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Stable per-object jitter derived from the integer position, not from a
  // stream, so widening one family never reshuffles another family's tints.
  function hash01(ix, iz, salt) {
    var h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ (salt | 0);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Uniform grid of route samples: the 3x3 neighbourhood is exact for every
  // query radius up to `cell`, which is all the exclusions need.
  function PointGrid(cell) { this.cell = cell; this.buckets = {}; this.size = 0; }
  PointGrid.prototype.key = function (cx, cz) { return (cx + 4096) * 8192 + (cz + 4096); };
  PointGrid.prototype.add = function (x, z) {
    var key = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    var bucket = this.buckets[key];
    if (!bucket) { bucket = []; this.buckets[key] = bucket; }
    bucket.push(x, z);
    this.size++;
  };
  PointGrid.prototype.nearest = function (x, z, limit) {
    var cell = this.cell, cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    var best = limit * limit, bucket, dx, dz, d, i, gx, gz;
    for (gz = -1; gz <= 1; gz++) {
      for (gx = -1; gx <= 1; gx++) {
        bucket = this.buckets[this.key(cx + gx, cz + gz)];
        if (!bucket) continue;
        for (i = 0; i < bucket.length; i += 2) {
          dx = bucket[i] - x; dz = bucket[i + 1] - z; d = dx * dx + dz * dz;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best); // capped at `limit` when nothing is closer
  };

  /* ------------------------------------------------------------------ palette
   * Authored vertex colors in 0..1, sampled from the existing warm low-poly
   * palette (cream plaster, honey wood, dusty stone, sakura pink). Instance
   * colors only nudge these values, never replace them. */
  var BARK = [0.33, 0.25, 0.22];
  var BRANCH = [0.37, 0.28, 0.24];
  var CROWN_LOW = [0.90, 0.52, 0.66];
  var CROWN_MID = [0.99, 0.74, 0.82];
  var CROWN_HIGH = [1.0, 0.86, 0.90];
  var CROWN_TOP = [1.0, 0.94, 0.95];
  var WOOD = [0.63, 0.46, 0.32];
  var WOOD_WARM = [0.72, 0.54, 0.36];
  var WOOD_DARK = [0.40, 0.30, 0.25];
  var IRON = [0.29, 0.26, 0.24];
  var CREAM = [1.0, 0.93, 0.81];
  var STONE = [0.72, 0.66, 0.57];
  var STONE_DARK = [0.55, 0.51, 0.46];
  var GOLD = [0.95, 0.78, 0.40];
  var LAMP_GLOW = [1.0, 0.87, 0.55];
  var WATER = [0.45, 0.72, 0.82];
  var WATER_LIGHT = [0.72, 0.88, 0.93];
  var FOAM = [1.0, 0.98, 0.94];
  var GREEN = [0.42, 0.61, 0.36];
  var DARK = [0.27, 0.23, 0.21];

  /* ----------------------------------------------------------------- Builder
   * Always writes position/normal/color/uv/index so the layer stays compatible
   * with the scene traversals that expect those attributes (render quality,
   * weather, diagnostics). Flat per-face normals keep the low-poly read. */
  function Builder() { this.p = []; this.n = []; this.c = []; this.uv = []; this.index = []; }
  Builder.prototype.vertex = function (x, y, z, nx, ny, nz, r, g, b, u, v) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(r, g, b);
    this.uv.push(u, v);
    return this.p.length / 3 - 1;
  };
  // One flat-shaded face. `points` is 3 or 4 world/local positions; `hint` is
  // the outward direction so the winding can be corrected automatically.
  Builder.prototype.face = function (points, color, hint) {
    var count = points.length;
    var a = points[0], b = points[1], c = points[2];
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length < 1e-9) return;
    nx /= length; ny /= length; nz /= length;
    var order = points;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      order = points.slice().reverse();
      nx = -nx; ny = -ny; nz = -nz;
    }
    var ids = [];
    for (var i = 0; i < count; i++) {
      var p = order[i];
      ids.push(this.vertex(p[0], p[1], p[2], nx, ny, nz, color[0], color[1], color[2], i === 1 ? 1 : 0, i === 2 ? 1 : 0));
    }
    if (count === 4) this.index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    else this.index.push(ids[0], ids[1], ids[2]);
  };
  Builder.prototype.geometry = function (T) {
    var geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    if (this.index.length) geometry.setIndex(this.index);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };
  Builder.prototype.triangles = function () { return this.index.length / 3; };

  // Axis-aligned box, optionally rotated around Y, six flat faces (12 tris).
  Builder.prototype.box = function (cx, cy, cz, sx, sy, sz, color, yaw, topColor) {
    var hx = sx / 2, hy = sy / 2, hz = sz / 2;
    var cos = Math.cos(yaw || 0), sin = Math.sin(yaw || 0);
    function P(x, y, z) { return [cx + x * cos + z * sin, cy + y, cz - x * sin + z * cos]; }
    var c000 = P(-hx, -hy, -hz), c100 = P(hx, -hy, -hz), c110 = P(hx, -hy, hz), c010 = P(-hx, -hy, hz);
    var c001 = P(-hx, hy, -hz), c101 = P(hx, hy, -hz), c111 = P(hx, hy, hz), c011 = P(-hx, hy, hz);
    var self = this;
    function F(quad, color2) {
      var mx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4 - cx;
      var my = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4 - cy;
      var mz = (quad[0][2] + quad[1][2] + quad[2][2] + quad[3][2]) / 4 - cz;
      self.face(quad, color2 || color, [mx, my, mz]);
    }
    F([c001, c101, c111, c011], topColor || color);
    F([c000, c100, c110, c010]);
    F([c000, c100, c101, c001]);
    F([c010, c110, c111, c011]);
    F([c000, c010, c011, c001]);
    F([c100, c110, c111, c101]);
  };

  // Vertical (or tilted) n-gon column between two points. Sides only by
  // default: caps are optional because most columns end inside another part.
  Builder.prototype.column = function (cx, cy, cz, rBottom, rTop, height, sides, color, yaw, capTop, capBottom) {
    var i, j, angle, bottom = [], top = [];
    for (i = 0; i < sides; i++) {
      angle = (yaw || 0) + TAU * i / sides;
      bottom.push([cx + Math.cos(angle) * rBottom, cy, cz + Math.sin(angle) * rBottom]);
      top.push([cx + Math.cos(angle) * rTop, cy + height, cz + Math.sin(angle) * rTop]);
    }
    for (i = 0; i < sides; i++) {
      j = (i + 1) % sides;
      var mx = (bottom[i][0] + bottom[j][0]) / 2 - cx;
      var mz = (bottom[i][2] + bottom[j][2]) / 2 - cz;
      this.face([bottom[i], bottom[j], top[j], top[i]], color, [mx, 0, mz]);
    }
    if (capTop) {
      var centerTop = [cx, cy + height, cz];
      for (i = 0; i < sides; i++) this.face([centerTop, top[i], top[(i + 1) % sides]], color, [0, 1, 0]);
    }
    if (capBottom) {
      var centerBottom = [cx, cy, cz];
      for (i = 0; i < sides; i++) this.face([centerBottom, bottom[(i + 1) % sides], bottom[i]], color, [0, -1, 0]);
    }
  };

  // Tapered rod between two arbitrary points (branches, rails, posts).
  Builder.prototype.stick = function (from, to, r0, r1, sides, color, capTop) {
    var ax = to[0] - from[0], ay = to[1] - from[1], az = to[2] - from[2];
    var length = Math.sqrt(ax * ax + ay * ay + az * az);
    if (length < 1e-6) return;
    ax /= length; ay /= length; az /= length;
    // Any helper vector that is not parallel to the axis.
    var hx = Math.abs(ay) < 0.9 ? 0 : 1, hy = Math.abs(ay) < 0.9 ? 1 : 0, hz = 0;
    var ux = ay * hz - az * hy, uy = az * hx - ax * hz, uz = ax * hy - ay * hx;
    var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    var vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    var bottom = [], top = [], normals = [];
    for (var i = 0; i < sides; i++) {
      var angle = TAU * i / sides, c = Math.cos(angle), s = Math.sin(angle);
      var nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
      normals.push([nx, ny, nz]);
      bottom.push([from[0] + nx * r0, from[1] + ny * r0, from[2] + nz * r0]);
      top.push([to[0] + nx * r1, to[1] + ny * r1, to[2] + nz * r1]);
    }
    for (i = 0; i < sides; i++) {
      var j = (i + 1) % sides;
      var mx = (normals[i][0] + normals[j][0]) / 2;
      var my = (normals[i][1] + normals[j][1]) / 2;
      var mz = (normals[i][2] + normals[j][2]) / 2;
      this.face([bottom[i], bottom[j], top[j], top[i]], color, [mx, my, mz]);
    }
    if (capTop) {
      for (i = 0; i < sides; i++) this.face([to, top[i], top[(i + 1) % sides]], color, [ax, ay, az]);
    }
  };

  // Stacked sakura umbrella: one cone fan on top, one flat fan underneath.
  Builder.prototype.umbrella = function (cx, cy, cz, radius, height, sides, yaw, topColor, bottomColor) {
    var apex = [cx, cy + height, cz];
    var ring = [], i, angle;
    for (i = 0; i < sides; i++) {
      angle = (yaw || 0) + TAU * i / sides;
      ring.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle * 2) * radius * 0.06, cz + Math.sin(angle) * radius]);
    }
    var under = [cx, cy - radius * 0.09, cz];
    for (i = 0; i < sides; i++) {
      var j = (i + 1) % sides;
      this.face([ring[i], ring[j], apex], topColor, [0, 1, 0]);
      this.face([ring[j], ring[i], under], bottomColor, [0, -1, 0]);
    }
  };

  // Thin slab from four top corners (already in target space), 10 triangles:
  // top quad, four sides, open bottom because it always sits on terrain.
  Builder.prototype.slab = function (corners, thickness, color, topColor) {
    this.face(corners, topColor || color, [0, 1, 0]);
    var mx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
    var mz = (corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4;
    for (var i = 0; i < 4; i++) {
      var a = corners[i], b = corners[(i + 1) % 4];
      var a2 = [a[0], a[1] - thickness, a[2]], b2 = [b[0], b[1] - thickness, b[2]];
      var hx = (a[0] + b[0]) / 2 - mx, hz = (a[2] + b[2]) / 2 - mz;
      this.face([a, b, b2, a2], color, [hx, 0, hz]);
    }
  };

  /* --------------------------------------------------- repeated geometries --
   * One geometry per repeated family, instanced at every placement. Triangle
   * counts are fixed and reported by stats.triangles via the instance count. */

  // 82 triangles: 5-sided trunk, three branches, four umbrella crowns. The
  // instance color only nudges saturation, so bark stays dark and the upper
  // crowns read a little paler than the lower ones.
  function cherryGeometry(T) {
    var b = new Builder();
    b.stick([0, 0, 0], [0, 1.20, 0], 0.20, 0.12, 5, BARK);
    var branches = [[0.45, 1.05, 0.52], [2.60, 1.10, 0.40], [4.55, 1.02, 0.58]];
    for (var i = 0; i < 3; i++) {
      var angle = branches[i][0], rise = branches[i][1], reach = branches[i][2];
      b.stick([0, rise - 0.42, 0], [Math.cos(angle) * reach, rise + 0.34, Math.sin(angle) * reach], 0.075, 0.045, 4, BRANCH);
    }
    b.umbrella(0, 1.66, 0, 1.30, 0.46, 6, 0.0, CROWN_LOW, CROWN_LOW);
    b.umbrella(0.14, 1.98, -0.09, 1.08, 0.42, 6, 0.55, CROWN_MID, CROWN_MID);
    b.umbrella(-0.11, 2.26, 0.11, 0.84, 0.38, 6, 1.15, CROWN_HIGH, CROWN_HIGH);
    b.umbrella(0.05, 2.50, -0.05, 0.58, 0.34, 6, 1.75, CROWN_TOP, CROWN_TOP);
    return b.geometry(T);
  }

  // 42 triangles: stone plinth, slim post, warm shade and a little cap. No
  // light source of any kind; the shade is just a warm-colored box.
  function lampGeometry(T) {
    var b = new Builder();
    b.column(0, 0, 0, 0.20, 0.15, 0.26, 4, STONE_DARK, 0.4, true);
    b.column(0, 0.26, 0, 0.075, 0.062, 2.06, 5, IRON, 0, false);
    b.box(0, 2.53, 0, 0.46, 0.50, 0.46, LAMP_GLOW, 0.4);
    b.box(0, 2.79, 0, 0.52, 0.08, 0.52, WOOD_DARK, 0.4);
    b.column(0, 2.83, 0, 0.30, 0.02, 0.22, 4, WOOD_DARK, 0.4, false);
    b.box(0, 0.13, 0.17, 0.20, 0.13, 0.09, GOLD);
    return b.geometry(T);
  }

  // 37 triangles: post, board, small cap and two painted slats that stand in
  // for lettering (geometry color blocks, never a texture).
  function signGeometry(T) {
    var b = new Builder();
    b.column(0, 0, 0, 0.085, 0.07, 1.98, 4, WOOD_DARK, 0.2, true);
    b.box(0, 1.70, 0.05, 0.96, 0.54, 0.10, CREAM);
    b.box(0, 2.02, 0.05, 1.06, 0.08, 0.18, WOOD);
    b.face([[-0.36, 1.80, 0.105], [0.36, 1.80, 0.105], [0.30, 1.84, 0.105], [-0.30, 1.84, 0.105]], WOOD_DARK, [0, 0, 1]);
    b.face([[-0.30, 1.60, 0.105], [0.30, 1.60, 0.105], [0.18, 1.65, 0.105], [-0.18, 1.65, 0.105]], WOOD_DARK, [0, 0, 1]);
    b.face([[0.40, 1.92, 0.105], [0.52, 1.78, 0.105], [0.40, 1.64, 0.105]], GOLD, [0, 0, 1]);
    return b.geometry(T);
  }

  /* ------------------------------------------------------------------- build */

  function build(T, parent, options) {
    if (!T || typeof T.InstancedMesh !== 'function') throw new Error('MarioIslandLandmarks needs THREE');
    var opts = options || {};
    var geo = root.MarioWorldGeography || {};
    var heightAt = typeof opts.heightAt === 'function' ? opts.heightAt : (typeof geo.heightAt === 'function' ? geo.heightAt : null);
    if (!heightAt) throw new Error('MarioIslandLandmarks needs a heightAt function');

    var seaLevel = finite(opts.seaLevel, finite(geo.seaLevel, 0.48));
    var bounds = opts.bounds || geo.bounds || { minX: -102, maxX: 102, minZ: -87, maxZ: 87 };
    var quality = opts.quality === 'smooth' || opts.quality === 'detail' ? opts.quality : 'auto';
    var reducedMotion = !!opts.reducedMotion;
    var seed = (typeof opts.seed === 'number' && isFinite(opts.seed) ? opts.seed : DEFAULT_SEED) >>> 0;
    var minGround = seaLevel + 0.55;
    var edge = 1.6;

    // Independent streams: family counts never perturb each other.
    var entranceStream = randomStream(seed ^ 0x9e3779b9);
    var deckStream = randomStream(seed ^ 0x85ebca6b);
    var fallStream = randomStream(seed ^ 0xc2b2ae35);
    var cherryStream = randomStream(seed ^ 0x27d4eb2f);
    var roadStream = randomStream(seed ^ 0x165667b1);
    var propStream = randomStream(seed ^ 0x7feb352d);

    var group = new T.Group();
    group.name = 'island-landmarks';
    group.userData.islandLandmarks = true;
    if (parent && typeof parent.add === 'function') parent.add(group);

    /* ------------------------------------------------------ world input ------ */
    var buildingList = [];
    var rawBuildings = opts.buildings || [];
    for (var b = 0; b < rawBuildings.length; b++) {
      var rawBuilding = rawBuildings[b];
      if (!rawBuilding) continue;
      var buildingAnchor = rawBuilding.position || rawBuilding;
      var bx = finite(buildingAnchor.x, NaN), bz = finite(buildingAnchor.z, NaN);
      if (!isFinite(bx) || !isFinite(bz)) continue;
      buildingList.push({ x: bx, z: bz, radius: Math.max(0.6, finite(rawBuilding.radius, 1.4)) });
    }

    var regionList = [];
    var rawRegions = opts.regions || geo.regions || [];
    for (var r = 0; r < rawRegions.length; r++) {
      var rawRegion = rawRegions[r];
      if (!rawRegion) continue;
      var regionAnchor = rawRegion.position || rawRegion;
      var rx = finite(regionAnchor.x, NaN), rz = finite(regionAnchor.z, NaN);
      if (!isFinite(rx) || !isFinite(rz)) continue;
      regionList.push({ id: rawRegion.id || '', x: rx, z: rz });
    }
    function findRegion(id, fallbackIndex) {
      for (var i = 0; i < regionList.length; i++) if (regionList[i].id === id) return regionList[i];
      return regionList[fallbackIndex] || null;
    }

    // Routes: keep dense world-space nodes per route (for arc-length furniture
    // spacing) plus one sample grid for the 1.6 m carriageway exclusion.
    var routeGrid = new PointGrid(4);
    var routeNodes = [];
    var rawRoutes = opts.routes || [];
    for (var q = 0; q < rawRoutes.length; q++) {
      var rawRoute = rawRoutes[q] || {};
      var rawPoints = rawRoute.points || [];
      var nodes = [];
      for (var p = 0; p < rawPoints.length; p++) {
        var point = rawPoints[p];
        if (!point) continue;
        var px = Array.isArray(point) ? point[0] : point.x;
        var pz = Array.isArray(point) ? point[2] : point.z;
        if (!isFinite(px) || !isFinite(pz)) continue;
        nodes.push({ x: px, z: pz });
        routeGrid.add(px, pz);
      }
      if (nodes.length > 1) {
        var route = { nodes: nodes, length: 0, offsets: [0] };
        for (var n = 1; n < nodes.length; n++) {
          route.length += Math.hypot(nodes[n].x - nodes[n - 1].x, nodes[n].z - nodes[n - 1].z);
          route.offsets.push(route.length);
        }
        if (route.length > 2) routeNodes.push(route);
      }
    }
    routeNodes.sort(function (a, c) { return c.length - a.length; });
    var totalRouteLength = 0;
    for (var t = 0; t < routeNodes.length; t++) totalRouteLength += routeNodes[t].length;

    // Point on a route at an arc-length distance, plus the local tangent.
    function sampleRoute(route, distance) {
      var d = clamp(distance, 0, route.length);
      var lo = 0, hi = route.offsets.length - 1;
      while (lo < hi - 1) {
        var mid = (lo + hi) >> 1;
        if (route.offsets[mid] <= d) lo = mid; else hi = mid;
      }
      var a = route.nodes[lo], c = route.nodes[hi];
      var span = route.offsets[hi] - route.offsets[lo] || 1;
      var f = clamp((d - route.offsets[lo]) / span, 0, 1);
      var x = a.x + (c.x - a.x) * f, z = a.z + (c.z - a.z) * f;
      var tangent = { x: (c.x - a.x) / span, z: (c.z - a.z) / span };
      var tl = Math.hypot(tangent.x, tangent.z) || 1;
      tangent.x /= tl; tangent.z /= tl;
      return { x: x, z: z, tangent: tangent };
    }

    /* ------------------------------------------------------ placement rules -- */
    function inside(x, z, pad) {
      return x >= bounds.minX + pad && x <= bounds.maxX - pad && z >= bounds.minZ + pad && z <= bounds.maxZ - pad;
    }
    function roadDistance(x, z) {
      return routeGrid.size ? routeGrid.nearest(x, z, 4) : 99;
    }
    function buildingDistance(x, z) {
      var best = 99;
      for (var i = 0; i < buildingList.length; i++) {
        var dx = x - buildingList[i].x, dz = z - buildingList[i].z;
        best = Math.min(best, Math.hypot(dx, dz) - buildingList[i].radius - 0.35);
      }
      return best;
    }
    function groundHeight(x, z) {
      var h = heightAt(x, z);
      return isFinite(h) ? h : -1e9;
    }
    var occupied = [];
    function reserve(x, z, radius) { occupied.push({ x: x, z: z, radius: radius }); }
    function overlaps(x, z, radius) {
      for (var i = 0; i < occupied.length; i++) {
        var dx = x - occupied[i].x, dz = z - occupied[i].z;
        var reach = radius + occupied[i].radius;
        if (dx * dx + dz * dz < reach * reach) return true;
      }
      return false;
    }
    // Shared gate for every family: bounds, water, buildings, spacing.
    function clearSite(x, z, radius) {
      if (!inside(x, z, edge)) return false;
      if (groundHeight(x, z) < minGround) return false;
      if (buildingDistance(x, z) < 0) return false;
      if (overlaps(x, z, radius)) return false;
      return true;
    }
    // Wide objects (decks, cascades) test their whole footprint, not just the
    // centre: nine samples across the rectangle must all be dry land.
    function footprintClear(x, z, yaw, length, width, minRoad, waterLimit) {
      var floor = waterLimit === undefined ? minGround - 0.08 : waterLimit;
      var cos = Math.cos(yaw), sin = Math.sin(yaw);
      for (var a = -1; a <= 1; a++) {
        for (var c = -1; c <= 1; c++) {
          var lx = c * width * 0.5, lz = a * length * 0.5;
          var px = x + lx * cos + lz * sin, pz = z - lx * sin + lz * cos;
          if (!inside(px, pz, edge * 0.8)) return false;
          if (groundHeight(px, pz) < floor) return false;
          if (minRoad > 0 && routeGrid.size && roadDistance(px, pz) < minRoad) return false;
          if (buildingDistance(px, pz) < 0) return false;
        }
      }
      return true;
    }

    var placements = [];
    function record(family, x, z) { placements.push({ family: family, x: x, z: z }); }

    /* ------------------------------------------------------------ counts ---- */
    var counts = {
      smooth: { cherries: 20, lamps: 20, signs: 10 },
      auto: { cherries: 25, lamps: 26, signs: 14 },
      detail: { cherries: 28, lamps: 30, signs: 18 }
    }[quality];

    /* -------------------------------------------------- 1. entrance gate ---- */
    // The southern-most route sample is the road end the gate belongs to; the
    // gate straddles the carriageway there and faces along the road.
    // Prefer the dry southern-most road end: a route that ends on a bridge or
    // runs into the sea must not leave the gate floating over water.
    var gateCandidates = [];
    for (var ri = 0; ri < routeNodes.length; ri++) {
      var route = routeNodes[ri];
      for (var ni = 0; ni < route.nodes.length; ni++) {
        var node = route.nodes[ni];
        var back = ni > 0 ? route.nodes[ni - 1] : route.nodes[Math.min(1, route.nodes.length - 1)];
        var tx = node.x - back.x, tz = node.z - back.z;
        var tlen = Math.hypot(tx, tz) || 1;
        gateCandidates.push({ x: node.x, z: node.z, tx: tx / tlen, tz: tz / tlen });
      }
    }
    gateCandidates.sort(function (a, c) { return c.z - a.z; });
    var gatePoint = null, gateX = 0, gateZ = 0, gateGround = 0;
    for (var gi = 0; gi < gateCandidates.length; gi++) {
      var candidate = gateCandidates[gi];
      var cx = clamp(candidate.x - candidate.tx * 2.6, bounds.minX + 3.4, bounds.maxX - 3.4);
      var cz = clamp(candidate.z - candidate.tz * 2.6, bounds.minZ + 3.4, bounds.maxZ - 3.4);
      if (groundHeight(cx, cz) < minGround) continue;
      if (buildingDistance(cx, cz) < 0) continue;
      gatePoint = candidate;
      gateX = cx;
      gateZ = cz;
      gateGround = groundHeight(cx, cz);
      break;
    }
    if (!gatePoint) {
      // No dry road end at all: park the gate just inside the south bound.
      gatePoint = { x: (bounds.minX + bounds.maxX) / 2, z: bounds.maxZ - 7, tx: 0, tz: -1 };
      gateX = clamp(gatePoint.x, bounds.minX + 3.4, bounds.maxX - 3.4);
      gateZ = clamp(gatePoint.z, bounds.minZ + 3.4, bounds.maxZ - 3.4);
      gateGround = Math.max(minGround, groundHeight(gateX, gateZ));
    }
    var gateYaw = Math.atan2(gatePoint.tx, gatePoint.tz);
    var gateSite = { x: gateX, z: gateZ, y: gateGround, yaw: gateYaw };
    record('entrance', gateX, gateZ);
    reserve(gateX, gateZ, 3.0);

    /* -------------------------------------------------- 2. decks ------------ */
    // Timber boardwalks and lookouts sit around the flower fields and the lake,
    // extending outward from the region anchor so they never grow out of a
    // building or across a road.
    var deckAnchors = [];
    var gardenRegion = findRegion('gardens', 0);
    var lakeRegion = findRegion('lake', 1);
    if (gardenRegion) deckAnchors.push({ x: gardenRegion.x, z: gardenRegion.z, phase: 0.4 });
    if (lakeRegion && lakeRegion !== gardenRegion) deckAnchors.push({ x: lakeRegion.x, z: lakeRegion.z, phase: 2.1 });
    if (!deckAnchors.length) deckAnchors.push({ x: (bounds.minX + bounds.maxX) / 2, z: bounds.minZ + 18, phase: 0 });
    var deckTarget = 5;
    var deckSites = [];
    var deckLength = 8.4, deckWidth = 2.5;
    for (var da = 0; da < deckAnchors.length && deckSites.length < deckTarget; da++) {
      var anchor = deckAnchors[da];
      // Two decks per anchor, except the last anchor which mops up the rest.
      var want = da === deckAnchors.length - 1 ? deckTarget - deckSites.length : Math.min(2, deckTarget - deckSites.length);
      var made = 0;
      for (var ring = 0; ring <= 14 && made < want; ring++) {
        var radius = 7.4 + ring * 1.35;
        var steps = Math.max(10, Math.round(radius * 1.25));
        for (var step = 0; step < steps && made < want; step++) {
          var angle = anchor.phase + (step / steps) * TAU + ring * 0.37;
          var dx = Math.cos(angle), dz = Math.sin(angle);
          // Local +Z of the deck points outward from the anchor.
          var yaw = Math.atan2(dx, dz);
          var cx = anchor.x + dx * radius;
          var cz = anchor.z + dz * radius;
          if (!clearSite(cx, cz, 2.4)) continue;
          if (!footprintClear(cx, cz, yaw, deckLength, deckWidth, 1.7)) continue;
          var low = Infinity, high = -Infinity;
          for (var s = -1; s <= 1; s++) {
            for (var u = -1; u <= 1; u++) {
              var hx = cx + u * deckWidth * 0.5 * Math.cos(yaw) + s * deckLength * 0.5 * Math.sin(yaw);
              var hz = cz - u * deckWidth * 0.5 * Math.sin(yaw) + s * deckLength * 0.5 * Math.cos(yaw);
              var h = groundHeight(hx, hz);
              low = Math.min(low, h);
              high = Math.max(high, h);
            }
          }
          if (high - low > 2.6) continue; // too steep for a plank walk
          deckSites.push({ x: cx, z: cz, y: high + 0.12, yaw: yaw, length: deckLength, width: deckWidth });
          reserve(cx, cz, 2.5);
          record('deck', cx, cz);
          made++;
        }
      }
    }

    // Lakeside fallback: when the shore around the flower fields and the lake is
    // too tight for five dry decks, let a boardwalk reach out over shallow
    // water. The planks still sample the terrain and never edit it.
    if (deckSites.length < 4) {
      for (var da2 = 0; da2 < deckAnchors.length && deckSites.length < deckTarget; da2++) {
        var anchor2 = deckAnchors[da2];
        var want2 = deckTarget - deckSites.length;
        var made2 = 0;
        for (var ring2 = 0; ring2 <= 16 && made2 < want2; ring2++) {
          var radius2 = 8 + ring2 * 1.45;
          var steps2 = Math.max(10, Math.round(radius2 * 1.2));
          for (var step2 = 0; step2 < steps2 && made2 < want2; step2++) {
            var angle2 = anchor2.phase + 0.85 + (step2 / steps2) * TAU + ring2 * 0.41;
            var dx2 = Math.cos(angle2), dz2 = Math.sin(angle2);
            var yaw2 = Math.atan2(dx2, dz2);
            var cx2 = anchor2.x + dx2 * radius2, cz2 = anchor2.z + dz2 * radius2;
            if (!inside(cx2, cz2, 2.4)) continue;
            if (groundHeight(cx2, cz2) < seaLevel + 0.2) continue;
            if (buildingDistance(cx2, cz2) < 0) continue;
            if (overlaps(cx2, cz2, 2.4)) continue;
            if (!footprintClear(cx2, cz2, yaw2, deckLength, deckWidth, 1.7, seaLevel - 0.3)) continue;
            var high2 = -Infinity;
            for (var s2 = -1; s2 <= 1; s2++) {
              for (var u2 = -1; u2 <= 1; u2++) {
                var hx2 = cx2 + u2 * deckWidth * 0.5 * Math.cos(yaw2) + s2 * deckLength * 0.5 * Math.sin(yaw2);
                var hz2 = cz2 - u2 * deckWidth * 0.5 * Math.sin(yaw2) + s2 * deckLength * 0.5 * Math.cos(yaw2);
                high2 = Math.max(high2, groundHeight(hx2, hz2));
              }
            }
            high2 = Math.max(high2, seaLevel + 0.55);
            deckSites.push({ x: cx2, z: cz2, y: high2 + 0.12, yaw: yaw2, length: deckLength, width: deckWidth });
            reserve(cx2, cz2, 2.5);
            record('deck', cx2, cz2);
            made2++;
          }
        }
      }
    }

    /* -------------------------------------------------- 3. cascades --------- */
    // Cascades prefer a real local ledge near the lake/garden anchors. The
    // terrain is read, never written: the sheet simply hangs the measured drop
    // and falls back to a fixed 0.85 m spill on maps without a ledge.
    var fallTarget = 3;
    var fallSites = [];
    var fallAnchors = deckAnchors.slice(0, 2);
    function findFallSite(anchor, waterLimit) {
      var best = null, bestScore = -Infinity;
      for (var fring = 0; fring <= 12; fring++) {
        var fradius = 6.2 + fring * 1.45;
        var fsteps = Math.max(10, Math.round(fradius * 1.2));
        for (var fstep = 0; fstep < fsteps; fstep++) {
          var fangle = anchor.phase + 1.9 + (fstep / fsteps) * TAU + fring * 0.29;
          var fx = anchor.x + Math.cos(fangle) * fradius;
          var fz = anchor.z + Math.sin(fangle) * fradius;
          if (!clearSite(fx, fz, 2.0)) continue;
          if (!footprintClear(fx, fz, fangle, 3.4, 2.8, 2.0, waterLimit)) continue;
          // Steepest descent over eight directions decides the spill direction.
          var drop = 0, dropAngle = fangle;
          for (var k = 0; k < 8; k++) {
            var probe = fangle + k * TAU / 8;
            var probeH = groundHeight(fx + Math.cos(probe) * 2.4, fz + Math.sin(probe) * 2.4);
            var fallDrop = groundHeight(fx, fz) - probeH;
            if (fallDrop > drop) { drop = fallDrop; dropAngle = probe; }
          }
          var score = drop * 3 - fradius * 0.04;
          if (score > bestScore) {
            bestScore = score;
            best = { x: fx, z: fz, y: groundHeight(fx, fz), drop: drop, yaw: Math.atan2(Math.cos(dropAngle), Math.sin(dropAngle)) };
          }
        }
      }
      return best;
    }
    for (var fa = 0; fa < fallAnchors.length && fallSites.length < fallTarget; fa++) {
      var fallWant = fa === fallAnchors.length - 1 ? fallTarget - fallSites.length : 1;
      for (var fw = 0; fw < fallWant; fw++) {
        var bestFall = findFallSite(fallAnchors[fa]);
        if (!bestFall) break;
        fallSites.push({ x: bestFall.x, z: bestFall.z, y: bestFall.y, drop: Math.max(0.85, bestFall.drop + 0.18), yaw: bestFall.yaw });
        reserve(bestFall.x, bestFall.z, 2.0);
        record('fall', bestFall.x, bestFall.z);
      }
    }
    // Water-heavy maps: a cascade is allowed to spill straight into the lake,
    // so the footprint may cross the shoreline as long as the lip is dry.
    if (fallSites.length < 2) {
      for (var fa2 = 0; fa2 < fallAnchors.length && fallSites.length < fallTarget; fa2++) {
        var bestFall2 = findFallSite(fallAnchors[fa2], seaLevel - 0.35);
        if (!bestFall2) continue;
        if (overlaps(bestFall2.x, bestFall2.z, 2.0)) continue;
        fallSites.push({ x: bestFall2.x, z: bestFall2.z, y: bestFall2.y, drop: Math.max(0.95, bestFall2.drop + 0.18), yaw: bestFall2.yaw });
        reserve(bestFall2.x, bestFall2.z, 2.0);
        record('fall', bestFall2.x, bestFall2.z);
      }
    }

    /* -------------------------------------------------- 4. cherry groves ---- */
    // Groves wrap the plaza and the flower fields: an annulus 5.2..12.6 around
    // each anchor, 2.1 m apart, never on the road or inside a building.
    var cherryTarget = counts.cherries;
    var cherrySites = [];
    var plazaRegion = findRegion('collaboration', 0);
    var cherryAnchors = [];
    if (plazaRegion) cherryAnchors.push(plazaRegion);
    if (gardenRegion && gardenRegion !== plazaRegion) cherryAnchors.push(gardenRegion);
    if (!cherryAnchors.length) cherryAnchors.push({ x: 0, z: 0 });
    function tryCherry(ax, az, limit, attemptLimit) {
      var placed = 0;
      for (var i = 0; i < attemptLimit && cherrySites.length < limit; i++) {
        var angle = cherryStream() * TAU;
        var radius = 5.2 + cherryStream() * 7.4;
        var x = ax + Math.cos(angle) * radius;
        var z = az + Math.sin(angle) * radius;
        if (!inside(x, z, edge + 0.6)) continue;
        if (groundHeight(x, z) < minGround) continue;
        if (buildingDistance(x, z) < 0) continue;
        if (routeGrid.size && roadDistance(x, z) < 1.65) continue;
        if (overlaps(x, z, 1.05)) continue;
        cherrySites.push({ x: x, z: z, y: groundHeight(x, z) });
        reserve(x, z, 1.05);
        record('cherry', x, z);
        placed++;
      }
      return placed;
    }
    var perAnchor = Math.ceil(cherryTarget / cherryAnchors.length);
    for (var ca = 0; ca < cherryAnchors.length && cherrySites.length < cherryTarget; ca++) {
      var limit = ca === cherryAnchors.length - 1 ? cherryTarget : Math.min(cherryTarget, cherrySites.length + perAnchor);
      tryCherry(cherryAnchors[ca].x, cherryAnchors[ca].z, limit, 1800);
    }
    // Sparse maps: fill the remainder anywhere legal instead of shipping a
    // short grove.
    for (var fill = 0; fill < 900 && cherrySites.length < cherryTarget; fill++) {
      var fx2 = bounds.minX + edge + cherryStream() * (bounds.maxX - bounds.minX - edge * 2);
      var fz2 = bounds.minZ + edge + cherryStream() * (bounds.maxZ - bounds.minZ - edge * 2);
      if (groundHeight(fx2, fz2) < minGround) continue;
      if (buildingDistance(fx2, fz2) < 0) continue;
      if (routeGrid.size && roadDistance(fx2, fz2) < 1.65) continue;
      if (overlaps(fx2, fz2, 1.05)) continue;
      cherrySites.push({ x: fx2, z: fz2, y: groundHeight(fx2, fz2) });
      reserve(fx2, fz2, 1.05);
      record('cherry', fx2, fz2);
    }

    /* -------------------------------------------------- 5. lamps + signs ---- */
    // Every 12..18 m of route one stop: a lamp on alternating sides, and on
    // every other stop a signpost across the carriageway. A second denser pass
    // fills the quota on short maps without ever doubling a spot up.
    var lampSites = [], signSites = [];
    function placeFurniture(kind, sample, offset) {
      var nx = -sample.tangent.z, nz = sample.tangent.x;
      // Try the preferred verge first, then the opposite one: a crossing road
      // or a switchback must never leave a lamp standing in a carriageway.
      for (var attempt = 0; attempt < 2; attempt++) {
        var side = attempt === 0 ? offset : -offset;
        var x = sample.x + nx * side, z = sample.z + nz * side;
        if (!inside(x, z, edge)) continue;
        if (groundHeight(x, z) < minGround) continue;
        if (buildingDistance(x, z) < 0) continue;
        if (routeGrid.size && roadDistance(x, z) < 1.5) continue;
        if (overlaps(x, z, 0.55)) continue;
        // Local +Z of a prop faces along the road.
        var yaw = Math.atan2(sample.tangent.x, sample.tangent.z);
        var site = { x: x, z: z, y: groundHeight(x, z), yaw: yaw };
        if (kind === 'lamp') lampSites.push(site); else signSites.push(site);
        reserve(x, z, 0.55);
        record(kind, x, z);
        return true;
      }
      return false;
    }
    var lampTarget = counts.lamps, signTarget = counts.signs;
    var pass, stopIndex = 0;
    for (pass = 0; pass < 3; pass++) {
      if (lampSites.length >= lampTarget && signSites.length >= signTarget) break;
      // The third, tightest pass only runs on very short road networks and
      // exists to keep the family above its 30-piece floor.
      var step = pass === 0 ? 14 : pass === 1 ? 8 : 5;
      for (var rr = 0; rr < routeNodes.length; rr++) {
        var line = routeNodes[rr];
        var walk = 2 + roadStream() * 8;
        while (walk < line.length - 1.5) {
          if (lampSites.length >= lampTarget && signSites.length >= signTarget) break;
          var spot = sampleRoute(line, walk);
          var side = (stopIndex % 2 === 0) ? 1 : -1;
          if (lampSites.length < lampTarget) placeFurniture('lamp', spot, side * (2.1 + roadStream() * 0.5));
          if (signSites.length < signTarget && stopIndex % 2 === 1) placeFurniture('sign', spot, -side * (2.15 + roadStream() * 0.35));
          walk += step + roadStream() * 4;
          stopIndex++;
        }
      }
    }

    /* -------------------------------------------------- 6. small props ------ */
    // Stone lanterns, barrels and benches dress the gate and the decks. They
    // are merged into the static geometry and count toward the triangle budget.
    var props = [];
    function tryProp(kind, ax, az, radii, spacing) {
      for (var i = 0; i < radii.length; i++) {
        for (var k = 0; k < 14; k++) {
          var angle = propStream() * TAU;
          var radius = radii[i];
          var x = ax + Math.cos(angle) * radius, z = az + Math.sin(angle) * radius;
          if (!inside(x, z, edge)) continue;
          if (groundHeight(x, z) < minGround) continue;
          if (buildingDistance(x, z) < 0) continue;
          if (routeGrid.size && roadDistance(x, z) < 1.7) continue;
          if (overlaps(x, z, spacing)) continue;
          props.push({ kind: kind, x: x, z: z, y: groundHeight(x, z), yaw: hash01(Math.floor(x * 9), Math.floor(z * 9), 57) * TAU });
          reserve(x, z, spacing);
          record('prop', x, z);
          return true;
        }
      }
      return false;
    }
    var gateFrame = Math.cos(gateYaw), gateSin = Math.sin(gateYaw);
    tryProp('lantern', gateX + -3.05 * gateFrame, gateZ - -3.05 * gateSin, [0], 0.8);
    tryProp('lantern', gateX + 3.05 * gateFrame, gateZ - 3.05 * gateSin, [0], 0.8);
    if (plazaRegion) tryProp('lantern', plazaRegion.x, plazaRegion.z, [5.6, 6.8, 8.0], 0.8);
    for (var pb = 0; pb < deckSites.length; pb++) {
      tryProp('barrel', deckSites[pb].x, deckSites[pb].z, [3.5, 4.4], 0.75);
      if (pb % 2 === 0) tryProp('bench', deckSites[pb].x, deckSites[pb].z, [3.6, 4.6], 0.9);
    }
    if (plazaRegion) {
      for (var pn = 0; pn < 3; pn++) tryProp('bench', plazaRegion.x, plazaRegion.z, [5.2, 6.4, 7.6], 0.9);
    }

    /* ------------------------------------------------------------ geometry -- */
    var staticBuilder = new Builder();

    function frameAt(x, y, z, yaw) {
      var cos = Math.cos(yaw), sin = Math.sin(yaw);
      return {
        at: function (lx, ly, lz) { return [x + lx * cos + lz * sin, y + ly, z - lx * sin + lz * cos]; },
        yaw: yaw
      };
    }

    /* 1. entrance gate: two posts on stone plinths, two beams, a plaster name
     * plaque with painted slats, a tiled cap and two warm lanterns. The gate
     * straddles the road so its posts land outside the 1.72 m carriageway. */
    if (gateSite) {
      var gf = frameAt(gateSite.x, gateSite.y, gateSite.z, gateSite.yaw);
      var postLeft = gf.at(-2.35, 0, 0), postRight = gf.at(2.35, 0, 0);
      var postY = gateSite.y;
      staticBuilder.column(postLeft[0], postY - 0.4, postLeft[2], 0.24, 0.19, 3.55, 5, WOOD_DARK, gateSite.yaw, false);
      staticBuilder.column(postRight[0], postY - 0.4, postRight[2], 0.24, 0.19, 3.55, 5, WOOD_DARK, gateSite.yaw, false);
      var plinthL = gf.at(-2.35, 0.14, 0), plinthR = gf.at(2.35, 0.14, 0);
      staticBuilder.box(plinthL[0], plinthL[1], plinthL[2], 0.86, 0.30, 0.86, STONE, gateSite.yaw);
      staticBuilder.box(plinthR[0], plinthR[1], plinthR[2], 0.86, 0.30, 0.86, STONE, gateSite.yaw);
      var lowerBeam = gf.at(0, 2.62, 0);
      staticBuilder.box(lowerBeam[0], lowerBeam[1], lowerBeam[2], 5.5, 0.26, 0.34, WOOD, gateSite.yaw);
      var upperBeam = gf.at(0, 3.18, 0);
      staticBuilder.box(upperBeam[0], upperBeam[1], upperBeam[2], 5.1, 0.24, 0.30, WOOD_WARM, gateSite.yaw);
      var plaque = gf.at(0, 2.92, 0.06);
      staticBuilder.box(plaque[0], plaque[1], plaque[2], 1.86, 0.62, 0.16, CREAM, gateSite.yaw);
      // Painted plaque strips, no text texture.
      staticBuilder.face([gf.at(-0.66, 2.97, 0.15), gf.at(0.66, 2.97, 0.15), gf.at(0.58, 3.02, 0.15), gf.at(-0.58, 3.02, 0.15)], GOLD, [0, 0, 1]);
      staticBuilder.face([gf.at(-0.42, 2.83, 0.15), gf.at(0.42, 2.83, 0.15), gf.at(0.30, 2.88, 0.15), gf.at(-0.30, 2.88, 0.15)], WOOD_DARK, [0, 0, 1]);
      // Two tiled roof halves, laid as thin slabs so the silhouette reads.
      staticBuilder.slab([gf.at(-2.6, 3.42, -0.62), gf.at(0, 3.78, -0.62), gf.at(0, 3.78, 0.12), gf.at(-2.6, 3.42, 0.12)], 0.14, WOOD_DARK, WOOD_WARM);
      staticBuilder.slab([gf.at(0, 3.78, -0.62), gf.at(2.6, 3.42, -0.62), gf.at(2.6, 3.42, 0.12), gf.at(0, 3.78, 0.12)], 0.14, WOOD_DARK, WOOD_WARM);
      var ridge = gf.at(0, 3.82, -0.25);
      staticBuilder.box(ridge[0], ridge[1], ridge[2], 4.4, 0.12, 0.2, WOOD_DARK, gateSite.yaw);
      // Angle braces as visible triangles under the upper beam.
      staticBuilder.face([gf.at(-2.0, 3.0, 0), gf.at(-1.35, 3.0, 0), gf.at(-2.06, 2.62, 0)], WOOD, [0, 0, 1]);
      staticBuilder.face([gf.at(2.0, 3.0, 0), gf.at(1.35, 3.0, 0), gf.at(2.06, 2.62, 0)], WOOD, [0, 0, 1]);
      // Two lanterns hung from the lower beam.
      var lanternL = gf.at(-1.52, 2.14, 0), lanternR = gf.at(1.52, 2.14, 0);
      staticBuilder.box(lanternL[0], lanternL[1], lanternL[2], 0.30, 0.38, 0.30, LAMP_GLOW, gateSite.yaw);
      staticBuilder.box(lanternR[0], lanternR[1], lanternR[2], 0.30, 0.38, 0.30, LAMP_GLOW, gateSite.yaw);
      var cordL0 = gf.at(-1.52, 2.33, 0), cordL1 = gf.at(-1.52, 2.60, 0);
      var cordR0 = gf.at(1.52, 2.33, 0), cordR1 = gf.at(1.52, 2.60, 0);
      staticBuilder.stick(cordL0, cordL1, 0.025, 0.025, 3, IRON);
      staticBuilder.stick(cordR0, cordR1, 0.025, 0.025, 3, IRON);
      // Three stone steps onto the road.
      var step = gf.at(0, 0.08, 1.35);
      staticBuilder.box(step[0], step[1], step[2], 2.8, 0.16, 1.3, STONE, gateSite.yaw);
      var stepTop = gf.at(0, 0.19, 1.05);
      staticBuilder.box(stepTop[0], stepTop[1], stepTop[2], 2.4, 0.12, 0.9, STONE_DARK, gateSite.yaw);
    }

    /* 2. boardwalks: per-segment planks that follow the sampled corner heights,
     * posts and rails on both sides, and a lookout platform at the far end. */
    function buildDeck(site) {
      var f = frameAt(site.x, site.y, site.z, site.yaw);
      var length = site.length, width = site.width;
      var segments = 8;
      var segLength = length / segments;
      var i;
      for (i = 0; i < segments; i++) {
        var z0 = -length / 2 + i * segLength, z1 = z0 + segLength - 0.05;
        var corners = [
          f.at(-width / 2, 0, z0), f.at(width / 2, 0, z0),
          f.at(width / 2, 0, z1), f.at(-width / 2, 0, z1)
        ];
        // Lift the plank to the highest sampled corner so it never sinks.
        var top = -Infinity;
        for (var k = 0; k < 4; k++) top = Math.max(top, groundHeight(corners[k][0], corners[k][2]));
        top += 0.12;
        for (var c = 0; c < 4; c++) corners[c] = [corners[c][0], top, corners[c][2]];
        staticBuilder.slab(corners, 0.13, WOOD_DARK, i % 2 ? WOOD : WOOD_WARM);
      }
      // Posts at both edges and rails between them.
      var postZ = [-length / 2 + 0.35, -length / 2 + length / 3, -length / 2 + length * 2 / 3, length / 2 - 0.35];
      var sideX = width / 2 - 0.13;
      for (var s = 0; s < 2; s++) {
        var sx = s === 0 ? -sideX : sideX;
        for (var p = 0; p < postZ.length; p++) {
          var base = f.at(sx, 0, postZ[p]);
          var baseY = groundHeight(base[0], base[2]) + 0.1;
          var topPost = [base[0], baseY + 0.86, base[2]];
          staticBuilder.stick([base[0], baseY - 0.22, base[2]], topPost, 0.06, 0.05, 4, WOOD_DARK);
        }
        for (var r = 0; r < postZ.length - 1; r++) {
          var a = f.at(sx, 0, postZ[r]), b = f.at(sx, 0, postZ[r + 1]);
          var ay = groundHeight(a[0], a[2]) + 0.95, by = groundHeight(b[0], b[2]) + 0.95;
          staticBuilder.stick([a[0], ay, a[2]], [b[0], by, b[2]], 0.045, 0.045, 4, WOOD_WARM);
          var ay2 = ay - 0.34, by2 = by - 0.34;
          staticBuilder.stick([a[0], ay2, a[2]], [b[0], by2, b[2]], 0.035, 0.035, 3, WOOD);
        }
      }
      // Lookout pad at the far end: a wider square with a three-sided railing.
      var padZ = length / 2 + 0.95;
      var padCorners = [f.at(-1.6, 0, padZ - 1.55), f.at(1.6, 0, padZ - 1.55), f.at(1.6, 0, padZ + 1.55), f.at(-1.6, 0, padZ + 1.55)];
      var padTop = -Infinity;
      for (var pc = 0; pc < 4; pc++) padTop = Math.max(padTop, groundHeight(padCorners[pc][0], padCorners[pc][2]));
      padTop += 0.1;
      for (var pc2 = 0; pc2 < 4; pc2++) padCorners[pc2] = [padCorners[pc2][0], padTop, padCorners[pc2][2]];
      staticBuilder.slab(padCorners, 0.13, WOOD_DARK, WOOD);
      var padPosts = [[-1.5, padZ - 1.45], [1.5, padZ - 1.45], [-1.5, padZ + 1.45], [1.5, padZ + 1.45]];
      for (var pp = 0; pp < padPosts.length; pp++) {
        var padPost = f.at(padPosts[pp][0], 0, padPosts[pp][1]);
        staticBuilder.stick([padPost[0], padTop - 0.2, padPost[2]], [padPost[0], padTop + 0.82, padPost[2]], 0.06, 0.05, 4, WOOD_DARK);
      }
      // Rails along the front and both sides of the pad (the back stays open).
      var railPairs = [[[-1.5, padZ + 1.45], [1.5, padZ + 1.45]], [[-1.5, padZ - 1.45], [-1.5, padZ + 1.45]], [[1.5, padZ - 1.45], [1.5, padZ + 1.45]]];
      for (var rp = 0; rp < railPairs.length; rp++) {
        var ra = f.at(railPairs[rp][0][0], 0, railPairs[rp][0][1]);
        var rb = f.at(railPairs[rp][1][0], 0, railPairs[rp][1][1]);
        staticBuilder.stick([ra[0], padTop + 0.8, ra[2]], [rb[0], padTop + 0.8, rb[2]], 0.045, 0.045, 4, WOOD_WARM);
      }
    }
    for (var ds = 0; ds < deckSites.length; ds++) buildDeck(deckSites[ds]);

    /* 3. cascades: three tapered water sheets hung along the measured drop,
     * foam blocks at the lip and the pool, and two boulders. No terrain edit. */
    function buildFall(site) {
      var f = frameAt(site.x, site.y, site.z, site.yaw);
      var drop = site.drop, half = 0.95;
      var levels = 3;
      for (var i = 0; i < levels; i++) {
        var t0 = i / levels, t1 = (i + 1) / levels;
        var y0 = drop * (1 - t0), y1 = drop * (1 - t1) - 0.05;
        var z0 = -0.95 + t0 * 1.9, z1 = -0.95 + t1 * 1.9;
        var w0 = half * (1 - t0 * 0.12), w1 = half * (1 - t1 * 0.12);
        var color = i === levels - 1 ? WATER_LIGHT : WATER;
        staticBuilder.face([
          f.at(-w0, y0, z0), f.at(w0, y0, z0), f.at(w1, y1, z1), f.at(-w1, y1, z1)
        ], color, [0, 0.4, 1]);
      }
      // Foam blocks: two at the lip, three in the pool.
      var lipFoam = [[-0.55, drop + 0.02, -1.15], [0.5, drop - 0.04, -1.02]];
      for (var lf = 0; lf < lipFoam.length; lf++) {
        var lp = f.at(lipFoam[lf][0], lipFoam[lf][1], lipFoam[lf][2]);
        staticBuilder.box(lp[0], lp[1], lp[2], 0.42, 0.2, 0.36, FOAM, site.yaw + lf * 0.4);
      }
      var poolFoam = [[-0.6, 0.08, 0.95], [0.15, 0.06, 1.1], [0.62, 0.1, 0.85]];
      for (var pf = 0; pf < poolFoam.length; pf++) {
        var pp2 = f.at(poolFoam[pf][0], poolFoam[pf][1], poolFoam[pf][2]);
        staticBuilder.box(pp2[0], pp2[1], pp2[2], 0.5, 0.22, 0.42, FOAM, site.yaw + pf * 0.7);
      }
      // Pool sheet and two boulders framing the spill.
      var pool = f.at(0, 0.02, 1.2);
      staticBuilder.box(pool[0], pool[1], pool[2], 2.5, 0.06, 1.7, WATER_LIGHT, site.yaw);
      var rockL = f.at(-1.18, 0.24, 0.2), rockR = f.at(1.22, 0.2, 0.35);
      staticBuilder.box(rockL[0], rockL[1], rockL[2], 0.62, 0.48, 0.56, STONE_DARK, site.yaw + 0.5);
      staticBuilder.box(rockR[0], rockR[1], rockR[2], 0.54, 0.42, 0.5, STONE, site.yaw + 1.1);
    }
    for (var fs = 0; fs < fallSites.length; fs++) buildFall(fallSites[fs]);

    /* 4. small props: stone lantern, barrel, bench. */
    function buildLantern(prop) {
      var f = frameAt(prop.x, prop.y, prop.z, prop.yaw || 0);
      var base = f.at(0, 0.09, 0);
      staticBuilder.box(base[0], base[1], base[2], 0.62, 0.18, 0.62, STONE_DARK, prop.yaw || 0);
      staticBuilder.column(f.at(0, 0.18, 0)[0], prop.y + 0.18, f.at(0, 0.18, 0)[2], 0.1, 0.09, 0.5, 4, STONE, prop.yaw || 0, false);
      var lampBox = f.at(0, 0.74, 0);
      staticBuilder.box(lampBox[0], lampBox[1], lampBox[2], 0.4, 0.38, 0.4, LAMP_GLOW, prop.yaw || 0);
      var cap = f.at(0, 0.98, 0);
      staticBuilder.box(cap[0], cap[1], cap[2], 0.52, 0.07, 0.52, STONE, prop.yaw || 0);
      staticBuilder.column(cap[0], prop.y + 1.02, cap[2], 0.32, 0.03, 0.2, 4, STONE_DARK, prop.yaw || 0, false);
    }
    function buildBarrel(prop) {
      staticBuilder.column(prop.x, prop.y, prop.z, 0.3, 0.28, 0.62, 6, WOOD_WARM, prop.yaw || 0, true);
      staticBuilder.column(prop.x, prop.y + 0.2, prop.z, 0.315, 0.315, 0.06, 6, IRON, prop.yaw || 0, false);
      staticBuilder.column(prop.x, prop.y + 0.44, prop.z, 0.3, 0.3, 0.05, 6, IRON, prop.yaw || 0, false);
    }
    function buildBench(prop) {
      var f = frameAt(prop.x, prop.y, prop.z, prop.yaw || 0);
      var seat = f.at(0, 0.42, 0);
      staticBuilder.box(seat[0], seat[1], seat[2], 1.15, 0.09, 0.36, WOOD_WARM, prop.yaw || 0);
      var back = f.at(0, 0.68, -0.16);
      staticBuilder.box(back[0], back[1], back[2], 1.15, 0.34, 0.07, WOOD, prop.yaw || 0);
      var legA = f.at(-0.42, 0.16, 0), legB = f.at(0.42, 0.16, 0);
      staticBuilder.column(legA[0], prop.y, legA[2], 0.05, 0.05, 0.4, 4, IRON, prop.yaw || 0, false);
      staticBuilder.column(legB[0], prop.y, legB[2], 0.05, 0.05, 0.4, 4, IRON, prop.yaw || 0, false);
    }
    for (var pr = 0; pr < props.length; pr++) {
      if (props[pr].kind === 'lantern') buildLantern(props[pr]);
      else if (props[pr].kind === 'barrel') buildBarrel(props[pr]);
      else buildBench(props[pr]);
    }

    /* --------------------------------------------------------------- meshes - */
    // One material for all four meshes: vertex colors carry the palette, the
    // instance colors only modulate it, and nothing needs a texture.
    var material = new T.MeshLambertMaterial({ name: 'island-landmarks', vertexColors: true, side: T.DoubleSide });
    var meshes = [];
    var triangles = 0;
    var tmpMatrix = new T.Matrix4();
    var tmpColor = new T.Color();
    var tmpQuat = new T.Quaternion();
    var tmpPosition = new T.Vector3();
    var tmpScale = new T.Vector3();
    var UP = new T.Vector3(0, 1, 0);

    function addStatic() {
      if (!staticBuilder.triangles()) return;
      var geometry = staticBuilder.geometry(T);
      var mesh = new T.Mesh(geometry, material);
      mesh.name = 'island-static-landmarks';
      mesh.userData.family = 'static';
      mesh.userData.islandLandmark = true;
      group.add(mesh);
      meshes.push(mesh);
      triangles += geometry.index.count / 3;
    }

    function addInstanced(name, family, geometry, sites, colorFor) {
      if (!sites.length) { geometry.dispose(); return null; }
      var mesh = new T.InstancedMesh(geometry, material, sites.length);
      mesh.name = name;
      mesh.userData.family = family;
      mesh.userData.islandLandmark = true;
      // Instances are spread over the island while the shared geometry bound is
      // one small prop; culling would pop the whole family at most angles.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.StaticDrawUsage);
      for (var i = 0; i < sites.length; i++) {
        var site = sites[i];
        tmpPosition.set(site.x, site.y, site.z);
        tmpQuat.setFromAxisAngle(UP, site.yaw || 0);
        var scale = site.scale || 1;
        tmpScale.set(scale, scale, scale);
        tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale);
        mesh.setMatrixAt(i, tmpMatrix);
        var color = colorFor(site, i);
        mesh.setColorAt(i, tmpColor.setRGB(color[0], color[1], color[2]));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      meshes.push(mesh);
      triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3 * sites.length;
      return mesh;
    }

    // Cherry instance tints: a little paler on the sun side, never saturated
    // enough to turn the dark bark pink.
    var cherryGeometryMesh = cherryGeometry(T);
    // Instance placement needs a per-tree scale and yaw, so build the site list
    // with those two jitters baked from a stable positional hash.
    for (var ci = 0; ci < cherrySites.length; ci++) {
      var cherrySite = cherrySites[ci];
      cherrySite.yaw = hash01(cherrySite.x * 7.3, cherrySite.z * 7.3, seed) * TAU;
      cherrySite.scale = 1.26 + hash01(cherrySite.z * 3.1, cherrySite.x * 3.1, seed ^ 0x51ed) * 0.46;
    }
    addInstanced('island-cherries', 'cherry', cherryGeometryMesh, cherrySites, function (site, index) {
      var tone = hash01(Math.floor(site.x * 10), Math.floor(site.z * 10), 73);
      return [1.0, 0.94 + tone * 0.05, 0.95 + tone * 0.04];
    });

    for (var li = 0; li < lampSites.length; li++) {
      lampSites[li].yaw = hash01(Math.floor(lampSites[li].x), Math.floor(lampSites[li].z), 91) * 0.7;
    }
    addInstanced('island-lamps', 'lamp', lampGeometry(T), lampSites, function (site, index) {
      var tone = hash01(Math.floor(site.x * 5), Math.floor(site.z * 5), 17);
      return [0.96 + tone * 0.04, 0.96 + tone * 0.04, 0.94 + tone * 0.05];
    });

    addInstanced('island-signs', 'sign', signGeometry(T), signSites, function (site, index) {
      var tone = hash01(Math.floor(site.x * 3), Math.floor(site.z * 3), 31);
      return [0.97 + tone * 0.03, 0.97 + tone * 0.03, 0.97 + tone * 0.03];
    });

    addStatic();

    /* ---------------------------------------------------------------- stats - */
    function geometryBytes(geometry) {
      var bytes = 0, key;
      for (key in geometry.attributes) {
        if (Object.prototype.hasOwnProperty.call(geometry.attributes, key) && geometry.attributes[key] && geometry.attributes[key].array) {
          bytes += geometry.attributes[key].array.byteLength;
        }
      }
      if (geometry.index) bytes += geometry.index.array.byteLength;
      return bytes;
    }
    var uniqueGeometries = [];
    for (var gi = 0; gi < meshes.length; gi++) {
      if (uniqueGeometries.indexOf(meshes[gi].geometry) === -1) uniqueGeometries.push(meshes[gi].geometry);
    }
    var totalBytes = 0;
    for (var ug = 0; ug < uniqueGeometries.length; ug++) totalBytes += geometryBytes(uniqueGeometries[ug]);
    for (var mg = 0; mg < meshes.length; mg++) {
      if (meshes[mg].instanceMatrix) totalBytes += meshes[mg].instanceMatrix.array.byteLength;
      if (meshes[mg].instanceColor) totalBytes += meshes[mg].instanceColor.array.byteLength;
    }

    var stats = {
      entrance: gateSite ? 1 : 0,
      cherries: cherrySites.length,
      decks: deckSites.length,
      falls: fallSites.length,
      lamps: lampSites.length,
      signs: signSites.length,
      props: props.length,
      triangles: Math.round(triangles),
      drawCalls: meshes.length,
      geometryBytes: totalBytes,
      seed: seed,
      quality: quality,
      reducedMotion: reducedMotion,
      version: VERSION,
      disposed: false
    };

    /* --------------------------------------------------------------- update - */
    // This layer is deliberately static: the shapes are baked once. update()
    // keeps the time contract without touching a single matrix, so a still
    // frame is exactly still and there is no per-frame cost.
    var clock = 0;
    var disposed = false;
    function update(time, settings) {
      if (disposed) return false;
      var options = settings || {};
      if (options.animate === false || reducedMotion) return false;
      if (typeof time === 'number' && isFinite(time)) clock = time;
      return false;
    }

    /* -------------------------------------------------------------- dispose - */
    function dispose() {
      if (disposed) return false;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      for (var i = 0; i < meshes.length; i++) {
        var mesh = meshes[i];
        // InstancedMesh.dispose() drops the GL buffers; nulling the references
        // also frees the CPU-side arrays so a rebuild cannot keep them alive.
        if (typeof mesh.dispose === 'function') mesh.dispose();
        mesh.instanceMatrix = null;
        mesh.instanceColor = null;
        mesh.count = 0;
      }
      for (var g2 = 0; g2 < uniqueGeometries.length; g2++) uniqueGeometries[g2].dispose();
      material.dispose();
      group.clear();
      meshes.length = 0;
      uniqueGeometries.length = 0;
      stats.geometryBytes = 0;
      stats.triangles = 0;
      stats.drawCalls = 0;
      stats.disposed = true;
      return true;
    }

    group.userData.landmarks = { stats: stats, placements: placements };

    return {
      group: group,
      stats: stats,
      placements: placements,
      update: update,
      dispose: dispose
    };
  }

  root.MarioIslandLandmarks = { version: VERSION, build: build };
})(window);
