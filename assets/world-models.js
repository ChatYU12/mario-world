/*
 * Self-authored storybook architecture. No downloaded models or textures.
 * Every public model has +Y up, +Z front, a clean root transform, and ground y=0.
 * Geometry and material objects are cached within a kit. Dispose the kit's
 * resources with the whole scene, never with an individual returned model.
 */
(function (root) {
  'use strict';

  root.MarioWorldModels = { create: create };

  function create(T) {
    var materials = {};
    var geometries = {};
    var Y = new T.Vector3(0, 1, 0);

    function material(color, options) {
      var key = color + JSON.stringify(options || {});
      if (!materials[key]) {
        materials[key] = new T.MeshStandardMaterial(Object.assign({
          color: color,
          roughness: 0.67,
          metalness: 0
        }, options || {}));
      }
      return materials[key];
    }

    var M = {
      cream: material(0xffeed2), limestone: material(0xe5cfab),
      trim: material(0xffdfab), pale: material(0xfff7e7),
      white: material(0xfffdf4), pink: material(0xf47798),
      red: material(0xd94468), roofShade: material(0xb92f53),
      gold: material(0xefb94e, { metalness: 0.46, roughness: 0.32 }),
      blue: material(0x376c92), glass: material(0x6cc8dc, { roughness: 0.25 }),
      glassLight: material(0xb4e6df, { roughness: 0.23 }),
      recess: material(0x43383c), wood: material(0x9c633b),
      woodLight: material(0xc5925b), brown: material(0x6b442f),
      green: material(0x45b95d), lime: material(0x8ccc64),
      forest: material(0x278d4a), leafShade: material(0x237744),
      pipe: material(0x23a957, { roughness: 0.31 }),
      pipeLip: material(0x59cf73, { roughness: 0.28 }),
      inside: material(0x163e2b), charcoal: material(0x393746),
      ash: material(0x625565), lava: material(0xff9445, {
        emissive: 0xc73b08, emissiveIntensity: 0.5
      }),
      sand: material(0xf1d18b), cloud: material(0xffffff),
      sail: material(0xfff3d2), steel: material(0x56838d, {
        metalness: 0.28, roughness: 0.45
      }),
      teal: material(0x358f9a), orange: material(0xe69b4b)
    };

    function geometry(key, builder) {
      if (!geometries[key]) geometries[key] = builder();
      return geometries[key];
    }

    function group(name) {
      var result = new T.Group();
      result.name = name;
      return result;
    }

    function add(parent, geo, mat, x, y, z) {
      var result = new T.Mesh(geo, mat);
      result.position.set(x || 0, y || 0, z || 0);
      result.castShadow = true;
      result.receiveShadow = true;
      parent.add(result);
      return result;
    }

    function box(parent, mat, x, y, z, w, h, d) {
      var geo = geometry('unit-box', function () { return new T.BoxGeometry(1, 1, 1); });
      var result = add(parent, geo, mat, x, y, z);
      result.scale.set(w, h, d);
      return result;
    }

    function roundRect(w, h, r) {
      var s = new T.Shape();
      var x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y);
      s.lineTo(x + w - r, y);
      s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r);
      s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h);
      s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r);
      s.quadraticCurveTo(x, y, x + r, y);
      return s;
    }

    // Small bevels are authored in physical dimensions, not by scaling a cube.
    function softBox(parent, mat, x, y, z, w, h, d, radius) {
      var r = radius === undefined ? Math.min(w, h, d) * 0.11 : radius;
      var key = ['soft', w, h, d, r].join('/');
      var geo = geometry(key, function () {
        var bevel = Math.min(r * 0.38, d * 0.15);
        var g = new T.ExtrudeGeometry(roundRect(w - bevel * 2, h - bevel * 2, r), {
          depth: d - bevel * 2,
          steps: 1,
          curveSegments: 2,
          bevelEnabled: true,
          bevelSize: bevel,
          bevelThickness: bevel,
          bevelSegments: 1
        });
        g.translate(0, 0, -d / 2 + bevel);
        return g;
      });
      return add(parent, geo, mat, x, y, z);
    }

    function cylinderGeo(rt, rb, h, segments, open) {
      return geometry(['cylinder', rt, rb, h, segments || 20, !!open].join('/'), function () {
        return new T.CylinderGeometry(rt, rb, h, segments || 20, 1, !!open);
      });
    }

    function cylinder(parent, mat, x, y, z, rt, rb, h, segments, open) {
      return add(parent, cylinderGeo(rt, rb, h, segments, open), mat, x, y, z);
    }

    function ball(parent, mat, x, y, z, w, h, d, detail) {
      var geo = geometry('sphere/' + (detail || 12), function () {
        return new T.SphereGeometry(1, detail || 12, 8);
      });
      var result = add(parent, geo, mat, x, y, z);
      result.scale.set(w, h, d);
      return result;
    }

    function ring(parent, mat, x, y, z, radius, tube, radial, tubular) {
      var geo = geometry(['ring', radius, tube, radial || 4, tubular || 24].join('/'), function () {
        return new T.TorusGeometry(radius, tube, radial || 4, tubular || 24);
      });
      return add(parent, geo, mat, x, y, z);
    }

    function rod(parent, mat, start, end, radius, segments) {
      var a = new T.Vector3().fromArray(start), b = new T.Vector3().fromArray(end);
      var delta = b.clone().sub(a);
      var result = cylinder(parent, mat, 0, 0, 0, radius, radius, delta.length(), segments || 5);
      result.position.copy(a).add(b).multiplyScalar(0.5);
      result.quaternion.setFromUnitVectors(Y, delta.normalize());
      return result;
    }

    function archShape(w, h) {
      var r = w / 2, s = new T.Shape();
      s.moveTo(-r, 0);
      s.lineTo(r, 0);
      s.lineTo(r, h - r);
      s.absarc(0, h - r, r, 0, Math.PI, false);
      s.lineTo(-r, 0);
      return s;
    }

    function arch(parent, mat, x, y, z, w, h, depth) {
      var g = geometry(['arch', w, h, depth].join('/'), function () {
        return new T.ExtrudeGeometry(archShape(w, h), {
          depth: depth, bevelEnabled: false, curveSegments: 6, steps: 1
        });
      });
      return add(parent, g, mat, x, y, z);
    }

    function archFrame(parent, mat, x, y, z, w, h, thickness, depth) {
      var g = geometry(['arch-frame', w, h, thickness, depth].join('/'), function () {
        var s = archShape(w, h);
        var inner = archShape(w - thickness * 2, h - thickness * 2);
        var points = inner.getPoints(6).reverse();
        points.forEach(function (p) { p.y += thickness; });
        s.holes.push(new T.Path(points));
        return new T.ExtrudeGeometry(s, {
          depth: depth, bevelEnabled: true, bevelThickness: thickness * 0.18,
          bevelSize: thickness * 0.18, bevelSegments: 1, curveSegments: 6
        });
      });
      return add(parent, g, mat, x, y, z);
    }

    // The window frame projects beyond the shadow reveal; the glazing remains
    // behind it. Window assemblies can face any outward wall normal.
    function windowAt(parent, x, y, z, w, h, trim, glazing, angle) {
      var g = group('inset-arched-window');
      g.position.set(x, y, z);
      g.rotation.y = angle || 0;
      arch(g, M.recess, 0, 0, 0, w, h, 0.001);
      arch(g, glazing || M.glass, 0, 0.003, 0.0011, w - 0.006, h - 0.006, 0.0006);
      archFrame(g, trim || M.pale, 0, 0, 0.001, w + 0.003, h + 0.002, 0.0035, 0.0035);
      box(g, trim || M.pale, 0, h * 0.43, 0.003, w * 0.75, 0.0017, 0.0018);
      box(g, trim || M.pale, 0, h * 0.36, 0.003, 0.0016, h * 0.65, 0.0018);
      softBox(g, trim || M.pale, 0, -0.001, 0.003, w + 0.010, 0.004, 0.010, 0.001);
      parent.add(g);
      return g;
    }

    function flag(parent, x, y, z, dark) {
      cylinder(parent, M.gold, x, y + 0.025, z, 0.0013, 0.0016, 0.050, 8);
      ball(parent, M.gold, x, y + 0.052, z, 0.0023, 0.0023, 0.0023, 8);
      var flagGeo = geometry('waving-pennant', function () {
        var vertices = [0, 0, 0, 0.012, -0.002, 0.0025, 0.028, -0.008, 0,
          0, -0.018, 0, 0.012, -0.016, -0.0015, 0.028, -0.008, 0];
        var g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute([0,1,.45,.9,1,.5,0,0,.45,.1,1,.5], 2));
        g.computeVertexNormals();
        return g;
      });
      var cloth = material(dark ? 0xffa34e : 0xf27695, { side: T.DoubleSide });
      add(parent, flagGeo, cloth, x, y + 0.047, z);
    }

    function insignia(parent, x, y, z, dark, scale) {
      var g = group('star-medallion');
      g.position.set(x, y, z);
      if (scale) g.scale.setScalar(scale);
      var disk = cylinder(g, M.gold, 0, 0, 0, 0.019, 0.019, 0.004, 24);
      disk.rotation.x = Math.PI / 2;
      ring(g, dark ? M.lava : M.trim, 0, 0, 0.003, 0.0175, 0.0012, 4, 20);
      var starGeo = geometry('star-seal', function () {
        var s = new T.Shape();
        for (var i = 0; i < 10; i++) {
          var a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.0054 : 0.0118;
          if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        s.closePath();
        return new T.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: false });
      });
      add(g, starGeo, dark ? M.charcoal : M.pale, 0, 0, 0.004);
      parent.add(g);
    }

    // Curved lathe silhouette and raised seams replace a single plain cone.
    function turretRoof(parent, x, y, z, radius, height, dark, central) {
      var roofMat = dark ? M.lava : central ? M.pink : M.red;
      var profile = [[0, 1], [0.13, 0.78], [0.31, 0.51], [0.56, 0.26], [0.84, 0.07], [1, 0.025], [1, 0]];
      var g = geometry(['turret-roof', radius, height].join('/'), function () {
        var points = profile.slice().reverse().map(function (p) {
          return new T.Vector2(p[0] * radius, p[1] * height);
        });
        return new T.LatheGeometry(points, 20);
      });
      add(parent, g, roofMat, x, y, z);
      cylinder(parent, dark ? M.ash : M.roofShade, x, y + 0.002, z, radius, radius * 0.98, 0.004, 20);
      var rim = ring(parent, dark ? M.gold : M.pink, x, y + 0.004, z, radius * 0.96, 0.0016, 3, 20);
      rim.rotation.x = Math.PI / 2;
      var ribGeo = geometry(['roof-rib', radius, height].join('/'), function () {
        var points = profile.slice(0, -1).map(function (p) {
          return new T.Vector3(p[0] * radius + 0.0006, p[1] * height, 0);
        });
        return new T.TubeGeometry(new T.CatmullRomCurve3(points), 6, 0.00065, 3, false);
      });
      for (var i = 0; i < 8; i++) {
        var rib = add(parent, ribGeo, dark ? M.gold : M.pink, x, y, z);
        rib.rotation.y = i * Math.PI / 4;
      }
      ball(parent, M.gold, x, y + height + 0.003, z, 0.0032, 0.004, 0.0032, 8);
    }

    function masonryTower(parent, x, z, tall, dark) {
      var wall = dark ? M.charcoal : M.cream;
      var trim = dark ? M.ash : M.trim;
      cylinder(parent, trim, x, 0.027, z, 0.036, 0.039, 0.025, 20);
      cylinder(parent, wall, x, 0.039 + tall / 2, z, 0.029, 0.033, tall, 20);
      [0.064, 0.116, 0.168].forEach(function (y) {
        if (y < tall + 0.025) cylinder(parent, trim, x, y, z, 0.032, 0.0325, 0.0032, 20);
      });
      cylinder(parent, trim, x, tall + 0.036, z, 0.036, 0.031, 0.013, 20);
      cylinder(parent, wall, x, tall + 0.047, z, 0.035, 0.036, 0.009, 20);
      turretRoof(parent, x, tall + 0.052, z, 0.046, 0.107, dark, false);
      windowAt(parent, x, 0.105, z + 0.032, 0.016, 0.039, trim, dark ? M.lava : M.blue);
      // Alternate front/rear towers expose outward side windows while rotating.
      windowAt(parent, x + (x < 0 ? -0.031 : 0.031), 0.105, z,
        0.016, 0.039, trim, dark ? M.lava : M.blue, x < 0 ? -Math.PI / 2 : Math.PI / 2);
    }

    function castle(dark) {
      var g = group(dark ? 'lava-castle' : 'storybook-castle');
      var wall = dark ? M.charcoal : M.cream;
      var trim = dark ? M.ash : M.trim;
      var glazing = dark ? M.lava : M.blue;

      softBox(g, dark ? M.ash : M.limestone, 0, 0.010, 0, 0.373, 0.020, 0.265, 0.007);
      softBox(g, trim, 0, 0.022, 0, 0.356, 0.011, 0.251, 0.004);
      softBox(g, wall, 0, 0.031, -0.003, 0.337, 0.010, 0.231, 0.003);

      // Curtain walls have layered plinths, inset masonry courses and caps.
      [-1, 1].forEach(function (side) {
        softBox(g, wall, side * 0.143, 0.089, 0, 0.027, 0.116, 0.196, 0.003);
        softBox(g, trim, side * 0.143, 0.048, 0, 0.032, 0.010, 0.198, 0.002);
        softBox(g, trim, side * 0.143, 0.146, 0, 0.035, 0.009, 0.200, 0.002);
        for (var c = 0; c < 6; c++) {
          softBox(g, wall, side * 0.143, 0.158, -0.082 + c * 0.033,
            0.033, 0.019, 0.019, 0.002);
        }
      });
      softBox(g, wall, 0, 0.089, -0.098, 0.289, 0.116, 0.026, 0.003);
      for (var j = 0; j < 7; j++) {
        softBox(g, trim, -0.123 + j * 0.041, 0.158, -0.098, 0.024, 0.019, 0.032, 0.002);
      }
      // Front wall is split around a real doorway instead of covering the arch.
      [-1, 1].forEach(function (side) {
        softBox(g, wall, side * 0.094, 0.091, 0.103, 0.095, 0.120, 0.028, 0.003);
        softBox(g, trim, side * 0.096, 0.050, 0.119, 0.087, 0.007, 0.004, 0.001);
        softBox(g, trim, side * 0.096, 0.133, 0.119, 0.087, 0.006, 0.004, 0.001);
        for (var c = 0; c < 3; c++) {
          softBox(g, trim, side * (0.060 + c * 0.033), 0.160, 0.103,
            0.022, 0.019, 0.033, 0.002);
        }
      });

      [-1, 1].forEach(function (sx) {
        [-1, 1].forEach(function (sz) { masonryTower(g, sx * 0.143, sz * 0.096, sz > 0 ? 0.177 : 0.194, dark); });
      });

      // Main keep: stepped body, buttresses, upper drum and crown roof.
      softBox(g, trim, 0, 0.050, -0.013, 0.166, 0.031, 0.151, 0.006);
      softBox(g, wall, 0, 0.185, -0.018, 0.143, 0.262, 0.132, 0.006);
      [0.107, 0.185, 0.287].forEach(function (y) {
        softBox(g, trim, 0, y, -0.018, 0.149, 0.006, 0.138, 0.002);
      });
      [-1, 1].forEach(function (side) {
        softBox(g, trim, side * 0.067, 0.158, 0.047, 0.012, 0.200, 0.012, 0.002);
      });
      softBox(g, trim, 0, 0.312, -0.018, 0.160, 0.014, 0.148, 0.003);
      cylinder(g, wall, 0, 0.346, -0.018, 0.043, 0.047, 0.061, 20);
      cylinder(g, trim, 0, 0.374, -0.018, 0.049, 0.049, 0.009, 20);
      turretRoof(g, 0, 0.381, -0.018, 0.064, 0.102, dark, true);
      flag(g, 0, 0.486, -0.018, dark);

      windowAt(g, -0.038, 0.217, 0.049, 0.025, 0.049, trim, glazing);
      windowAt(g, 0.038, 0.217, 0.049, 0.025, 0.049, trim, glazing);
      windowAt(g, 0, 0.323, 0.026, 0.022, 0.035, trim, glazing);
      windowAt(g, -0.073, 0.217, -0.017, 0.025, 0.049, trim, glazing, -Math.PI / 2);
      windowAt(g, 0.073, 0.217, -0.017, 0.025, 0.049, trim, glazing, Math.PI / 2);

      arch(g, M.recess, 0, 0.033, 0.114, 0.080, 0.111, 0.001);
      arch(g, M.wood, 0, 0.034, 0.116, 0.059, 0.100, 0.003);
      archFrame(g, trim, 0, 0.030, 0.118, 0.087, 0.120, 0.009, 0.008);
      [-0.022, -0.011, 0, 0.011, 0.022].forEach(function (x) {
        box(g, M.brown, x, 0.069, 0.120, 0.0012, 0.070, 0.001);
      });
      [0.055, 0.089].forEach(function (y) {
        softBox(g, M.brown, 0, y, 0.122, 0.057, 0.004, 0.002, 0.0006);
      });
      [-1, 1].forEach(function (side) {
        ring(g, M.gold, side * 0.008, 0.074, 0.125, 0.003, 0.0008, 4, 10);
      });
      insignia(g, 0, 0.178, 0.120, dark, 1.05);
      // Three approach stairs establish a visible ground contact and entry path.
      for (var step = 0; step < 3; step++) {
        softBox(g, step % 2 ? trim : M.limestone, 0, 0.005 + step * 0.005,
          0.161 - step * 0.013, 0.102 - step * 0.008, 0.010 + step * 0.010,
          0.046, 0.002);
      }
      flag(g, -0.143, 0.342, 0.096, dark);
      flag(g, 0.143, 0.342, 0.096, dark);
      return g;
    }

    function mushroomHouse() {
      var g = group('mushroom-house');
      cylinder(g, M.limestone, 0, 0.005, 0, 0.046, 0.048, 0.010, 28);
      cylinder(g, M.cream, 0, 0.042, 0, 0.039, 0.044, 0.076, 28);
      cylinder(g, M.trim, 0, 0.013, 0, 0.044, 0.045, 0.004, 28);
      var capGeo = geometry('mushroom-cap', function () {
        return new T.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      });
      var cap = add(g, capGeo, M.red, 0, 0.083, 0);
      cap.scale.set(0.066, 0.073, 0.066);
      cylinder(g, M.pale, 0, 0.082, 0, 0.066, 0.065, 0.006, 28);
      var roofRim = ring(g, M.pink, 0, 0.084, 0, 0.064, 0.0025, 5, 28);
      roofRim.rotation.x = Math.PI / 2;
      [[0.42, 0.2], [0.78, 1.27], [0.90, 2.65], [0.64, 3.85], [1.13, 4.8], [1.15, 0.12], [0.25, 2.1]].forEach(function (p) {
        var t = p[0], a = p[1], x = 0.066 * Math.sin(t) * Math.cos(a);
        var y = 0.073 * Math.cos(t), z = 0.066 * Math.sin(t) * Math.sin(a);
        var n = new T.Vector3(x / (0.066 * 0.066), y / (0.073 * 0.073), z / (0.066 * 0.066)).normalize();
        var spot = ball(g, M.pale, x, y + 0.083, z, 0.0115, 0.0012, 0.0098, 12);
        spot.quaternion.setFromUnitVectors(Y, n);
      });
      arch(g, M.recess, 0, 0.009, 0.044, 0.031, 0.055, 0.001);
      arch(g, M.wood, 0, 0.010, 0.045, 0.024, 0.049, 0.001);
      archFrame(g, M.trim, 0, 0.007, 0.046, 0.035, 0.059, 0.004, 0.004);
      softBox(g, M.woodLight, 0, 0.008, 0.053, 0.039, 0.007, 0.018, 0.002);
      ball(g, M.gold, 0.007, 0.029, 0.050, 0.0023, 0.0023, 0.0013, 8);
      windowAt(g, -0.028, 0.032, 0.033, 0.017, 0.024, M.pale, M.glass, -0.28);
      windowAt(g, 0.037, 0.030, -0.002, 0.017, 0.025, M.pale, M.glass, Math.PI / 2);
      for (var i = 0; i < 4; i++) {
        box(g, M.trim, -0.010 + i * 0.0065, 0.031, 0.047, 0.0008, 0.035, 0.001);
      }
      return g;
    }

    function pipe() {
      var g = group('hollow-pipe');
      cylinder(g, M.pipe, 0, 0.050, 0, 0.031, 0.032, 0.100, 28, true);
      cylinder(g, M.pipeLip, 0, 0.008, 0, 0.034, 0.034, 0.009, 28);
      var lipGeo = geometry('beveled-pipe-lip', function () {
        var s = new T.Shape(), hole = new T.Path();
        s.absarc(0, 0, 0.039, 0, Math.PI * 2, false);
        hole.absarc(0, 0, 0.026, 0, Math.PI * 2, true);
        s.holes.push(hole);
        var e = new T.ExtrudeGeometry(s, {
          depth: 0.025, bevelEnabled: true, bevelSize: 0.0012,
          bevelThickness: 0.0012, bevelSegments: 2, curveSegments: 16
        });
        e.rotateX(-Math.PI / 2);
        return e;
      });
      add(g, lipGeo, M.pipeLip, 0, 0.101, 0);
      cylinder(g, material(0x17412d, { side: T.BackSide }), 0, 0.086, 0, 0.026, 0.026, 0.077, 28, true);
      cylinder(g, M.inside, 0, 0.048, 0, 0.026, 0.026, 0.002, 28);
      var collar = ring(g, M.pipe, 0, 0.101, 0, 0.034, 0.0011, 4, 24);
      collar.rotation.x = Math.PI / 2;
      return g;
    }

    function tree(snow) {
      var g = group(snow ? 'snow-tree' : 'round-tree');
      cylinder(g, M.wood, 0, 0.037, 0, 0.008, 0.013, 0.074, 12);
      rod(g, M.wood, [0, 0.049, 0], [-0.025, 0.085, 0.006], 0.004, 6);
      rod(g, M.wood, [0, 0.055, 0], [0.026, 0.095, 0.004], 0.0038, 6);
      ball(g, snow ? M.pale : M.leafShade, 0, 0.109, 0, 0.050, 0.042, 0.045, 16);
      ball(g, snow ? M.white : M.forest, -0.022, 0.125, 0.010, 0.029, 0.033, 0.030, 16);
      ball(g, snow ? M.white : M.green, 0.023, 0.126, 0.004, 0.030, 0.034, 0.032, 16);
      ball(g, snow ? M.white : M.lime, 0, 0.151, -0.005, 0.034, 0.029, 0.035, 16);
      if (!snow) {
        [[-0.027, 0.131, 0.031], [0.025, 0.123, 0.034], [0.010, 0.151, 0.024]].forEach(function (p) {
          ball(g, M.orange, p[0], p[1], p[2], 0.0038, 0.0045, 0.0038, 8);
        });
      }
      return g;
    }

    function gableRoof(parent, mat, x, y, z, w, h, depth) {
      var geo = geometry(['gable-roof', w, h, depth].join('/'), function () {
        var s = new T.Shape();
        s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
        var g = new T.ExtrudeGeometry(s, {
          depth: depth, bevelEnabled: true, bevelThickness: 0.001,
          bevelSize: 0.001, bevelSegments: 1, curveSegments: 1
        });
        g.translate(0, 0, -depth / 2);
        return g;
      });
      return add(parent, geo, mat, x, y, z);
    }

    function gear(parent, x, y, z, radius) {
      var g = geometry('gear/' + radius, function () {
        var s = new T.Shape();
        for (var i = 0; i < 40; i++) {
          var a = i * Math.PI * 2 / 40;
          var r = radius * (i % 4 === 0 || i % 4 === 3 ? 1 : 0.80);
          if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        s.closePath();
        var hole = new T.Path();
        hole.absarc(0, 0, radius * 0.30, 0, Math.PI * 2, true);
        s.holes.push(hole);
        return new T.ExtrudeGeometry(s, {
          depth: 0.004, bevelEnabled: true, bevelSize: 0.0005,
          bevelThickness: 0.0005, bevelSegments: 1, curveSegments: 10
        });
      });
      return add(parent, g, M.gold, x, y, z);
    }

    function workshop() {
      var g = group('automation-workshop');
      softBox(g, M.limestone, -0.018, 0.008, 0, 0.166, 0.016, 0.115, 0.004);
      softBox(g, M.cream, -0.028, 0.063, -0.005, 0.115, 0.100, 0.083, 0.004);
      [0.030, 0.068].forEach(function (y) {
        box(g, M.woodLight, -0.028, y, 0.039, 0.119, 0.005, 0.004);
      });
      [-0.080, 0.024].forEach(function (x) {
        softBox(g, M.wood, x, 0.063, 0.039, 0.007, 0.100, 0.007, 0.001);
      });
      gableRoof(g, M.teal, -0.028, 0.114, -0.005, 0.135, 0.047, 0.105);
      // Raised roof battens continue the castle's seam language.
      for (var b = 0; b < 6; b++) {
        var z = -0.048 + b * 0.018;
        rod(g, M.steel, [-0.093, 0.116, z], [-0.028, 0.162, z], 0.0011, 4);
        rod(g, M.steel, [-0.028, 0.162, z], [0.037, 0.116, z], 0.0011, 4);
      }
      arch(g, M.recess, -0.027, 0.017, 0.040, 0.045, 0.066, 0.002);
      archFrame(g, M.woodLight, -0.027, 0.016, 0.041, 0.050, 0.070, 0.005, 0.005);
      box(g, M.wood, -0.027, 0.043, 0.043, 0.033, 0.047, 0.002);
      windowAt(g, -0.071, 0.069, 0.039, 0.018, 0.028, M.trim, M.glass);
      gear(g, -0.027, 0.102, 0.045, 0.019);
      // Waterwheel is a real assembly: two rims, axle, spokes and twelve paddles.
      var wheel = group('workshop-waterwheel');
      wheel.position.set(0.063, 0.060, -0.008);
      wheel.rotation.y = Math.PI / 2;
      [-1, 1].forEach(function (side) {
        ring(wheel, M.wood, 0, 0, side * 0.012, 0.044, 0.003, 4, 28);
        for (var spoke = 0; spoke < 6; spoke++) {
          var a = spoke * Math.PI / 3;
          rod(wheel, M.woodLight, [0, 0, side * 0.012], [Math.cos(a) * 0.042, Math.sin(a) * 0.042, side * 0.012], 0.002, 4);
        }
      });
      for (var p = 0; p < 12; p++) {
        var a = p * Math.PI / 6;
        var paddle = box(wheel, M.wood, Math.cos(a) * 0.043, Math.sin(a) * 0.043, 0, 0.017, 0.005, 0.031);
        paddle.rotation.z = a + Math.PI / 2;
      }
      var axle = cylinder(wheel, M.steel, 0, 0, 0, 0.006, 0.006, 0.041, 12);
      axle.rotation.x = Math.PI / 2;
      g.add(wheel);
      // Delivery conveyor and three distinct parcels communicate automation.
      softBox(g, M.steel, -0.009, 0.024, 0.095, 0.118, 0.014, 0.033, 0.003);
      for (var r = 0; r < 9; r++) {
        var roller = cylinder(g, M.ash, -0.059 + r * 0.012, 0.034, 0.095, 0.003, 0.003, 0.031, 8);
        roller.rotation.x = Math.PI / 2;
      }
      [-0.044, -0.008, 0.028].forEach(function (x) {
        softBox(g, M.orange, x, 0.049, 0.095, 0.023, 0.026, 0.024, 0.002);
        box(g, M.sail, x, 0.049, 0.108, 0.003, 0.026, 0.001);
      });
      softBox(g, M.wood, -0.064, 0.149, -0.032, 0.023, 0.059, 0.022, 0.002);
      softBox(g, M.trim, -0.064, 0.180, -0.032, 0.029, 0.009, 0.028, 0.002);
      return g;
    }

    function harbor() {
      var g = group('data-harbor');
      // Jetty beams, individually separated deck boards, and capped piles.
      [-0.076, 0.076].forEach(function (x) {
        box(g, M.brown, x, 0.020, 0.020, 0.012, 0.016, 0.140);
      });
      for (var i = 0; i < 13; i++) {
        softBox(g, i % 3 ? M.wood : M.woodLight, -0.094 + i * 0.0157,
          0.032, 0.026, 0.0145, 0.008, 0.146, 0.001);
      }
      [-1, 1].forEach(function (sx) {
        [-1, 1].forEach(function (sz) {
          cylinder(g, M.wood, sx * 0.090, 0.024, 0.026 + sz * 0.062, 0.006, 0.007, 0.048, 10);
          cylinder(g, M.woodLight, sx * 0.090, 0.049, 0.026 + sz * 0.062, 0.008, 0.008, 0.004, 10);
        });
      });
      softBox(g, M.cream, -0.043, 0.077, -0.014, 0.095, 0.082, 0.083, 0.003);
      gableRoof(g, M.blue, -0.043, 0.120, -0.014, 0.112, 0.033, 0.099);
      [-0.082, -0.005].forEach(function (x) {
        box(g, M.teal, x, 0.076, 0.029, 0.006, 0.080, 0.005);
      });
      windowAt(g, -0.043, 0.082, 0.029, 0.036, 0.029, M.pale, M.glassLight);
      softBox(g, M.teal, -0.043, 0.057, 0.031, 0.055, 0.030, 0.006, 0.002);
      for (var packet = 0; packet < 3; packet++) {
        softBox(g, M.gold, -0.059 + packet * 0.016, 0.058, 0.036, 0.008, 0.008, 0.002, 0.001);
      }
      // A crane links the warehouse, parcels, and pipe manifold visually.
      softBox(g, M.steel, 0.063, 0.092, -0.008, 0.015, 0.118, 0.016, 0.002);
      softBox(g, M.teal, 0.063, 0.153, 0.025, 0.018, 0.013, 0.089, 0.002);
      rod(g, M.steel, [0.063, 0.059, -0.008], [0.063, 0.148, 0.064], 0.003, 6);
      rod(g, M.brown, [0.063, 0.151, 0.063], [0.063, 0.070, 0.063], 0.0012, 5);
      var hook = ring(g, M.gold, 0.063, 0.069, 0.063, 0.005, 0.0013, 4, 12);
      softBox(g, M.orange, 0.063, 0.052, 0.063, 0.026, 0.024, 0.025, 0.002);
      // Curved pipes and coupling collars evoke connections, not a plain block.
      for (var p = 0; p < 3; p++) {
        var x = 0.006 + p * 0.018;
        var pipeGeo = geometry('harbor-pipe/' + p, function () {
          var curve = new T.CatmullRomCurve3([
            new T.Vector3(0, 0, 0), new T.Vector3(0, 0.024, 0),
            new T.Vector3(0, 0.036, -0.012), new T.Vector3(0, 0.036, -0.037)
          ]);
          return new T.TubeGeometry(curve, 10, 0.004, 8, false);
        });
        add(g, pipeGeo, p % 2 ? M.pipeLip : M.teal, x, 0.036, -0.032);
        cylinder(g, M.gold, x, 0.039, -0.032, 0.0055, 0.0055, 0.004, 12);
      }
      return g;
    }

    function palm() {
      var g = group('palm');
      var trunk = geometry('palm-trunk', function () {
        var c = new T.CatmullRomCurve3([
          new T.Vector3(0, 0.008, 0), new T.Vector3(0.005, 0.070, 0), new T.Vector3(0.025, 0.145, 0)
        ]);
        return new T.TubeGeometry(c, 12, 0.007, 8, false);
      });
      add(g, trunk, M.wood);
      var leafGeo = geometry('palm-frond', function () {
        var positions = [], indices = [], uvs = [];
        for (var j = 0; j <= 10; j++) {
          var t = j / 10, w = Math.sin(t * Math.PI) * 0.015;
          positions.push(t * 0.083, -0.042 * t * t, -w, t * 0.083, -0.042 * t * t, w);
          uvs.push(t, 0, t, 1);
          if (j < 10) {
            var k = j * 2;
            indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
          }
        }
        var geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
        geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices); geo.computeVertexNormals();
        return geo;
      });
      for (var i = 0; i < 7; i++) {
        var leaf = add(g, leafGeo, material(i % 2 ? 0x42a961 : 0x89c75e, { side: T.DoubleSide }), 0.025, 0.15, 0);
        leaf.rotation.y = i * Math.PI * 2 / 7;
      }
      [-1, 0, 1].forEach(function (s) {
        ball(g, M.brown, 0.025 + s * 0.009, 0.139, 0.009, 0.007, 0.008, 0.007, 8);
      });
      return g;
    }

    function pyramid() {
      var g = group('desert-pyramid');
      var geo = geometry('pyramid', function () {
        var p = new T.CylinderGeometry(0, 0.135, 0.15, 4);
        p.rotateY(Math.PI / 4); return p;
      });
      add(g, geo, M.sand, 0, 0.075, 0);
      softBox(g, M.trim, 0, 0.005, 0, 0.200, 0.010, 0.200, 0.002);
      arch(g, M.brown, 0, 0.010, 0.091, 0.025, 0.037, 0.002);
      for (var i = 1; i < 5; i++) {
        box(g, M.limestone, 0, i * 0.026, 0.102 - i * 0.017, 0.190 - i * 0.032, 0.0013, 0.0013);
      }
      return g;
    }

    function question() {
      var g = group('question-block');
      softBox(g, M.gold, 0, 0.034, 0, 0.064, 0.064, 0.058, 0.005);
      [-1, 1].forEach(function (side) {
        var face = group('question-face');
        face.position.set(0, 0.034, side * 0.0305);
        if (side < 0) face.rotation.y = Math.PI;
        var mark = geometry('question-mark', function () {
          var c = new T.CatmullRomCurve3([
            new T.Vector3(-0.011, 0.011, 0), new T.Vector3(-0.005, 0.019, 0),
            new T.Vector3(0.009, 0.017, 0), new T.Vector3(0.010, 0.007, 0),
            new T.Vector3(0, 0, 0), new T.Vector3(0, -0.006, 0)
          ]);
          return new T.TubeGeometry(c, 14, 0.0032, 6, false);
        });
        add(face, mark, M.white);
        ball(face, M.white, 0, -0.016, 0, 0.0037, 0.0037, 0.002, 8);
        [-1, 1].forEach(function (x) {
          [-1, 1].forEach(function (y) { ball(face, M.trim, x * 0.025, y * 0.025, 0, 0.002, 0.002, 0.001, 8); });
        });
        g.add(face);
      });
      return g;
    }

    function coin() {
      var g = group('gold-coin');
      var disk = cylinder(g, M.gold, 0, 0.031, 0, 0.030, 0.030, 0.008, 28);
      disk.rotation.x = Math.PI / 2;
      [-1, 1].forEach(function (side) {
        ring(g, M.trim, 0, 0.031, side * 0.0045, 0.025, 0.002, 5, 28);
        softBox(g, M.trim, 0, 0.031, side * 0.005, 0.005, 0.028, 0.002, 0.0006);
      });
      return g;
    }

    function cloud() {
      var g = group('puff-cloud');
      ball(g, M.cloud, 0, 0.027, 0, 0.075, 0.027, 0.035, 16);
      ball(g, M.cloud, -0.037, 0.040, 0, 0.032, 0.033, 0.032, 16);
      ball(g, M.cloud, 0.005, 0.053, 0, 0.035, 0.043, 0.034, 16);
      ball(g, M.cloud, 0.043, 0.039, 0, 0.031, 0.030, 0.030, 16);
      return g;
    }

    function boat() {
      var g = group('sailboat');
      var hullGeo = geometry('hull', function () {
        var h = new T.Shape();
        h.moveTo(-0.065, 0.018); h.quadraticCurveTo(0, -0.022, 0.065, 0.018);
        h.lineTo(0.052, 0.027); h.lineTo(-0.052, 0.027); h.closePath();
        return new T.ExtrudeGeometry(h, {
          depth: 0.038, bevelEnabled: true, bevelThickness: 0.003,
          bevelSize: 0.003, bevelSegments: 2, curveSegments: 10
        });
      });
      add(g, hullGeo, M.wood, 0, 0.008, -0.019);
      softBox(g, M.trim, 0, 0.033, 0, 0.100, 0.004, 0.034, 0.001);
      cylinder(g, M.wood, 0, 0.092, 0, 0.002, 0.002, 0.121, 8);
      var sailGeo = geometry('sail', function () {
        var s = new T.Shape();
        s.moveTo(0.004, 0.044); s.lineTo(0.004, 0.145);
        s.quadraticCurveTo(0.033, 0.092, 0.052, 0.044); s.closePath();
        return new T.ExtrudeGeometry(s, { depth: 0.001, bevelEnabled: false, curveSegments: 10 });
      });
      add(g, sailGeo, M.sail);
      var smallGeo = geometry('small-sail', function () {
        var s = new T.Shape();
        s.moveTo(-0.005, 0.050); s.lineTo(-0.005, 0.125); s.lineTo(-0.041, 0.050); s.closePath();
        return new T.ExtrudeGeometry(s, { depth: 0.001, bevelEnabled: false });
      });
      add(g, smallGeo, M.red);
      return g;
    }

    // Authored dimensions remain explicit while all resources stay shared. Root
    // transforms are clean for the spherical scene's placement and batching.
    function authored(builder, width, height) {
      return function (variant) {
        var model = builder(variant);
        var bounds = new T.Box3().setFromObject(model);
        var size = bounds.getSize(new T.Vector3());
        model.scale.set(width / size.x, height / size.y, width / size.x);
        model.position.y = -bounds.min.y * model.scale.y;
        var result = group(model.name);
        result.add(model);
        result.updateMatrixWorld(true);
        var actual = new T.Box3().setFromObject(result).getSize(new T.Vector3());
        result.userData.dimensions = { width: actual.x, height: actual.y, depth: actual.z };
        result.userData.authorship = 'self-authored procedural geometry';
        return result;
      };
    }

    return {
      castle: authored(castle, 0.42, 0.52),
      mushroomHouse: authored(mushroomHouse, 0.13, 0.16),
      pipe: authored(pipe, 0.08, 0.13),
      tree: authored(tree, 0.10, 0.18),
      palm: authored(palm, 0.17, 0.18),
      pyramid: authored(pyramid, 0.20, 0.15),
      question: authored(question, 0.068, 0.068),
      coin: authored(coin, 0.06, 0.06),
      cloud: authored(cloud, 0.15, 0.096),
      boat: authored(boat, 0.14, 0.15),
      workshop: authored(workshop, 0.20, 0.19),
      harbor: authored(harbor, 0.24, 0.16)
    };
  }
})(window);
