/* Instanced ground detail for the continuous mainland: grass clumps, wild
 * flowers, pebbles, shore reeds, road-side debris and building contact shadows.
 *
 * Design notes (why it is built this way):
 * - One InstancedMesh per family, six at most. The added draw-call budget is a
 *   constant, independent of how many blades or stones are placed.
 * - Everything is placed by one deterministic mulberry32 stream in a fixed
 *   family order, so the same seed rebuilds byte-identical instance buffers.
 *   Rejection sampling consumes random numbers before the density test as well,
 *   which keeps the stream stable even if a stub height field rejects more
 *   candidates (tests inject their own heightAt).
 * - Wind lives in the vertex stage as one small injection into the stock Lambert
 *   shader (the same technique MarioMapWeather uses), so blades keep the scene's
 *   lights, fog and day/night response instead of glowing after dusk. The
 *   injection only reads uTime/uWind; with reducedMotion or animate:false the
 *   caller pins uWind to 0 and the clock never advances, so a still frame is
 *   exactly still and costs no uniform churn. The other families are plain
 *   MeshLambertMaterial draws with vertex colors and instance colors.
 * - Materials are created here (not by MarioRenderQuality.optimize, which runs
 *   before this layer) and every mesh is tagged userData.groundDetail +
 *   userData.weatherEffect so MarioMapWeather neither rasterizes the detail
 *   layer as a snow receiver nor clones these materials.
 * - instanceMatrix/instanceColor live on the InstancedMesh, not on the
 *   geometry, so dispose() releases them explicitly instead of relying on
 *   geometry.dispose().
 * - The building shadow texture is the single 64x64 canvas (16 KiB) allowed by
 *   the budget; its peak alpha is kept low so it never doubles up with the
 *   existing soft-ground-contact plates into a black smudge.
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var DEFAULT_SEED = 0x47534331; /* 'GSC1' */
  var TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- helpers */

  function clamp(value, lo, hi) { return value < lo ? lo : value > hi ? hi : value; }
  function smooth(lo, hi, x) { var t = clamp((x - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); }
  function finite(value, fallback) { return typeof value === 'number' && isFinite(value) ? value : fallback; }

  // mulberry32: 32-bit state, no floating point in the state update, so the
  // stream is identical on every JS engine and across repeat builds.
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

  // A uniform point hash so road/bridge queries stay cheap while the terrain
  // sampler is free to reject thousands of candidates. Cell size equals the
  // largest query radius, which makes the 3x3 neighbourhood exact.
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
    var best = limit * limit, bucket, dx, dz, d, i;
    for (var gz = -1; gz <= 1; gz++) {
      for (var gx = -1; gx <= 1; gx++) {
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
   * Colors sampled from the existing warm low-poly palette so the new layer
   * reads as part of the same world. Instance colors are always clamped to
   * 0..1 because both vertex-color packing and instanceColor rely on that. */
  var GRASS_TINTS = [0x74a55a, 0x82b264, 0x68984c, 0x8fbe6e, 0x7cab58];
  var DRY_TINTS = [0xb7a45f, 0xc2b06a, 0x9f9350];
  var FROST_TINTS = [0xa9c0b2, 0x9db3a6, 0xb9cbbd];
  var CANYON_TINTS = [0xa98a5f, 0x9b7a50];
  var FLOWER_TINTS = [0xf1c95c, 0xe487a7, 0xfbf5dd, 0xd99ac9, 0xf2a76b];
  var STONE_TINTS = [0x8f8877, 0x7d7568, 0x9a9282, 0x6f6a5f];
  var STONE_WARM = [0xb47758, 0xa36a4d, 0xc08a68];
  var STONE_COOL = [0x9aa3a0, 0x8b9391, 0xb0b8b4];
  var REED_TINTS = [0x8f9d82, 0xa8a86d, 0x7d8f6a, 0xb7a86a];
  var DEBRIS_TINTS = [0xb5793f, 0x9b6c43, 0xd9b26a, 0x8a6236, 0xc49a55];

  /* ------------------------------------------------------------- geometries */

  // Small builder that always writes position/normal/color/uv/index so the new
  // meshes stay compatible with generic scene traversals (render quality,
  // weather, diagnostics) that expect those attributes.
  function Builder() { this.p = []; this.n = []; this.c = []; this.uv = []; this.index = []; }
  Builder.prototype.vertex = function (x, y, z, nx, ny, nz, r, g, b, u, v) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(r, g, b);
    this.uv.push(u, v);
    return this.p.length / 3 - 1;
  };
  // v0/v1 are the bottom edge, v2/v3 the top edge (same left/right order).
  Builder.prototype.quad = function (v0, v1, v2, v3) {
    this.index.push(v0, v1, v2, v2, v1, v3);
  };
  Builder.prototype.triangle = function (v0, v1, v2) {
    this.index.push(v0, v1, v2);
  };
  Builder.prototype.geometry = function (T) {
    var geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    // Flat-shaded families (pebbles) push per-face vertices and must stay
    // non-indexed; an empty index buffer would render zero triangles.
    if (this.index.length) geometry.setIndex(this.index);
    geometry.computeBoundingSphere();
    return geometry;
  };

  // Eight short tapered blades spread over a one-unit patch, one triangle each.
  // A single clump therefore reads as a patch of turf instead of one tall spike:
  // the earlier cards were bush-sized and looked like miniature conifers, and the
  // one-blade version was too thin to see at the closest map camera distance.
  // Per-blade height and radius are baked in, so one instance scale widens the
  // whole patch. Root color is dark, tip color warm white: instanceColor supplies
  // the hue and the vertex colors supply the vertical gradient. Normals point up
  // so blades are lit like the ground they grow from. 8 triangles per patch.
  function grassGeometry(T) {
    var builder = new Builder();
    var rootColor = [0.66, 0.72, 0.58];
    var tipColor = [1, 1, 0.92];
    for (var i = 0; i < 8; i++) {
      var angle = TAU * i / 8 + (i % 2 ? 0.33 : 0);
      var radius = 0.16 + (i % 4) * 0.13;
      var cx = Math.cos(angle) * radius, cz = Math.sin(angle) * radius;
      var h = 0.58 + ((i * 5) % 7) * 0.06;
      var dx = Math.cos(angle + 0.7), dz = Math.sin(angle + 0.7);
      var px = -dz * 0.055, pz = dx * 0.055, lean = 0.2;
      var v0 = builder.vertex(cx - px, 0, cz - pz, 0, 1, 0, rootColor[0], rootColor[1], rootColor[2], 0, 0);
      var v1 = builder.vertex(cx + px, 0, cz + pz, 0, 1, 0, rootColor[0], rootColor[1], rootColor[2], 1, 0);
      var v2 = builder.vertex(cx + dx * lean, h, cz + dz * lean, 0, 1, 0, tipColor[0], tipColor[1], tipColor[2], 0.5, 1);
      builder.triangle(v0, v1, v2);
    }
    return { geometry: builder.geometry(T), triangles: builder.index.length / 3 };
  }

  // Three slim blades leaning outward, 6 triangles. Shares the grass material so
  // both families stay on one program and one uniform update. Up-facing normals
  // keep reeds readable under the scene's night lighting.
  function reedGeometry(T) {
    var builder = new Builder();
    var rootColor = [0.38, 0.46, 0.3];
    var tipColor = [0.98, 1, 0.78];
    for (var i = 0; i < 3; i++) {
      var angle = TAU * i / 3, dx = Math.cos(angle), dz = Math.sin(angle);
      var px = -dz * 0.055, pz = dx * 0.055, lean = 0.17;
      var v0 = builder.vertex(-px, 0, -pz, 0, 1, 0, rootColor[0], rootColor[1], rootColor[2], 0, 0);
      var v1 = builder.vertex(px, 0, pz, 0, 1, 0, rootColor[0], rootColor[1], rootColor[2], 1, 0);
      var v2 = builder.vertex(dx * lean - px * 0.38, 1, dz * lean - pz * 0.38, 0, 1, 0, tipColor[0], tipColor[1], tipColor[2], 0, 1);
      var v3 = builder.vertex(dx * lean + px * 0.38, 1, dz * lean + pz * 0.38, 0, 1, 0, tipColor[0], tipColor[1], tipColor[2], 1, 1);
      builder.quad(v0, v1, v2, v3);
    }
    return { geometry: builder.geometry(T), triangles: builder.index.length / 3 };
  }

  // Three petals, one stem card and one flat heart => 10 triangles, under the
  // 12-triangle cap. Petals are white so instanceColor can pick the bloom hue;
  // the stem stays green because green multiplied by a warm hue still reads as
  // a stem at this scale.
  function flowerGeometry(T) {
    var builder = new Builder();
    var stemLow = [0.3, 0.52, 0.26], stemHigh = [0.4, 0.66, 0.3];
    var petal = [1, 1, 1], heart = [1, 0.92, 0.6];
    var stemTop = 0.72;
    var s0 = builder.vertex(-0.032, 0, 0, 0, 0, 1, stemLow[0], stemLow[1], stemLow[2], 0, 0);
    var s1 = builder.vertex(0.032, 0, 0, 0, 0, 1, stemLow[0], stemLow[1], stemLow[2], 1, 0);
    var s2 = builder.vertex(-0.02, stemTop, 0, 0, 0, 1, stemHigh[0], stemHigh[1], stemHigh[2], 0, 1);
    var s3 = builder.vertex(0.02, stemTop, 0, 0, 0, 1, stemHigh[0], stemHigh[1], stemHigh[2], 1, 1);
    builder.quad(s0, s1, s2, s3);
    for (var i = 0; i < 3; i++) {
      var angle = TAU * i / 3, dx = Math.cos(angle), dz = Math.sin(angle);
      var sx = -dz, sz = dx;
      var p0 = builder.vertex(dx * 0.02 - sx * 0.05, 0.7, dz * 0.02 - sz * 0.05, 0, 1, 0, petal[0], petal[1], petal[2], 0, 0);
      var p1 = builder.vertex(dx * 0.02 + sx * 0.05, 0.7, dz * 0.02 + sz * 0.05, 0, 1, 0, petal[0], petal[1], petal[2], 1, 0);
      var p2 = builder.vertex(dx * 0.27 - sx * 0.085, 0.86, dz * 0.27 - sz * 0.085, 0, 1, 0, petal[0], petal[1], petal[2], 0, 1);
      var p3 = builder.vertex(dx * 0.27 + sx * 0.085, 0.86, dz * 0.27 + sz * 0.085, 0, 1, 0, petal[0], petal[1], petal[2], 1, 1);
      builder.quad(p0, p1, p2, p3);
    }
    var h0 = builder.vertex(-0.055, 0.85, -0.055, 0, 1, 0, heart[0], heart[1], heart[2], 0, 0);
    var h1 = builder.vertex(0.055, 0.85, -0.055, 0, 1, 0, heart[0], heart[1], heart[2], 1, 0);
    var h2 = builder.vertex(-0.055, 0.85, 0.055, 0, 1, 0, heart[0], heart[1], heart[2], 0, 1);
    var h3 = builder.vertex(0.055, 0.85, 0.055, 0, 1, 0, heart[0], heart[1], heart[2], 1, 1);
    builder.quad(h0, h1, h2, h3);
    return { geometry: builder.geometry(T), triangles: builder.index.length / 3 };
  }

  // Faceted pebble: six vertices / eight flat-shaded triangles. Faces are
  // re-wound so normals point away from the local origin, which keeps the
  // Lambert shading correct without computing smooth normals.
  function pebbleGeometry(T) {
    var R = 0.26;
    var top = [0.1 * R, 0.88 * R, -0.06 * R];
    var bottom = [0, -0.4 * R, 0];
    var ring = [
      [R, 0.12 * R, -0.12 * R],
      [-0.22 * R, 0.2 * R, 0.97 * R],
      [-0.94 * R, 0.06 * R, -0.3 * R],
      [0.14 * R, 0.02 * R, -0.96 * R]
    ];
    var builder = new Builder();
    function face(a, b, c) {
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var gx = (a[0] + b[0] + c[0]) / 3, gy = (a[1] + b[1] + c[1]) / 3, gz = (a[2] + b[2] + c[2]) / 3;
      if (nx * gx + ny * gy + nz * gz < 0) { var swap = b; b = c; c = swap; nx = -nx; ny = -ny; nz = -nz; }
      var length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= length; ny /= length; nz /= length;
      var shade = clamp(0.6 + (gy / R + 0.4) * 0.42, 0.5, 1);
      builder.vertex(a[0], a[1], a[2], nx, ny, nz, shade, shade, shade, 0, 0);
      builder.vertex(b[0], b[1], b[2], nx, ny, nz, shade, shade, shade, 1, 0);
      builder.vertex(c[0], c[1], c[2], nx, ny, nz, shade, shade, shade, 0, 1);
    }
    for (var i = 0; i < 4; i++) {
      var next = (i + 1) % 4;
      face(top, ring[i], ring[next]);
      face(bottom, ring[next], ring[i]);
    }
    return { geometry: builder.geometry(T), triangles: 8 };
  }

  // One nearly flat card, 2 triangles: leaves, twigs and gravel crumbs.
  function debrisGeometry(T) {
    var builder = new Builder();
    var light = [1, 1, 1], dark = [0.72, 0.66, 0.58];
    var v0 = builder.vertex(-0.27, 0, -0.19, 0, 1, 0, dark[0], dark[1], dark[2], 0, 0);
    var v1 = builder.vertex(0.29, 0.012, -0.15, 0, 1, 0, light[0], light[1], light[2], 1, 0);
    var v2 = builder.vertex(-0.24, 0.008, 0.2, 0, 1, 0, dark[0], dark[1], dark[2], 0, 1);
    var v3 = builder.vertex(0.22, 0.02, 0.17, 0, 1, 0, light[0], light[1], light[2], 1, 1);
    builder.quad(v0, v1, v2, v3);
    return { geometry: builder.geometry(T), triangles: 2 };
  }

  // Unit quad in the XZ plane, 2 triangles, +Y normal, full 0..1 UVs.
  function shadowGeometry(T) {
    var builder = new Builder();
    var v0 = builder.vertex(-1, 0, -1, 0, 1, 0, 1, 1, 1, 0, 0);
    var v1 = builder.vertex(1, 0, -1, 0, 1, 0, 1, 1, 1, 1, 0);
    var v2 = builder.vertex(-1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1);
    var v3 = builder.vertex(1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1);
    builder.index.push(v0, v2, v1, v1, v2, v3);
    return { geometry: builder.geometry(T), triangles: 2 };
  }

  /* ---------------------------------------------------------------- textures */

  // Exactly one 64x64 texture (16 KiB). The canvas path is used in the browser;
  // the DataTexture fallback keeps the module usable with no DOM at all (Node
  // structure tests) and has the same soft radial falloff.
  function contactShadowTexture(T, doc) {
    var size = 64;
    if (doc && typeof doc.createElement === 'function') {
      var canvas = doc.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var context = canvas.getContext && canvas.getContext('2d');
      if (context && typeof context.createRadialGradient === 'function') {
        var gradient = context.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5);
        gradient.addColorStop(0, 'rgba(18,32,22,0.46)');
        gradient.addColorStop(0.55, 'rgba(18,32,22,0.26)');
        gradient.addColorStop(1, 'rgba(18,32,22,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
        var canvasTexture = new T.CanvasTexture(canvas);
        canvasTexture.name = 'ground-contact-shadow';
        return { texture: canvasTexture, bytes: size * size * 4 };
      }
    }
    var data = new Uint8Array(size * size * 4);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var dx = (x + 0.5) / size - 0.5, dz = (y + 0.5) / size - 0.5;
        var radius = Math.sqrt(dx * dx + dz * dz) * 2;
        var alpha = clamp(1 - radius, 0, 1);
        alpha = alpha * alpha * (3 - 2 * alpha);
        var offset = (y * size + x) * 4;
        data[offset] = 18; data[offset + 1] = 32; data[offset + 2] = 22;
        data[offset + 3] = Math.round(alpha * 118);
      }
    }
    var texture = new T.DataTexture(data, size, size, T.RGBAFormat, T.UnsignedByteType);
    texture.name = 'ground-contact-shadow';
    texture.generateMipmaps = false;
    texture.minFilter = T.LinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.needsUpdate = true;
    return { texture: texture, bytes: data.byteLength };
  }

  /* ------------------------------------------------------------------- build */

  function build(T, parent, options) {
    if (!T || typeof T.InstancedMesh !== 'function') throw new Error('MarioGroundScatter needs THREE');
    var opts = options || {};
    var geo = root.MarioWorldGeography || {};
    var heightAt = typeof opts.heightAt === 'function' ? opts.heightAt : (typeof geo.heightAt === 'function' ? geo.heightAt : null);
    if (!heightAt) throw new Error('MarioGroundScatter needs a heightAt function');
    var riverAt = typeof geo.riverDistance === 'function' ? geo.riverDistance : null;
    var biomeFn = typeof geo.biomeAt === 'function' ? geo.biomeAt : null;
    var seaLevel = typeof opts.seaLevel === 'number' ? opts.seaLevel : finite(geo.seaLevel, 0.48);
    var bounds = opts.bounds || geo.bounds || { minX: -102, maxX: 102, minZ: -87, maxZ: 87 };
    var quality = opts.quality === 'smooth' || opts.quality === 'detail' ? opts.quality : 'auto';
    var reducedMotion = !!opts.reducedMotion;
    var seed = (typeof opts.seed === 'number' && isFinite(opts.seed) ? opts.seed : DEFAULT_SEED) >>> 0;
    var random = randomStream(seed);
    var started = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    var minGround = seaLevel + 0.55; // underwater + wet beach, hard exclusion
    var spanX = bounds.maxX - bounds.minX, spanZ = bounds.maxZ - bounds.minZ;
    var margin = 1.2;

    /* --------------------------------------------------- exclusion structures */
    var routeGrid = new PointGrid(4);
    var bridgeGrid = new PointGrid(4);
    var routeSegments = [];
    var routePoints = [];
    var routeList = opts.routes || [];

    function pushPoint(target, x, z) {
      if (!isFinite(x) || !isFinite(z)) return;
      target.push(x, z);
      routeGrid.add(x, z);
    }
    for (var r = 0; r < routeList.length; r++) {
      var route = routeList[r] || {};
      var points = route.points || [];
      var previous = null;
      for (var p = 0; p < points.length; p++) {
        var point = points[p];
        if (!point) continue;
        var px = Array.isArray(point) ? point[0] : point.x;
        var pz = Array.isArray(point) ? point[2] : point.z;
        if (!isFinite(px) || !isFinite(pz)) continue;
        pushPoint(routePoints, px, pz);
        var onBridge = riverAt ? riverAt(px, pz) < 4.05 : false;
        if (onBridge) bridgeGrid.add(px, pz);
        if (previous) {
          var dx = px - previous[0], dz = pz - previous[1];
          var length = Math.sqrt(dx * dx + dz * dz);
          if (length > 0.0001) {
            routeSegments.push({ ax: previous[0], az: previous[1], dx: dx / length, dz: dz / length, length: length });
          }
        }
        previous = [px, pz];
      }
    }

    var buildings = [];
    var buildingList = opts.buildings || [];
    for (var b = 0; b < buildingList.length; b++) {
      var entry = buildingList[b];
      if (!entry) continue;
      var anchor = entry.position || entry;
      var bx = finite(anchor.x, NaN), bz = finite(anchor.z, NaN);
      if (!isFinite(bx) || !isFinite(bz)) continue;
      buildings.push({ x: bx, z: bz, radius: Math.max(0.6, finite(entry.radius, 1.4)) });
    }

    var regions = [];
    var regionList = opts.regions || geo.regions || [];
    var lavaCenters = [];
    for (var g = 0; g < regionList.length; g++) {
      var region = regionList[g];
      if (!region) continue;
      var regionAnchor = region.position || region;
      var rx = finite(regionAnchor.x, NaN), rz = finite(regionAnchor.z, NaN);
      if (!isFinite(rx) || !isFinite(rz)) continue;
      regions.push({ x: rx, z: rz });
      if (region.id === 'lava') lavaCenters.push({ x: rx, z: rz, radius: 13 });
    }

    function inLava(x, z) {
      for (var i = 0; i < lavaCenters.length; i++) {
        var dx = x - lavaCenters[i].x, dz = z - lavaCenters[i].z;
        if (dx * dx + dz * dz < lavaCenters[i].radius * lavaCenters[i].radius) return true;
      }
      return false;
    }

    // Everything except the bridge deck is rejected here. Bridge spans are
    // tracked separately because the deck floats above the channel and must not
    // collect grass or gravel even where the road corridor test would pass.
    function groundInfo(x, z) {
      var height = heightAt(x, z);
      if (!(height >= minGround)) return null; // also rejects NaN
      var river = riverAt ? riverAt(x, z) : 1e6;
      if (river < 4.2) return null;
      var road = routeGrid.size ? routeGrid.nearest(x, z, 4) : 4;
      if (road < 1.6) return null;
      if (bridgeGrid.size && bridgeGrid.nearest(x, z, 4) < 2.6) return null;
      for (var i = 0; i < buildings.length; i++) {
        var building = buildings[i], radius = building.radius + 0.35;
        var dx = x - building.x, dz = z - building.z;
        if (dx * dx + dz * dz < radius * radius) return null;
      }
      for (var j = 0; j < regions.length; j++) {
        var rgx = x - regions[j].x, rgz = z - regions[j].z;
        if (rgx * rgx + rgz * rgz < 16) return null;
      }
      return { x: x, z: z, height: height, river: river, road: road };
    }

    function fallbackBiome(x, z, height, river) {
      var coast = typeof geo.coastField === 'function' ? geo.coastField(x, z) : 1;
      return {
        height: height,
        forest: 0.3,
        meadow: 0.25,
        sand: coast < -0.2 ? 0.6 : 0.1,
        rock: 0.15,
        canyon: 0,
        snow: height > 7 ? smooth(7, 11, height) : 0,
        shore: 1 - smooth(seaLevel + 0.4, seaLevel + 2.2, height),
        river: riverAt ? Math.max(0, 1 - smooth(1.3, 4.3, river)) : 0
      };
    }

    function biomeWeights(info) {
      var biome = biomeFn ? biomeFn(info.x, info.z) : null;
      if (!biome) biome = fallbackBiome(info.x, info.z, info.height, info.river);
      return {
        meadow: finite(biome.meadow, 0),
        forest: finite(biome.forest, 0),
        sand: finite(biome.sand, 0),
        rock: finite(biome.rock, 0),
        canyon: finite(biome.canyon, 0),
        snow: finite(biome.snow, 0),
        shore: finite(biome.shore, 0),
        // biomeAt() river weight collapses by 4.3; widen it with the raw river
        // distance so the reed band still has width along every channel.
        wet: Math.max(finite(biome.river, 0), 1 - smooth(4.2, 9.5, info.river))
      };
    }

    // Grass should read as cover where the camera goes, not as confetti spread
    // over 30k square units. Candidates are therefore drawn next to the roads
    // and the buildings first and only fall back to uniform sampling for the
    // open meadow. groundInfo() still applies every exclusion to each draw.
    function nextCandidate() {
      var roll = random(), x, z;
      if (routeSegments.length && roll < 0.5) {
        var segment = routeSegments[Math.floor(random() * routeSegments.length)];
        var along = random() * segment.length, side = (random() < 0.5 ? -1 : 1) * (1.7 + random() * 2.2);
        x = segment.ax + segment.dx * along - segment.dz * side;
        z = segment.az + segment.dz * along + segment.dx * side;
      } else if (buildings.length && roll < 0.72) {
        var building = buildings[Math.floor(random() * buildings.length)];
        var angle = random() * TAU, reach = building.radius + 0.7 + random() * 3.2;
        x = building.x + Math.cos(angle) * reach;
        z = building.z + Math.sin(angle) * reach;
      } else {
        x = bounds.minX + margin + random() * (spanX - margin * 2);
        z = bounds.minZ + margin + random() * (spanZ - margin * 2);
      }
      return groundInfo(x, z); // caller applies the biome/density test
    }

    /* -------------------------------------------------------------- counts ---
     * Base counts are tuned so the auto preset lands near 11.4k triangles and
     * detail near 12.5k; the guard below keeps even a pathological building
     * list inside the 14k budget. */
    var factor = quality === 'smooth' ? 0.55 : quality === 'detail' ? 1.1 : 1;
    var counts = {
      grass: Math.round(2200 * factor),
      flowers: Math.round(110 * factor),
      pebbles: Math.round(140 * factor),
      reeds: Math.round(100 * factor),
      debris: Math.round(150 * factor)
    };
    var shadowCount = buildings.length;
    var familyTriangles = { grass: 8, flowers: 10, pebbles: 8, reeds: 6, debris: 2 };
    function estimatedTriangles() {
      return counts.grass * 8 + counts.flowers * 10 + counts.pebbles * 8 + counts.reeds * 6 + counts.debris * 2 + shadowCount * 2;
    }
    var guard = 0;
    while (estimatedTriangles() > 19000 && guard++ < 24) {
      counts.grass = Math.floor(counts.grass * 0.92);
      counts.flowers = Math.floor(counts.flowers * 0.92);
      counts.pebbles = Math.floor(counts.pebbles * 0.92);
      counts.reeds = Math.floor(counts.reeds * 0.92);
      counts.debris = Math.floor(counts.debris * 0.92);
    }

    /* ------------------------------------------------------------ materials */
    var bladeUniforms = { uTime: { value: 0 }, uWind: { value: 0 } };
    // Blades bend in the vertex stage through one small injection into the stock
    // Lambert shader. Lambert keeps the scene's key/fill/hemisphere lights, fog
    // and color pipeline working (important for the day/night cycle), while the
    // injection only adds uTime/uWind and a height^2 bend so roots stay planted.
    var bladeMaterial = new T.MeshLambertMaterial({ name: 'ground-blades', vertexColors: true, side: T.DoubleSide });
    bladeMaterial.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = bladeUniforms.uTime;
      shader.uniforms.uWind = bladeUniforms.uWind;
      shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '  float bladeBend = clamp(transformed.y, 0.0, 1.0);',
        '  bladeBend *= bladeBend;',
        '  float bladePhase = instanceMatrix[3].x * 0.83 + instanceMatrix[3].z * 0.61;',
        '  float bladeSway = sin(uTime * 1.9 + bladePhase) * 0.72 + sin(uTime * 3.3 + bladePhase * 1.7) * 0.28;',
        '  transformed.x += bladeSway * bladeBend * uWind * 0.32;',
        '  transformed.z += cos(uTime * 1.35 + bladePhase * 0.8) * bladeBend * uWind * 0.18;',
        '#endif'
      ].join('\n'));
    };
    var flowerMaterial = new T.MeshLambertMaterial({ name: 'ground-flowers', vertexColors: true, side: T.DoubleSide });
    var pebbleMaterial = new T.MeshLambertMaterial({ name: 'ground-pebbles', vertexColors: true });
    var debrisMaterial = new T.MeshLambertMaterial({ name: 'ground-debris', vertexColors: true, side: T.DoubleSide });
    // The texture only exists when there is at least one building to ground;
    // otherwise the layer would own an unused 16 KiB texture.
    var shadowTextureInfo = shadowCount > 0 ? contactShadowTexture(T, root.document) : null;
    var shadowTexture = shadowTextureInfo ? shadowTextureInfo.texture : null;
    var shadowMaterial = shadowTexture ? new T.MeshBasicMaterial({
      name: 'ground-contact-shadows',
      map: shadowTexture,
      transparent: true,
      opacity: 0.16, // <= 0.18: never doubles the soft-ground-contact plates into a smudge
      depthWrite: false,
      toneMapped: false,
      side: T.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    }) : null;

    var geometries = [grassGeometry(T), reedGeometry(T), flowerGeometry(T), pebbleGeometry(T), debrisGeometry(T), shadowGeometry(T)];
    var meshes = [];
    var group = new T.Group();
    group.name = 'ground-scatter';
    group.userData.groundScatter = true;
    if (parent && typeof parent.add === 'function') parent.add(group);

    /* ------------------------------------------------------------ placement */
    var tmpMatrix = new T.Matrix4();
    var tmpQuat = new T.Quaternion();
    var tmpQuat2 = new T.Quaternion();
    var tmpPosition = new T.Vector3();
    var tmpScale = new T.Vector3();
    var tmpNormal = new T.Vector3();
    var tmpAxis = new T.Vector3();
    var UP = new T.Vector3(0, 1, 0);
    var tmpColor = new T.Color();
    var tmpAlt = new T.Color();

    function pick(list, value) { return list[clamp(Math.floor(value * list.length), 0, list.length - 1)]; }
    function jitter(color, value, spread, amount) {
      var scale = 1 + (value - 0.5) * spread;
      color.r = clamp(color.r * scale, 0, 1) * amount;
      color.g = clamp(color.g * scale, 0, 1) * amount;
      color.b = clamp(color.b * scale, 0, 1) * amount;
      color.r = clamp(color.r, 0, 1);
      color.g = clamp(color.g, 0, 1);
      color.b = clamp(color.b, 0, 1);
      return color;
    }
    function tintFor(family, weights, r1, r2) {
      if (family === 'grass') {
        tmpColor.setHex(pick(GRASS_TINTS, r1));
        if (weights.sand > 0.22) { tmpAlt.setHex(pick(DRY_TINTS, r2)); tmpColor.lerp(tmpAlt, smooth(0.22, 0.85, weights.sand) * 0.8); }
        if (weights.snow > 0.12) { tmpAlt.setHex(pick(FROST_TINTS, r2)); tmpColor.lerp(tmpAlt, smooth(0.12, 0.7, weights.snow) * 0.85); }
        if (weights.canyon > 0.2) { tmpAlt.setHex(pick(CANYON_TINTS, r2)); tmpColor.lerp(tmpAlt, smooth(0.2, 0.75, weights.canyon) * 0.6); }
        return jitter(tmpColor, r1, 0.22, 1);
      }
      if (family === 'flowers') {
        tmpColor.setHex(pick(FLOWER_TINTS, r1));
        return jitter(tmpColor, r2, 0.16, 1);
      }
      if (family === 'pebbles') {
        if (weights.canyon > 0.35) tmpColor.setHex(pick(STONE_WARM, r1));
        else if (weights.snow > 0.4) tmpColor.setHex(pick(STONE_COOL, r1));
        else if (weights.sand > 0.35) tmpColor.setHex(pick(STONE_WARM.concat(STONE_TINTS), r1));
        else tmpColor.setHex(pick(STONE_TINTS, r1));
        return jitter(tmpColor, r2, 0.2, 1);
      }
      if (family === 'reeds') {
        tmpColor.setHex(pick(REED_TINTS, r1));
        if (weights.sand > 0.4) { tmpAlt.setHex(pick(DRY_TINTS, r2)); tmpColor.lerp(tmpAlt, 0.45); }
        return jitter(tmpColor, r2, 0.18, 1);
      }
      tmpColor.setHex(pick(DEBRIS_TINTS, r1));
      return jitter(tmpColor, r2, 0.2, 1);
    }

    function Recorder() { this.matrices = []; this.colors = []; }
    Recorder.prototype.add = function (matrix, color) {
      for (var i = 0; i < 16; i++) this.matrices.push(matrix.elements[i]);
      this.colors.push(color.r, color.g, color.b);
    };
    Recorder.prototype.count = function () { return this.colors.length / 3; };

    function commit(recorder, name, geometryEntry, material, triangles, renderOrder) {
      var count = recorder.count();
      if (!count) return null;
      var mesh = new T.InstancedMesh(geometryEntry.geometry, material, count);
      mesh.name = name;
      // Instances cover the whole mainland while the shared geometry bound is
      // tiny, so frustum culling would pop the layer out at most angles.
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder || 0;
      mesh.userData.groundDetail = true;
      mesh.userData.weatherEffect = true;
      mesh.userData.family = name.replace('ground-', '');
      mesh.instanceMatrix.setUsage(T.StaticDrawUsage);
      for (var i = 0; i < count; i++) {
        tmpMatrix.fromArray(recorder.matrices, i * 16);
        mesh.setMatrixAt(i, tmpMatrix);
        tmpColor.setRGB(recorder.colors[i * 3], recorder.colors[i * 3 + 1], recorder.colors[i * 3 + 2]);
        mesh.setColorAt(i, tmpColor);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      meshes.push(mesh);
      return { mesh: mesh, triangles: count * triangles };
    }

    function fill(recorder, target, place, maxAttemptsFactor) {
      var placed = 0, attempts = 0;
      var limit = Math.ceil(target * (maxAttemptsFactor || 100)) + 2500;
      while (placed < target && attempts < limit) {
        attempts++;
        if (place(recorder, nextCandidate())) placed++;
      }
      return placed;
    }

    /* grass: meadow and forest dense, desert sparse, snow frosty and sparse,
     * canyon dry, lava empty. Height 0.55..1.3 exactly as specified. */
    function grassChance(weights) {
      var chance = 0.1 + 0.7 * weights.meadow + 0.34 * weights.forest
        - 0.55 * weights.sand - 0.38 * weights.snow - 0.3 * weights.rock - 0.42 * weights.canyon;
      chance *= 1 - 0.55 * weights.shore;
      return clamp(chance, 0, 0.92);
    }
    function placeGrass(recorder, info) {
      if (!info || inLava(info.x, info.z)) return false;
      var weights = biomeWeights(info);
      var chance = grassChance(weights);
      if (chance <= 0 || random() >= chance) return false;
      // Tufts follow the roads, plazas and house edges where the camera actually
      // goes; open meadow keeps the base density so the layer never carpets the
      // whole continent with confetti.
      var feature = info.road < 6 ? 1.55 : 1;
      for (var b = 0; b < buildings.length && feature < 1.5; b++) {
        var bdx = info.x - buildings[b].x, bdz = info.z - buildings[b].z, reach = buildings[b].radius + 7;
        if (bdx * bdx + bdz * bdz < reach * reach) feature = 1.45;
      }
      if (chance * feature < 1 && random() >= chance * feature) return false;
      var yaw = random() * TAU;
      var height = 0.15 + random() * 0.13;
      var width = 0.7 + random() * 0.45;
      var color = tintFor('grass', weights, random(), random());
      tmpQuat.setFromAxisAngle(UP, yaw);
      tmpPosition.set(info.x, info.height - 0.02, info.z);
      tmpScale.set(width, height, width);
      tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale);
      recorder.add(tmpMatrix, color);
      return true;
    }

    /* flowers: meadow/gardens highest, never in lava, still 10 triangles. */
    function flowerChance(weights) {
      var chance = 0.03 + 0.62 * weights.meadow + 0.2 * weights.forest
        - 0.14 * weights.sand - 0.16 * weights.snow - 0.18 * weights.rock - 0.3 * weights.canyon;
      chance *= 1 - 0.6 * weights.shore;
      return clamp(chance, 0, 0.85);
    }
    function placeFlower(recorder, info) {
      if (!info || inLava(info.x, info.z)) return false;
      var weights = biomeWeights(info);
      var chance = flowerChance(weights);
      if (chance <= 0 || random() >= chance) return false;
      var yaw = random() * TAU;
      var height = 0.32 + random() * 0.26;
      var color = tintFor('flowers', weights, random(), random());
      tmpQuat.setFromAxisAngle(UP, yaw);
      tmpPosition.set(info.x, info.height - 0.01, info.z);
      tmpScale.set(height, height, height);
      tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale);
      recorder.add(tmpMatrix, color);
      return true;
    }

    /* pebbles: desert, red rock, foothills, river banks and road shoulders;
     * sparse on meadows. Scale 0.6..1.6 as specified, local radius 0.26. */
    function pebbleChance(weights, road) {
      var chance = 0.05 + 0.34 * weights.sand + 0.44 * weights.rock + 0.52 * weights.canyon
        + 0.24 * weights.snow + 0.16 * weights.shore + 0.1 * weights.wet - 0.18 * weights.meadow;
      if (road < 4.6) chance += 0.14;
      return clamp(chance, 0, 0.95);
    }
    function placePebble(recorder, info) {
      if (!info) return false;
      var weights = biomeWeights(info);
      var chance = pebbleChance(weights, info.road);
      if (chance <= 0 || random() >= chance) return false;
      var yaw = random() * TAU;
      var scale = 0.35 + random() * 0.4;
      var squash = 0.45 + random() * 0.25;
      var color = tintFor('pebbles', weights, random(), random());
      tmpQuat.setFromAxisAngle(UP, yaw);
      tmpPosition.set(info.x, info.height + 0.015, info.z);
      tmpScale.set(scale, scale * squash, scale * (0.82 + random() * 0.3));
      tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale);
      recorder.add(tmpMatrix, color);
      return true;
    }

    /* reeds: coastal/lake wet band and the river bank just outside the 4.2
     * channel exclusion, leaning slightly downhill (towards the water). */
    function reedChance(weights) {
      var wet = Math.max(weights.wet, weights.shore * 0.9);
      return wet < 0.14 ? 0 : clamp(0.95 * wet, 0, 0.9);
    }
    function placeReed(recorder, info) {
      if (!info || inLava(info.x, info.z)) return false;
      var weights = biomeWeights(info);
      var chance = reedChance(weights);
      if (chance <= 0 || random() >= chance) return false;
      var yaw = random() * TAU;
      var height = 0.9 + random() * 0.7;
      var tilt = 0.08 + random() * 0.14;
      var epsilon = 0.8;
      var slopeX = (heightAt(info.x + epsilon, info.z) - heightAt(info.x - epsilon, info.z)) / (2 * epsilon);
      var slopeZ = (heightAt(info.x, info.z + epsilon) - heightAt(info.x, info.z - epsilon)) / (2 * epsilon);
      if (Math.sqrt(slopeX * slopeX + slopeZ * slopeZ) > 1e-4) tmpAxis.set(-slopeZ, 0, slopeX).normalize();
      else tmpAxis.set(1, 0, 0);
      var color = tintFor('reeds', weights, random(), random());
      tmpQuat.setFromAxisAngle(tmpAxis, tilt).multiply(tmpQuat2.setFromAxisAngle(UP, yaw));
      tmpPosition.set(info.x, info.height - 0.02, info.z);
      tmpScale.set(height * 0.8, height, height * 0.8);
      tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale);
      recorder.add(tmpMatrix, color);
      return true;
    }

    /* debris: sampled directly on a road segment, then offset 1.76..2.66 from
     * the centreline (0.9..1.8 outside the 1.72 wide carriageway). Sampling
     * along the road instead of over the whole map keeps the band populated
     * without millions of rejected candidates. */
    function placeDebris(recorder) {
      if (!routeSegments.length) return false;
      var segment = routeSegments[Math.min(routeSegments.length - 1, Math.floor(random() * routeSegments.length))];
      var along = random() * segment.length;
      var side = random() < 0.5 ? -1 : 1;
      var offset = side * (1.76 + random() * 0.9);
      var x = segment.ax + segment.dx * along + (-segment.dz) * offset;
      var z = segment.az + segment.dz * along + segment.dx * offset;
      var info = groundInfo(x, z);
      if (!info) return false;
      if (info.road < 1.7 || info.road > 2.85) return false;
      if (inLava(x, z)) return false;
      var weights = biomeWeights(info);
      var color = tintFor('debris', weights, random(), random());
      var yaw = random() * TAU;
      var scale = 0.14 + random() * 0.16;
      var tilt = 0.06 + random() * 0.12;
      tmpAxis.set(Math.cos(yaw), 0, Math.sin(yaw));
      tmpQuat.setFromAxisAngle(tmpAxis, tilt).multiply(tmpQuat2.setFromAxisAngle(UP, yaw));
      tmpPosition.set(x, info.height + 0.03, z);
      tmpScale.set(scale, scale, scale * (0.7 + random() * 0.4));
      tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale);
      recorder.add(tmpMatrix, color);
      return true;
    }

    var grassRecorder = new Recorder();
    var flowerRecorder = new Recorder();
    var pebbleRecorder = new Recorder();
    var reedRecorder = new Recorder();
    var debrisRecorder = new Recorder();

    fill(grassRecorder, counts.grass, placeGrass, 110);
    fill(flowerRecorder, counts.flowers, placeFlower, 140);
    fill(pebbleRecorder, counts.pebbles, placePebble, 120);
    fill(reedRecorder, counts.reeds, placeReed, 180);
    var debrisTarget = counts.debris, debrisAttempts = 0, debrisLimit = debrisTarget * 90 + 900;
    while (debrisRecorder.count() < debrisTarget && debrisAttempts < debrisLimit) {
      debrisAttempts++;
      placeDebris(debrisRecorder);
    }

    var committed = [];
    committed.push(commit(grassRecorder, 'ground-grass', geometries[0], bladeMaterial, 8, 0));
    committed.push(commit(flowerRecorder, 'ground-flowers', geometries[2], flowerMaterial, 10, 0));
    committed.push(commit(pebbleRecorder, 'ground-pebbles', geometries[3], pebbleMaterial, 8, 0));
    committed.push(commit(reedRecorder, 'ground-reeds', geometries[1], bladeMaterial, 6, 0));
    committed.push(commit(debrisRecorder, 'ground-debris', geometries[4], debrisMaterial, 2, 0));

    /* --------------------------------------------------- contact shadows ---
     * Exactly one instance per exclusion circle so a building never lacks its
     * grounding. The quad tilts to the sampled surface normal and stretches a
     * little on slopes; all scales stay positive. */
    function surfaceNormal(x, z) {
      var epsilon = 0.7;
      var slopeX = (heightAt(x + epsilon, z) - heightAt(x - epsilon, z)) / (2 * epsilon);
      var slopeZ = (heightAt(x, z + epsilon) - heightAt(x, z - epsilon)) / (2 * epsilon);
      tmpNormal.set(-slopeX, 1, -slopeZ);
      if (tmpNormal.lengthSq() < 1e-8) tmpNormal.set(0, 1, 0);
      return tmpNormal.normalize();
    }
    var shadowRecorder = new Recorder();
    for (var s = 0; s < buildings.length; s++) {
      var site = buildings[s];
      var radius = Math.max(0.8, site.radius);
      var normal = surfaceNormal(site.x, site.z);
      var slope = Math.sqrt(Math.max(0, 1 - normal.y * normal.y));
      var stretch = 1 + slope * 1.2;
      var yaw = random() * TAU;
      var height = heightAt(site.x, site.z);
      if (!isFinite(height)) height = seaLevel;
      tmpQuat.setFromUnitVectors(UP, normal);
      tmpQuat.multiply(tmpQuat2.setFromAxisAngle(UP, yaw));
      tmpPosition.set(site.x, height + 0.06, site.z);
      tmpScale.set(radius * 1.35 * stretch, 1, radius * 1.25 * (1 + slope * 0.4));
      tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale);
      shadowRecorder.add(tmpMatrix, tmpColor.setRGB(1, 1, 1));
    }
    var shadowEntry = commit(shadowRecorder, 'ground-contact-shadows', geometries[5], shadowMaterial, 2, 1);
    if (shadowEntry) committed.push(shadowEntry);

    /* ---------------------------------------------------------------- stats */
    function geometryBytes(geometry) {
      var bytes = 0, name;
      for (name in geometry.attributes) {
        if (Object.prototype.hasOwnProperty.call(geometry.attributes, name) && geometry.attributes[name] && geometry.attributes[name].array) {
          bytes += geometry.attributes[name].array.byteLength;
        }
      }
      if (geometry.index) bytes += geometry.index.array.byteLength;
      return bytes;
    }

    var placedGrass = grassRecorder.count();
    var placedFlowers = flowerRecorder.count();
    var placedPebbles = pebbleRecorder.count();
    var placedReeds = reedRecorder.count();
    var placedDebris = debrisRecorder.count();
    var placedShadows = shadowRecorder.count();
    var triangles = placedGrass * 8 + placedFlowers * 10 + placedPebbles * 8 + placedReeds * 6 + placedDebris * 2 + placedShadows * 2;
    var uniqueGeometries = [];
    var seenGeometries = [];
    for (var c = 0; c < meshes.length; c++) {
      if (seenGeometries.indexOf(meshes[c].geometry) === -1) {
        seenGeometries.push(meshes[c].geometry);
        uniqueGeometries.push(meshes[c].geometry);
      }
    }
    var totalGeometryBytes = 0;
    for (var q = 0; q < uniqueGeometries.length; q++) totalGeometryBytes += geometryBytes(uniqueGeometries[q]);
    for (var m = 0; m < meshes.length; m++) {
      if (meshes[m].instanceMatrix) totalGeometryBytes += meshes[m].instanceMatrix.array.byteLength;
      if (meshes[m].instanceColor) totalGeometryBytes += meshes[m].instanceColor.array.byteLength;
    }
    var buildMilliseconds = started ? performance.now() - started : 0;
    var stats = {
      grass: placedGrass,
      flowers: placedFlowers,
      pebbles: placedPebbles,
      reeds: placedReeds,
      debris: placedDebris,
      contactShadows: placedShadows,
      triangles: triangles,
      drawCalls: meshes.length,
      geometryBytes: totalGeometryBytes,
      textureBytes: shadowEntry ? shadowTextureInfo.bytes : 0,
      seed: seed,
      quality: quality,
      reducedMotion: reducedMotion,
      windStrength: 0,
      buildMilliseconds: buildMilliseconds,
      version: VERSION,
      disposed: false
    };

    /* --------------------------------------------------------------- update */
    var windStrength = 0.9;
    var disposed = false;
    function update(time, settings) {
      if (disposed) return false;
      var options = settings || {};
      var animate = options.animate !== false && !reducedMotion;
      if (!animate) {
        // Zero uniform advance and zero displacement: a still frame is static.
        bladeUniforms.uWind.value = 0;
        stats.windStrength = 0;
        return false;
      }
      if (typeof time === 'number' && isFinite(time)) bladeUniforms.uTime.value = time;
      bladeUniforms.uWind.value = windStrength;
      stats.windStrength = windStrength;
      return true;
    }

    /* -------------------------------------------------------------- dispose */
    var materialList = [];
    if (bladeMaterial) materialList.push(bladeMaterial);
    if (flowerMaterial) materialList.push(flowerMaterial);
    if (pebbleMaterial) materialList.push(pebbleMaterial);
    if (debrisMaterial) materialList.push(debrisMaterial);
    if (shadowMaterial) materialList.push(shadowMaterial);
    var disposedTextures = 0;
    function dispose() {
      if (disposed) return false;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      for (var i = 0; i < meshes.length; i++) {
        var mesh = meshes[i];
        // InstancedMesh.dispose() dispatches the event three listens for to drop
        // instanceMatrix/instanceColor from its GL attribute cache. Nulling the
        // references afterwards also releases the CPU-side arrays, so a rebuild
        // cannot keep the previous seed's buffers alive.
        if (typeof mesh.dispose === 'function') mesh.dispose();
        mesh.instanceMatrix = null;
        mesh.instanceColor = null;
        mesh.count = 0;
      }
      // Release every geometry the layer created, including a family that
      // placed nothing (for example a world without buildings).
      for (var g2 = 0; g2 < geometries.length; g2++) geometries[g2].geometry.dispose();
      for (var m2 = 0; m2 < materialList.length; m2++) materialList[m2].dispose();
      if (shadowTexture && !disposedTextures) { shadowTexture.dispose(); disposedTextures++; }
      group.clear();
      meshes.length = 0;
      uniqueGeometries.length = 0;
      shadowTexture = null;
      stats.geometryBytes = 0;
      stats.textureBytes = 0;
      stats.disposed = true;
      return true;
    }

    return {
      group: group,
      stats: stats,
      uniforms: bladeUniforms,
      update: update,
      dispose: dispose
    };
  }

  root.MarioGroundScatter = { version: VERSION, build: build };
})(window);
