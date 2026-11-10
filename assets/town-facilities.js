/* Working town facilities: a turning windmill, a water wheel, a clock tower whose
 * hands follow real time, a forge hammer, a pulsing fountain, a swinging dock crane
 * and chimney smoke. Everything is authored geometry (no textures, no networks) and
 * every moving part is driven from update(time,{animate}); with animation off the
 * layer does not advance a single uniform or matrix. */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ palette */
  var WOOD = [0.63, 0.46, 0.32];
  var WOOD_WARM = [0.72, 0.54, 0.36];
  var WOOD_DARK = [0.40, 0.30, 0.25];
  var IRON = [0.29, 0.26, 0.24];
  var CREAM = [1.0, 0.93, 0.81];
  var PLASTER = [0.96, 0.90, 0.80];
  var STONE = [0.72, 0.66, 0.57];
  var STONE_DARK = [0.55, 0.51, 0.46];
  var GOLD = [0.95, 0.78, 0.40];
  var LAMP_GLOW = [1.0, 0.87, 0.55];
  var WATER = [0.45, 0.72, 0.82];
  var WATER_LIGHT = [0.72, 0.88, 0.93];
  var FOAM = [1.0, 0.98, 0.94];
  var TERRA = [0.76, 0.42, 0.30];
  var SAIL = [0.97, 0.95, 0.90];
  var SMOKE = [0.86, 0.86, 0.88];
  var CLOCK_FACE = [0.98, 0.96, 0.90];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  /* A flat tapered blade in the XY plane, pointing along `angle`. Sails, wheel spokes
     and water buckets are all built from this, which keeps them inside the plane the
     part rotates in. */
  function blade(builder, angle, inner, outer, halfWidth, color) {
    var cs = Math.cos(angle), sn = Math.sin(angle), px = -sn * halfWidth, py = cs * halfWidth;
    builder.face([
      [cs * inner - px, sn * inner - py, 0], [cs * inner + px, sn * inner + py, 0],
      [cs * outer + px, sn * outer + py, 0], [cs * outer - px, sn * outer - py, 0],
    ], color, [0, 0, 1]);
  }
  function finite(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }

  /* ----------------------------------------------------------------- Builder */
  function Builder() { this.p = []; this.n = []; this.c = []; this.uv = []; this.index = []; }
  Builder.prototype.vertex = function (x, y, z, nx, ny, nz, r, g, b, u, v) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(r, g, b); this.uv.push(u, v);
    return this.p.length / 3 - 1;
  };
  Builder.prototype.face = function (points, color, hint) {
    var a = points[0], b = points[1], c = points[2];
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    var order = points.slice();
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { order.reverse(); nx = -nx; ny = -ny; nz = -nz; }
    var ids = [];
    for (var i = 0; i < order.length; i++) {
      var p = order[i];
      ids.push(this.vertex(p[0], p[1], p[2], nx, ny, nz, color[0], color[1], color[2], i === 1 ? 1 : 0, i === 2 ? 1 : 0));
    }
    if (ids.length === 4) this.index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    else this.index.push(ids[0], ids[1], ids[2]);
  };
  Builder.prototype.box = function (cx, cy, cz, sx, sy, sz, color, yaw, topColor) {
    var cos = Math.cos(yaw || 0), sin = Math.sin(yaw || 0);
    var hx = sx / 2, hy = sy / 2, hz = sz / 2;
    var at = function (lx, ly, lz) { return [cx + lx * cos + lz * sin, cy + ly, cz - lx * sin + lz * cos]; };
    var top = topColor || color;
    this.face([at(-hx, hy, -hz), at(hx, hy, -hz), at(hx, hy, hz), at(-hx, hy, hz)], top, [0, 1, 0]);
    this.face([at(-hx, -hy, -hz), at(hx, -hy, -hz), at(hx, hy, -hz), at(-hx, hy, -hz)], color, [0, 0, -1]);
    this.face([at(hx, -hy, hz), at(-hx, -hy, hz), at(-hx, hy, hz), at(hx, hy, hz)], color, [0, 0, 1]);
    this.face([at(-hx, -hy, hz), at(-hx, -hy, -hz), at(-hx, hy, -hz), at(-hx, hy, hz)], color, [-1, 0, 0]);
    this.face([at(hx, -hy, -hz), at(hx, -hy, hz), at(hx, hy, hz), at(hx, hy, -hz)], color, [1, 0, 0]);
  };
  Builder.prototype.cylinder = function (cx, cy, cz, rBottom, rTop, height, sides, color, yaw) {
    var cos = Math.cos(yaw || 0), sin = Math.sin(yaw || 0);
    var at = function (r, a, y) { return [cx + Math.cos(a) * r * cos + Math.sin(a) * r * sin, cy + y, cz - Math.cos(a) * r * sin + Math.sin(a) * r * cos]; };
    for (var i = 0; i < sides; i++) {
      var a0 = TAU * i / sides, a1 = TAU * (i + 1) / sides;
      var p0 = at(rBottom, a0, 0), p1 = at(rBottom, a1, 0), p2 = at(rTop, a1, height), p3 = at(rTop, a0, height);
      this.face([p0, p1, p2, p3], color, [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
    }
    for (var t = 0; t < sides; t++) {
      var b0 = TAU * t / sides, b1 = TAU * (t + 1) / sides;
      this.face([at(0, 0, height), at(rTop, b0, height), at(rTop, b1, height)], color, [0, 1, 0]);
    }
  };
  Builder.prototype.geometry = function (T) {
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    return g;
  };
  Builder.prototype.triangles = function () { return this.index.length / 3; };

  /* ------------------------------------------------------------------- build */
  function build(T, parent, options) {
    if (!T || typeof T.InstancedMesh !== 'function') throw new Error('MarioTownFacilities needs THREE');
    if (!parent || typeof parent.add !== 'function') throw new Error('MarioTownFacilities needs a parent group');
    var opts = options || {};
    if (typeof opts.heightAt !== 'function') throw new Error('MarioTownFacilities needs heightAt');
    var heightAt = opts.heightAt;
    var bounds = opts.bounds || {minX: -102, maxX: 102, minZ: -87, maxZ: 87};
    var seaLevel = finite(opts.seaLevel, .48);
    var reducedMotion = !!opts.reducedMotion;
    var seed = finite(opts.seed, 0x7f3a91);
    var quality = opts.quality || 'auto';

    var group = new T.Group();
    group.name = 'town-facilities';
    group.userData.townFacility = true;
    parent.add(group);

    var material = new T.MeshLambertMaterial({name: 'town-facilities', vertexColors: true, side: T.DoubleSide});
    var meshes = [], animated = [], disposed = false;
    var stats = {mills: 0, waterwheels: 0, clocks: 0, forges: 0, fountains: 0, cranes: 0, smoke: 0,
      triangles: 0, drawCalls: 0, geometryBytes: 0, seed: seed, version: VERSION, disposed: false};

    /* deterministic stream, separate from any other module */
    var state = seed >>> 0;
    function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    var regions = [];
    (opts.regions || []).forEach(function (r) {
      var p = r && (r.position || r);
      if (p && isFinite(p.x) && isFinite(p.z)) regions.push({id: r.id || '', x: p.x, z: p.z});
    });
    function regionAt(id) {
      for (var i = 0; i < regions.length; i++) if (regions[i].id === id) return regions[i];
      return null;
    }
    var clearings = [];
    (opts.buildings || []).forEach(function (b) {
      if (!b) return;
      var x = finite(b.x, NaN), z = finite(b.z, NaN);
      if (isFinite(x) && isFinite(z)) clearings.push({x: x, z: z, radius: Math.max(.6, finite(b.radius, 1.4))});
    });
    var routePoints = [];
    (opts.routes || []).forEach(function (route) {
      (route && route.points || []).forEach(function (p) {
        var x = Array.isArray(p) ? p[0] : p.x, z = Array.isArray(p) ? p[2] : p.z;
        if (isFinite(x) && isFinite(z)) routePoints.push({x: x, z: z});
      });
    });

    function dry(x, z, minHeight) {
      return heightAt(x, z) >= (minHeight === undefined ? seaLevel + .7 : minHeight);
    }
    function clearOfBuildings(x, z) {
      for (var i = 0; i < clearings.length; i++) {
        var c = clearings[i];
        if (Math.hypot(x - c.x, z - c.z) < c.radius + .35) return false;
      }
      return true;
    }
    function roadDistance(x, z) {
      var best = 1e6;
      for (var i = 0; i < routePoints.length; i++) {
        var d = Math.hypot(x - routePoints[i].x, z - routePoints[i].z);
        if (d < best) best = d;
      }
      return best;
    }
    function inBounds(x, z) {
      return x > bounds.minX + 3 && x < bounds.maxX - 3 && z > bounds.minZ + 3 && z < bounds.maxZ - 3;
    }
    function findSpot(anchor, minRadius, maxRadius, minRoad, tries) {
      if (!anchor) return null;
      for (var i = 0; i < (tries || 90); i++) {
        var angle = random() * TAU, radius = minRadius + random() * (maxRadius - minRadius);
        var x = anchor.x + Math.cos(angle) * radius, z = anchor.z + Math.sin(angle) * radius;
        if (!inBounds(x, z) || !dry(x, z) || !clearOfBuildings(x, z)) continue;
        if (roadDistance(x, z) < minRoad) continue;
        return {x: x, z: z, y: heightAt(x, z), yaw: angle};
      }
      return null;
    }

    /* ---------------------------------------------------------- static shell */
    function commitStatic(builder, name) {
      if (!builder.triangles()) return null;
      var geometry = builder.geometry(T), mesh = new T.Mesh(geometry, material);
      mesh.name = name;
      mesh.userData.townFacility = true;
      group.add(mesh);
      meshes.push(mesh);
      stats.triangles += builder.triangles();
      return mesh;
    }
    function commitPart(builder, name, pivot) {
      if (!builder.triangles()) return null;
      var geometry = builder.geometry(T), mesh = new T.Mesh(geometry, material);
      mesh.name = name;
      mesh.userData.townFacility = true;
      if (pivot) mesh.position.set(pivot[0], pivot[1], pivot[2]);
      group.add(mesh);
      meshes.push(mesh);
      stats.triangles += builder.triangles();
      return mesh;
    }

    var shell = new Builder();
    var parts = {};
    var handHour = null, handMinute = null;

    /* 1. windmill: stone base, tapered tower, turning sail hub ----------------- */
    var windmill = findSpot(regionAt('gardens') || regionAt('forest'), 6, 11, 2.8);
    if (windmill) {
      var wm = windmill, yaw = wm.yaw;
      shell.cylinder(wm.x, wm.y - .3, wm.z, 3.6, 3.2, 1.3, 8, STONE, yaw);
      shell.cylinder(wm.x, wm.y + 1.0, wm.z, 3.0, 2.3, 5.6, 8, PLASTER, yaw);
      shell.cylinder(wm.x, wm.y + 6.6, wm.z, 2.5, .3, 2.4, 8, TERRA, yaw);
      // door and two windows so the tower reads as a mill, not a chimney
      shell.box(wm.x, wm.y + 2.1, wm.z, 1.1, 2.2, .2, WOOD_DARK, yaw);
      shell.box(wm.x - 1.4, wm.y + 4.4, wm.z + .1, .9, 1.0, .18, WOOD_WARM, yaw);
      shell.box(wm.x + 1.4, wm.y + 4.4, wm.z + .1, .9, 1.0, .18, WOOD_WARM, yaw);
      // The sail hub sits on the +Z face of the tower, so the wheel turns in its own
      // local XY plane and always faces the same way as the building.
      var hub = [wm.x + Math.sin(yaw) * 3.0, wm.y + 6.4, wm.z + Math.cos(yaw) * 3.0];
      shell.box(hub[0], hub[1], hub[2], .5, .5, .5, IRON, yaw);
      var sail = new Builder();
      for (var s = 0; s < 4; s++) {
        var a = TAU * s / 4, armLen = 6.4;
        blade(sail, a, .3, armLen, .09, WOOD_DARK);
        // A cloth panel rides on one side of each arm, like a real Dutch mill.
        var cs = Math.cos(a), sn = Math.sin(a), sideX = -sn * .78, sideY = cs * .78;
        sail.face([
          [cs * 2.1 + sideX - cs * 1.0, sn * 2.1 + sideY - sn * 1.0, .06],
          [cs * 2.1 + sideX + cs * 1.0, sn * 2.1 + sideY + sn * 1.0, .06],
          [cs * 5.9 + sideX + cs * 1.0, sn * 5.9 + sideY + sn * 1.0, .06],
          [cs * 5.9 + sideX - cs * 1.0, sn * 5.9 + sideY - sn * 1.0, .06],
        ], SAIL, [0, 0, 1]);
      }
      sail.cylinder(0, 0, -.08, .34, .34, .16, 8, IRON, 0);
      parts.windmill = commitPart(sail, 'town-windmill-sails', hub);
      parts.windmill.rotation.y = yaw;
      stats.mills++;
    }

    /* 2. water wheel: timber frame on the bank, wheel turns in the river -------- */
    var wheelSpot = null;
    var riverAnchors = [regionAt('connection'), regionAt('lake'), regionAt('gardens'), regionAt('collaboration')];
    for (var ri = 0; ri < riverAnchors.length && !wheelSpot; ri++) {
      var anchor = riverAnchors[ri];
      if (!anchor) continue;
      for (var w = 0; w < 120 && !wheelSpot; w++) {
        var wa = random() * TAU, wr = 5 + random() * 9;
        var wx = anchor.x + Math.cos(wa) * wr, wz = anchor.z + Math.sin(wa) * wr;
        if (!inBounds(wx, wz) || !clearOfBuildings(wx, wz)) continue;
        // Find the water line within a few metres: the wheel needs a bank next to water.
        var bestWater = 1e6, bestX = wx, bestZ = wz;
        for (var k = 0; k < 16; k++) {
          var ka = TAU * k / 16, kx = wx + Math.cos(ka) * 2.4, kz = wz + Math.sin(ka) * 2.4;
          var h = heightAt(kx, kz);
          if (h < seaLevel + .25 && h < bestWater) { bestWater = h; bestX = kx; bestZ = kz; }
        }
        if (bestWater < 1e5 && dry(wx, wz, seaLevel + .5)) wheelSpot = {x: wx, z: wz, y: heightAt(wx, wz), yaw: Math.atan2(bestX - wx, bestZ - wz)};
      }
    }
    if (wheelSpot) {
      var ww = wheelSpot, wy = ww.yaw;
      shell.box(ww.x, ww.y + 1.1, ww.z, 2.6, .3, 3.4, WOOD, wy);
      shell.box(ww.x, ww.y + 3.2, ww.z, .35, 4.2, .35, WOOD_DARK, wy);
      shell.box(ww.x + Math.sin(wy) * 1.5, ww.y + 3.2, ww.z + Math.cos(wy) * 1.5, .35, 4.2, .35, WOOD_DARK, wy);
      var wheelPivot = [ww.x + Math.sin(wy) * .9, ww.y + 2.9, ww.z + Math.cos(wy) * .9];
      // The wheel is a vertical disc in its local XY plane, so a single Z rotation
      // turns it; two rims and eight spokes read clearly from the isometric view.
      var wheel = new Builder();
      for (var ring = 0; ring < 2; ring++) {
        var rr = ring ? 2.0 : 1.72, rw = ring ? .10 : .09;
        for (var seg = 0; seg < 16; seg++) {
          var a0 = TAU * seg / 16, a1 = TAU * (seg + 1) / 16;
          wheel.face([
            [Math.cos(a0) * (rr - rw), Math.sin(a0) * (rr - rw), ring ? .16 : -.16],
            [Math.cos(a0) * (rr + rw), Math.sin(a0) * (rr + rw), ring ? .16 : -.16],
            [Math.cos(a1) * (rr + rw), Math.sin(a1) * (rr + rw), ring ? .16 : -.16],
            [Math.cos(a1) * (rr - rw), Math.sin(a1) * (rr - rw), ring ? .16 : -.16],
          ], WOOD_WARM, [0, 0, 1]);
        }
      }
      for (var sp = 0; sp < 8; sp++) {
        var sa = TAU * sp / 8;
        blade(wheel, sa, .2, 1.95, .075, WOOD_DARK);
        // bucket at the rim
        var bx = Math.cos(sa) * 1.95, by = Math.sin(sa) * 1.95;
        wheel.box(bx, by, 0, .5, .42, .34, WOOD, 0);
      }
      wheel.box(0, 0, 0, .55, .55, .5, IRON, 0);
      parts.wheel = commitPart(wheel, 'town-water-wheel', wheelPivot);
      parts.wheel.rotation.set(0, wy + Math.PI / 2, 0);
      stats.waterwheels++;
    }

    /* 3. clock tower: stone shaft, clock face, hands follow real time ---------- */
    var clock = findSpot(regionAt('collaboration'), 5, 9, 2.2);
    if (clock) {
      shell.cylinder(clock.x, clock.y - .2, clock.z, 2.0, 1.75, 1.0, 8, STONE, clock.yaw);
      shell.cylinder(clock.x, clock.y + .8, clock.z, 1.55, 1.35, 8.6, 8, PLASTER, clock.yaw);
      shell.cylinder(clock.x, clock.y + 9.4, clock.z, 1.75, .2, 2.4, 8, TERRA, clock.yaw);
      var faceZ = 1.42;
      var fTop = clock.y + 8.3, fBottom = clock.y + 5.6, fHalf = 1.15;
      shell.face([[clock.x - fHalf, fBottom, clock.z + faceZ], [clock.x + fHalf, fBottom, clock.z + faceZ],
        [clock.x + fHalf, fTop, clock.z + faceZ], [clock.x - fHalf, fTop, clock.z + faceZ]], CLOCK_FACE, [0, 0, 1]);
      var clockPivot = [clock.x, (fTop + fBottom) / 2, clock.z + faceZ + .06];
      var hands = new Builder();
      hands.face([[-.07, -.1, 0], [.07, -.1, 0], [.07, 1.0, 0], [-.07, 1.0, 0]], IRON, [0, 0, 1]);
      var minute = new Builder();
      minute.face([[-.045, -.1, 0], [.045, -.1, 0], [.045, .62, 0], [-.045, .62, 0]], IRON, [0, 0, 1]);
      handHour = commitPart(hands, 'town-clock-hour', clockPivot);
      handMinute = commitPart(minute, 'town-clock-minute', clockPivot);
      handHour.position.z += .02;
      stats.clocks++;
    }

    /* 4. forge: open shed with an anvil and a hammer that falls on a cycle ----- */
    var forge = findSpot(regionAt('automation') || regionAt('collaboration'), 4.5, 8.5, 2.4);
    if (forge) {
      shell.box(forge.x, forge.y + .2, forge.z, 4.6, .4, 3.6, STONE_DARK, forge.yaw);
      shell.box(forge.x, forge.y + 2.9, forge.z - .1, 4.8, .34, 3.9, WOOD_DARK, forge.yaw);
      for (var post = 0; post < 4; post++) {
        var pa = TAU * post / 4 + Math.PI / 4;
        shell.box(forge.x + Math.cos(pa) * 2.0, forge.y + 1.5, forge.z + Math.sin(pa) * 1.5, .26, 2.9, .26, WOOD_DARK, forge.yaw);
      }
      shell.box(forge.x, forge.y + 1.05, forge.z + .3, 1.1, .7, .8, IRON, forge.yaw);
      shell.box(forge.x - 1.5, forge.y + .95, forge.z - .8, 1.0, 1.3, 1.0, STONE, forge.yaw);
      shell.box(forge.x - 1.5, forge.y + 1.7, forge.z - .8, .7, .3, .7, LAMP_GLOW, forge.yaw);
      var hammerPivot = [forge.x + .45, forge.y + 2.1, forge.z + .2];
      var hammer = new Builder();
      hammer.box(0, -.7, 0, .1, 1.5, .1, WOOD, 0);
      hammer.box(0, -1.5, 0, .42, .34, .3, IRON, 0);
      parts.hammer = commitPart(hammer, 'town-forge-hammer', hammerPivot);
      stats.forges++;
    }

    /* 5. fountain: round basin, pillar and water jets that pulse --------------- */
    var fountain = findSpot(regionAt('automation') || regionAt('collaboration'), 4, 7, 2.0);
    if (fountain) {
      shell.cylinder(fountain.x, fountain.y, fountain.z, 2.5, 2.5, .55, 12, STONE, 0);
      shell.cylinder(fountain.x, fountain.y + .55, fountain.z, 2.1, 2.1, .12, 12, WATER, 0);
      shell.cylinder(fountain.x, fountain.y + .6, fountain.z, .55, .42, 1.9, 8, STONE_DARK, 0);
      shell.cylinder(fountain.x, fountain.y + 2.4, fountain.z, .95, .7, .3, 10, STONE, 0);
      var jets = new Builder();
      for (var j = 0; j < 4; j++) {
        var ja = TAU * j / 4 + .4;
        var jx = Math.cos(ja) * .55, jz = Math.sin(ja) * .55;
        jets.cylinder(jx, 2.6, jz, .12, .04, 2.4, 6, WATER_LIGHT, 0);
      }
      parts.jets = commitPart(jets, 'town-fountain-jets', [fountain.x, fountain.y, fountain.z]);
      stats.fountains++;
    }

    /* 6. dock crane: mast, boom that swings, hook that rises ------------------- */
    var crane = findSpot(regionAt('connection'), 4.5, 9, 2.0);
    if (crane) {
      shell.box(crane.x, crane.y + .2, crane.z, 3.0, .4, 3.0, STONE_DARK, crane.yaw);
      shell.cylinder(crane.x, crane.y + .4, crane.z, .42, .34, 5.0, 8, WOOD_DARK, crane.yaw);
      var boomPivot = [crane.x, crane.y + 5.2, crane.z];
      var boom = new Builder();
      boom.box(2.2, 0, 0, 4.6, .26, .26, WOOD, 0);
      boom.box(4.3, -.9, 0, .1, 1.9, .1, IRON, 0);
      boom.box(4.3, -1.9, 0, .34, .3, .34, IRON, 0);
      parts.boom = commitPart(boom, 'town-crane-boom', boomPivot);
      stats.cranes++;
    }

    commitStatic(shell, 'town-facility-shell');

    /* 7. chimney smoke: instanced quads rising and fading ---------------------- */
    var smokeSites = [];
    var smokeCount = quality === 'smooth' ? 3 : 5;
    var shells = clearings.slice(0, 6);
    for (var si = 0; si < shells.length && smokeSites.length < smokeCount; si++) {
      var sh = shells[si];
      var sx = sh.x + (random() - .5) * 1.2, sz = sh.z + (random() - .5) * 1.2;
      if (!dry(sx, sz)) continue;
      smokeSites.push({x: sx, y: heightAt(sx, sz) + 4.6 + random() * .8, z: sz, phase: random()});
    }
    var smokeMesh = null, smokeUniforms = {uTime: {value: 0}};
    if (smokeSites.length) {
      var puff = new Builder();
      puff.face([[-.42, 0, 0], [.42, 0, 0], [.42, .8, 0], [-.42, .8, 0]], SMOKE, [0, 0, 1]);
      puff.face([[0, 0, -.42], [0, 0, .42], [0, .8, .42], [0, .8, -.42]], SMOKE, [1, 0, 0]);
      var smokeGeometry = puff.geometry(T);
      var smokeMaterial = new T.MeshLambertMaterial({name: 'town-smoke', vertexColors: true, side: T.DoubleSide, transparent: true, opacity: .55, depthWrite: false});
      smokeMaterial.onBeforeCompile = function (shader) {
        shader.uniforms.uTime = smokeUniforms.uTime;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          '  float smokeSeed = fract(sin(instanceMatrix[3].x * 12.9898 + instanceMatrix[3].z * 78.233) * 43758.5453);',
          '  float smokeRise = fract(uTime * 0.11 + smokeSeed);',
          '  transformed.y += smokeRise * 3.4;',
          '  transformed.x += sin(uTime * 0.6 + smokeSeed * 6.28) * 0.35 * smokeRise;',
          '  transformed.z += cos(uTime * 0.5 + smokeSeed * 4.7) * 0.28 * smokeRise;',
        ].join('\n'));
      };
      smokeMaterial.customProgramCacheKey = function () { return 'town-smoke-v1'; };
      smokeMesh = new T.InstancedMesh(smokeGeometry, smokeMaterial, smokeSites.length);
      smokeMesh.name = 'town-chimney-smoke';
      smokeMesh.userData.townFacility = true;
      smokeMesh.frustumCulled = false;
      var tmpM = new T.Matrix4(), tmpP = new T.Vector3(), tmpQ = new T.Quaternion(), tmpS = new T.Vector3(1, 1, 1);
      for (var pi = 0; pi < smokeSites.length; pi++) {
        tmpP.set(smokeSites[pi].x, smokeSites[pi].y, smokeSites[pi].z);
        tmpM.compose(tmpP, tmpQ, tmpS);
        smokeMesh.setMatrixAt(pi, tmpM);
      }
      smokeMesh.instanceMatrix.needsUpdate = true;
      group.add(smokeMesh);
      meshes.push(smokeMesh);
      stats.smoke = smokeSites.length;
      stats.triangles += (smokeGeometry.index ? smokeGeometry.index.count : smokeGeometry.attributes.position.count) / 3 * smokeSites.length;
      animated.push({kind: 'smoke', mesh: smokeMesh});
    }

    if (parts.windmill) animated.push({kind: 'windmill', mesh: parts.windmill, speed: .66 + random() * .12});
    if (parts.wheel) animated.push({kind: 'wheel', mesh: parts.wheel, speed: .34 + random() * .08});
    if (parts.hammer) animated.push({kind: 'hammer', mesh: parts.hammer});
    if (parts.jets) animated.push({kind: 'jets', mesh: parts.jets, base: parts.jets.scale.clone()});
    if (parts.boom) animated.push({kind: 'boom', mesh: parts.boom, phase: random() * TAU});
    if (handHour) animated.push({kind: 'clocks', hour: handHour, minute: handMinute});

    /* -------------------------------------------------------------- accounting */
    var uniqueGeometries = [];
    meshes.forEach(function (m) { if (uniqueGeometries.indexOf(m.geometry) === -1) uniqueGeometries.push(m.geometry); });
    var bytes = 0;
    uniqueGeometries.forEach(function (g) {
      Object.keys(g.attributes).forEach(function (k) { bytes += g.attributes[k].array.byteLength; });
      if (g.index) bytes += g.index.array.byteLength;
    });
    meshes.forEach(function (m) {
      if (m.instanceMatrix) bytes += m.instanceMatrix.array.byteLength;
      if (m.instanceColor) bytes += m.instanceColor.array.byteLength;
    });
    stats.geometryBytes = bytes;
    stats.drawCalls = meshes.length;

    /* ---------------------------------------------------------------- animate */
    var clockSeconds = 0, lastTime = null;
    function update(time, settings) {
      if (disposed) return false;
      var view = settings || {};
      if (view.animate === false || reducedMotion) { lastTime = Number.isFinite(time) ? time : lastTime; return false; }
      if (typeof time !== 'number' || !isFinite(time)) return false;
      var delta = lastTime === null ? 0 : Math.max(0, Math.min(.25, time - lastTime));
      lastTime = time;
      clockSeconds += delta;
      var moved = false;
      for (var i = 0; i < animated.length; i++) {
        var item = animated[i];
        if (item.kind === 'windmill') { item.mesh.rotation.z -= item.speed * delta; moved = true; }
        else if (item.kind === 'wheel') { item.mesh.rotation.x -= item.speed * delta; moved = true; }
        else if (item.kind === 'hammer') {
          // One strike every 1.6 s: fast fall, slow lift.
          var cycle = (clockSeconds % 1.6) / 1.6;
          var angle = cycle < .18 ? (cycle / .18) * 1.15 : 1.15 - ((cycle - .18) / .82) * 1.15;
          item.mesh.rotation.z = -angle;
          moved = true;
        } else if (item.kind === 'jets') {
          var pulse = 1 + Math.sin(clockSeconds * 2.4) * .12;
          item.mesh.scale.set(1, pulse, 1);
          moved = true;
        } else if (item.kind === 'boom') {
          item.mesh.rotation.y = Math.sin(clockSeconds * .62 + item.phase) * .44;
          moved = true;
        } else if (item.kind === 'clocks') {
          // A real clock: the minute hand turns once an hour, the hour hand once
          // every twelve hours, so the ratio is exactly 12:1.
          item.minute.rotation.z = -((clockSeconds / 3600) % 1) * TAU;
          item.hour.rotation.z = -((clockSeconds / 43200) % 1) * TAU;
          moved = true;
        } else if (item.kind === 'smoke') {
          smokeUniforms.uTime.value = clockSeconds;
          moved = true;
        }
      }
      return moved;
    }

    /* ----------------------------------------------------------------- dispose */
    function dispose() {
      if (disposed) return false;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      meshes.forEach(function (m) {
        if (typeof m.dispose === 'function') m.dispose();
        m.instanceMatrix = null;
        m.instanceColor = null;
        if (m.isInstancedMesh) m.count = 0;
      });
      uniqueGeometries.forEach(function (g) { g.dispose(); });
      material.dispose();
      if (smokeMesh) smokeMesh.material.dispose();
      group.clear();
      meshes.length = 0;
      animated.length = 0;
      stats.triangles = 0;
      stats.drawCalls = 0;
      stats.geometryBytes = 0;
      stats.disposed = true;
      return true;
    }

    return {group: group, stats: stats, update: update, dispose: dispose};
  }

  root.MarioTownFacilities = {version: VERSION, build: build};
})(typeof window !== 'undefined' ? window : this);
