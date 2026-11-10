/*
 * One self-authored continuous mainland. The map uses x/z world coordinates,
 * a common sampled height field, and roads whose bridges cross the same river.
 * It is deliberately independent of the spherical overview and camera controls.
 */
(function (root) {
  'use strict';
  root.MarioConnectedMap = { build: build };

  function geography(){if(!root.MarioWorldGeography)throw new Error('Shared world-geography.js must load before connected-map.js');return root.MarioWorldGeography;}
  function smooth(a,b,x){return geography().smooth(a,b,x);}
  function riverX(z){return geography().riverX(z);}
  function riverDistance(x,z){return geography().riverDistance(x,z);}
  function coastField(x,z){return geography().coastField(x,z);}
  function heightAt(x,z){return geography().heightAt(x,z);}
  function runtimeMap(data,time){data.tick=function(t){time.value=t;};return data;}

  // ---------------------------------------------------------------------------
  // Ground and road micro-surface shading.
  //
  // The mainland is a single merged continent batch plus one merged road batch,
  // so any extra polygon would be a real budget cost. Instead the existing
  // standard/lambert programs receive a few procedural fragment terms through
  // onBeforeCompile: world-space value noise in three scales (mossy mottling,
  // dry earth, soil grain), slope-driven rock/gravel desaturation and a wet sand
  // band measured against sea level. Amplitude stays inside +-10% brightness and
  // each term is weighted by the baked biome vertex colour, so no region table is
  // needed and snow, sand, forest, meadow and red rock keep their hue.
  //
  // High frequencies fade out with view depth: an overhead view returns to the
  // untouched palette, which is also the moire/shimmer defence. Every new
  // identifier carries the grd/uGrd/vGrd prefix so assets/map-weather.js can
  // stack its uSurfaceSnow/uSurfaceWet/vWeatherPosition injection on top.
  //
  // Cost: zero triangles, zero draw calls, zero textures, zero render targets and
  // zero extra material instances - only the fragment colour is modulated.
  // ---------------------------------------------------------------------------
  var GRD_CACHE_KEY = 'grd-surface-v1';
  var GRD_NOISE = [
    'float grdHash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}',
    'float grdValue(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);',
    'float a=grdHash21(i),b=grdHash21(i+vec2(1.0,0.0)),c=grdHash21(i+vec2(0.0,1.0)),d=grdHash21(i+vec2(1.0,1.0));',
    'return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}',
    'float grdHash22(vec2 p){return fract(sin(dot(p,vec2(269.5,183.3)))*43758.5453123);}',
    'float grdValueB(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);',
    'float a=grdHash22(i),b=grdHash22(i+vec2(1.0,0.0)),c=grdHash22(i+vec2(0.0,1.0)),d=grdHash22(i+vec2(1.0,1.0));',
    'return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}'
  ].join('\n');
  // Terrain recipe. Everything stays a modulation of diffuseColor, which already
  // carries the biome palette, so lighting, shadows, fog and vertex colours are
  // untouched. The world Y offset inside the noise coordinates breaks up contour
  // banding on steep slopes without introducing an expensive triplanar sample.
  var GRD_TERRAIN = [
    '#include <color_fragment>',
    '{',
    'vec3 grdN=normalize(vGrdNormal);',
    'vec2 grdP=vGrdWorld.xz;',
    'float grdDist=max(0.0,vGrdDepth);',
    'float grdFadeNear=1.0-smoothstep(55.0,115.0,grdDist);',
    'float grdFadeMid=1.0-smoothstep(95.0,190.0,grdDist);',
    'float grdFadeFar=1.0-smoothstep(150.0,240.0,grdDist);',
    'float grdFadeMicro=(1.0-smoothstep(4.0,16.0,grdDist))*grdFadeNear;',
    'float grdMottle=grdValue(grdP*0.115+vec2(vGrdWorld.y*0.060,-vGrdWorld.y*0.045));',
    'float grdPatch=grdValue(grdP*0.42+vec2(vGrdWorld.y*0.31,-vGrdWorld.y*0.27)+vec2(13.7,7.1));',
    'float grdGrain=grdValueB(grdP*3.1+vec2(vGrdWorld.y*1.7,vGrdWorld.y*0.9)+vec2(4.3,17.9));',
    'float grdMicro=grdValueB(grdP*7.3+vec2(21.7,9.1));',
    'float grdLuma=dot(diffuseColor.rgb,vec3(0.299,0.587,0.114));',
    'float grdGreen=smoothstep(0.012,0.075,diffuseColor.g-diffuseColor.r);',
    'float grdWarm=smoothstep(0.030,0.160,diffuseColor.r-diffuseColor.b)*(1.0-grdGreen);',
    'float grdPale=smoothstep(-0.015,0.045,diffuseColor.b-diffuseColor.r)*smoothstep(0.70,0.90,grdLuma);',
    'float grdUnder=1.0-smoothstep(uGrdSea-0.35,uGrdSea+0.02,vGrdWorld.y);',
    'float grdAmp=uGrdAmp*(1.0-0.62*grdPale)*(1.0-0.72*grdUnder);',
    'float grdSlope=1.0-smoothstep(0.52,0.93,grdN.y);',
    'float grdShade=(grdMottle-0.5)*0.115*grdFadeMid+(grdPatch-0.5)*0.090*grdFadeMid;',
    'grdShade+=(grdGrain-0.5)*0.070*grdFadeNear+(grdMicro-0.5)*0.045*grdFadeMicro;',
    'diffuseColor.rgb*=1.0+clamp(grdShade*grdAmp,-0.100,0.100);',
    'float grdMoss=grdGreen*smoothstep(0.42,0.78,grdPatch)*grdFadeMid;',
    'diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.92,1.03,0.84),clamp(0.62*grdMoss*grdAmp,0.0,0.62));',
    'float grdDust=grdWarm*smoothstep(0.48,0.82,grdMottle)*grdFadeMid;',
    'diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.065,1.00,0.92),clamp(0.58*grdDust*grdAmp,0.0,0.55));',
    'float grdPebble=smoothstep(0.74,0.94,grdValueB(grdP*5.6+vec2(vGrdWorld.y*2.3,-vGrdWorld.y*1.9)+vec2(31.0,3.3)));',
    'diffuseColor.rgb+=(grdPebble-0.35)*0.038*vec3(1.00,0.98,0.94)*grdFadeNear*grdAmp*(0.35+grdSlope*1.15);',
    'vec3 grdRock=mix(diffuseColor.rgb,vec3(grdLuma),0.45)*vec3(0.97,0.96,0.94);',
    'diffuseColor.rgb=mix(diffuseColor.rgb,grdRock,clamp(grdSlope*0.62,0.0,0.24)*grdFadeFar);',
    'float grdWet=1.0-smoothstep(0.05,0.30,abs(vGrdWorld.y-uGrdSea-0.16));',
    'diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.93,0.97,1.02),clamp(grdWet*grdFadeFar*0.55,0.0,0.55));',
    'float grdFleck=smoothstep(0.62,0.92,grdValue(grdP*1.45+vec2(41.0,17.0)))*grdGreen*grdFadeMid;',
    'diffuseColor.rgb*=1.0+grdFleck*0.045*grdAmp;',
    '}'
  ].join('\n');
  // Road recipe. The strip UVs are u across the width (0 left, 1 right) and
  // v = i * 0.1 along the path, so ruts are the only terms that must use u; the
  // grit uses world XZ to stay isotropic through bends and slope stretches.
  var GRD_ROAD = [
    '#include <color_fragment>',
    '{',
    'vec2 grdP=vGrdWorld.xz;',
    'float grdDist=max(0.0,vGrdDepth);',
    'float grdNear=1.0-smoothstep(48.0,105.0,grdDist);',
    'float grdU=clamp(vGrdUv.x,0.0,1.0);',
    'float grdV=max(0.0,vGrdUv.y);',
    'float grdFine=grdValue(grdP*6.4+vec2(7.3,19.1));',
    'float grdCoarse=grdValue(grdP*2.3+vec2(11.1,5.7));',
    'float grdDust=grdValue(grdP*0.9+vec2(3.1,8.4));',
    'float grdRut=(1.0-smoothstep(0.0,0.075,abs(grdU-0.32)))+(1.0-smoothstep(0.0,0.075,abs(grdU-0.68)));',
    'grdRut=clamp(grdRut,0.0,1.0);',
    'float grdEdge=1.0-smoothstep(0.02,0.13,min(grdU,1.0-grdU));',
    'float grdCross=0.5+0.5*sin((grdU-0.5)*9.0+sin(grdV*1.7)*0.9);',
    'float grdSpeck=smoothstep(0.80,0.97,grdFine);',
    'diffuseColor.rgb*=1.0-grdRut*0.090*grdNear;',
    'diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.07,0.99,0.89),clamp(grdEdge*(0.34+0.30*grdCoarse)*grdNear,0.0,0.50));',
    'diffuseColor.rgb*=1.0+(grdCross-0.5)*0.040*grdNear;',
    'diffuseColor.rgb*=1.0+(grdDust-0.5)*0.070*grdNear;',
    'diffuseColor.rgb+=(grdSpeck-0.18)*0.070*vec3(1.00,0.97,0.90)*grdNear;',
    'diffuseColor.rgb+=(grdFine-0.5)*0.028*grdNear;',
    '}'
  ].join('\n');
  // Appends the varying plumbing to whatever vertex program the material already
  // owns. Guarded so a second onBeforeCompile call cannot redeclare varyings.
  function grdPatchVertex(shader){
    if(shader.vertexShader.indexOf('vGrdWorld')>=0)return;
    shader.vertexShader='varying vec3 vGrdWorld;\nvarying vec3 vGrdNormal;\nvarying vec2 vGrdUv;\nvarying float vGrdDepth;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\nvGrdNormal=inverseTransformDirection(transformedNormal,viewMatrix);');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec4 grdLocal=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\ngrdLocal=instanceMatrix*grdLocal;\n#endif\nvGrdWorld=(modelMatrix*grdLocal).xyz;\nvGrdUv=uv;');
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvGrdDepth=max(0.0,-mvPosition.z);');
  }
  // Shared uniform objects: assigning the same references keeps the injection
  // idempotent (a repeated call cannot grow the uniform block) and lets both
  // materials read one sea level / amplitude budget.
  function grdBind(shader,uniforms){
    shader.uniforms.uGrdSea=uniforms.uGrdSea;
    shader.uniforms.uGrdAmp=uniforms.uGrdAmp;
  }
  function attachGroundDetail(mat,kind,uniforms){
    if(!mat)return mat;
    mat.userData=mat.userData||{};
    mat.userData.groundSurface=kind;
    // Exposed so a later pass (or the devtools console) can retune the amplitude
    // without touching this file. Both materials share one uniform pool.
    mat.userData.groundUniforms=uniforms;
    mat.onBeforeCompile=function(shader){
      grdBind(shader,uniforms);
      grdPatchVertex(shader);
      if(shader.fragmentShader.indexOf('vGrdWorld')>=0)return;
      shader.fragmentShader='uniform float uGrdSea;\nuniform float uGrdAmp;\nvarying vec3 vGrdWorld;\nvarying vec3 vGrdNormal;\nvarying vec2 vGrdUv;\nvarying float vGrdDepth;\n'+GRD_NOISE+'\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',kind==='road'?GRD_ROAD:GRD_TERRAIN);
    };
    mat.customProgramCacheKey=function(){return GRD_CACHE_KEY+'/'+kind;};
    return mat;
  }

  function build(T, group, options) {
    var opts = options || {}, geo=geography();
    var kit = root.MarioWorldModels.create(T);
    var UP = new T.Vector3(0, 1, 0);
    var SEA = geo.seaLevel;
    var bounds = geo.bounds;
    var seed = 0x4d415249;
    var source = new T.Group();
    var focusPoints = {}, buildingPositions = {}, modelCount = 0;
    var riverMain = [], riverBranch = [], routes = [], bridgeCount = 0;
    source.name = 'connected-world-construction';
    group.add(source);

    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    function material(color, extra) {
      return new T.MeshStandardMaterial(Object.assign({ color: color, roughness: .78 }, extra || {}));
    }
    var M = {
      earth: material(0xffffff, { vertexColors: true, map: root.MarioStoryWorld&&root.MarioStoryWorld.surfaceTexture?root.MarioStoryWorld.surfaceTexture(T):null }),
      path: material(0xe7cba1), edging: material(0xd5b88b),
      wood: material(0x9b6c43), darkWood: material(0x694d38),
      stone: material(0xb5ac97), limestone: material(0xe9d7b9),
      grass: material(0x78a956), forest: material(0x2d8752),
      snow: material(0xf4fbff), ice: material(0x8db7cf),
      lavaRock: material(0x484654), lava: material(0xff8d3f, { emissive: 0xdf4910, emissiveIntensity: .7 }),
      white: material(0xfff5df), pink: material(0xe5809b),
      greenPipe: material(0x269e63, { metalness: .15, roughness: .4 }),
      bronze: material(0xbe964f, { metalness: .3, roughness: .4 }),
      leaves: material(0x4e9b56), flowerCenter: material(0xf4ca5a),
      // Kerbs, rut bands and grit patches share one vertex-coloured batch so the
      // whole road network costs exactly one extra draw call.
      roadDetail: material(0xffffff, { vertexColors: true, side: T.DoubleSide, name: 'road-detail' })
    };
    // Only the continent and the dirt road receive the micro-surface pass. The
    // lava fissures reuse roadStrip() with M.lava rather than M.path, so leaving
    // their material untouched keeps the emissive red glow exactly as authored.
    var groundUniforms = { uGrdSea: { value: SEA }, uGrdAmp: { value: 1 } };
    attachGroundDetail(M.earth, 'terrain', groundUniforms);
    attachGroundDetail(M.path, 'road', groundUniforms);
    var petalMaterials = [material(0xf1c95c), material(0xe487a7), material(0xfbf5dd)];
    var boxGeo = new T.BoxGeometry(1, 1, 1);
    var ballGeo = new T.SphereGeometry(1, 7, 5);
    function mesh(geometry, mat, parent, x, y, z) {
      var o = new T.Mesh(geometry, mat);
      if (x !== undefined) o.position.set(x, y, z);
      (parent || source).add(o);
      return o;
    }
    function box(parent, mat, x, y, z, w, h, d) {
      var o = mesh(boxGeo, mat, parent, x, y, z);
      o.scale.set(w, h, d); return o;
    }
    function ball(parent, mat, x, y, z, w, h, d) {
      var o = mesh(ballGeo, mat, parent, x, y, z);
      o.scale.set(w, h, d); return o;
    }
    function place(obj, x, z, scale, yaw, role, y) {
      obj.position.set(x, y === undefined ? heightAt(x, z) : y, z);
      obj.scale.setScalar(scale === undefined ? 1 : scale);
      obj.rotation.y = yaw || 0;
      if (role) {
        obj.userData.nodeId = role;
        buildingPositions[role] = obj.position.clone();
        focusPoints[role] = obj.position.clone().add(new T.Vector3(0, role === 'collaboration' ? 3.1 : 1.8, 0));
      }
      source.add(obj); modelCount++;
      return obj;
    }

    // Shared indexed terrain with smooth, analytical biome weights and coastline.
    var nx = 224, nz = 192, positions = [], colors = [], uvs = [], indices = [];
    var color = new T.Color(), grass = new T.Color(0x6fa46c), forest = new T.Color(0x397953);
    var sand = new T.Color(0xe4cda5), snowColor = new T.Color(0xe6f1ee), basalt = new T.Color(0x67666d);
    var shoreColor = new T.Color(0xd8c8a7), riverBank = new T.Color(0x8f9d82), shoreTint=new T.Color(), underwater = new T.Color(0x477d89);
    var canyonTint=new T.Color(0xb47758),meadowTint=new T.Color(0x92b76b);
    for (var iz = 0; iz <= nz; iz++) {
      var z = bounds.minZ + iz / nz * (bounds.maxZ - bounds.minZ);
      for (var ix = 0; ix <= nx; ix++) {
        var x = bounds.minX + ix / nx * (bounds.maxX - bounds.minX), biome=geo.biomeAt(x,z), h=biome.height;
        positions.push(x, h, z); uvs.push(ix / nx, iz / nz);
        color.copy(grass).lerp(forest,biome.forest);
        color.lerp(sand,biome.sand).lerp(basalt,biome.rock).lerp(snowColor,biome.snow).lerp(canyonTint,biome.canyon||0).lerp(meadowTint,(biome.meadow||0)*.35);
        if(h<1.8){shoreTint.copy(shoreColor).lerp(riverBank,biome.river*.86);color.lerp(shoreTint,biome.shore*.72);}
        if(h<SEA)color.lerp(underwater,.42+.48*smooth(0,2.8,SEA-h));
        color.multiplyScalar(.97 + .035 * Math.sin(x * 1.8 + z * 2.4));
        colors.push(color.r, color.g, color.b);
      }
    }
    for (var iz = 0; iz < nz; iz++) for (var ix = 0; ix < nx; ix++) {
      var a = iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    var terrainGeo = new T.BufferGeometry();
    terrainGeo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    terrainGeo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    terrainGeo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    terrainGeo.setIndex(indices); terrainGeo.computeVertexNormals();
    mesh(terrainGeo, M.earth).name = 'continuous-mainland';

    var time = { value: 0 };
    var waterMaterial = new T.ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader: 'varying vec3 wp; void main(){wp=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: [
        'varying vec3 wp; uniform float uTime;',
        'void main(){',
        'vec3 c=mix(vec3(.018,.23,.32),vec3(.04,.48,.52),.48+.15*sin(wp.z*.065+wp.x*.03));',
        'gl_FragColor=vec4(c,1.);',
        '#include <tonemapping_fragment>', '#include <encodings_fragment>', '}'
      ].join('\n')
    });
    var water = mesh(new T.PlaneGeometry(2000, 2000), waterMaterial, group, 0, SEA, 0);
    water.rotation.x = -Math.PI / 2;
    water.name = 'connected-sea-and-river';

    var regionDefinitions=geo.regions.map(function(r){return[r.id,r.name,r.x,r.z,r.description];});
    var regions = regionDefinitions.map(function (r) {
      var pos = new T.Vector3(r[2], heightAt(r[2], r[3]), r[3]);
      focusPoints[r[0]] = pos.clone().add(new T.Vector3(0, 2, 0));
      return { id: r[0], name: r[1], position: pos, description: r[4] };
    });

    // The business architecture sits at the exact semantic entrance coordinates.
    place(kit.castle(false), 0, -14, 16, 0, 'collaboration');
    place(kit.workshop(), -26, 12, 22, -.12, 'automation');
    place(kit.harbor(), 18, 26, 24, 0, 'connection');
    [[-7,-10,10],[7,-10,10],[-6,-3,9],[6,-3,9],[-10,-17,8],[10,-17,8]].forEach(function (p, i) {
      place(kit.mushroomHouse(), p[0], p[1], p[2], i % 2 ? -.12 : .12);
    });
    [[-11,-7,9],[11,-7,9],[-30,16,10],[22,25,9],[-24,7,9]].forEach(function (p) { place(kit.pipe(), p[0], p[1], p[2]); });
    place(kit.pyramid(), -49, 22, 23, .16);
    place(kit.pyramid(), -42, 28, 12, -.2);
    place(kit.castle(true), 36, -25, 15, -.25);

    // Route geometry follows the shared terrain, then becomes a wooden crossing
    // above the channel. The stored path is the same visible path used to render.
    var routeDefinitions=geo.routeDefinitions;
    /* Roadside detail: kerb stones with an outer face, two sunken rut bands and
       scattered grit patches. Everything is authored in world space and pushed into
       one vertex-coloured batch, so the visual gain costs a single extra draw call
       rather than one per route. The sampling stride is deliberately coarse (every
       other curve point) because the top surface is already dense; what was missing
       was cross-section, not resolution. */
    var roadDetailPos = [], roadDetailColor = [], roadDetailIndex = [];
    var KERB_TOP = [0.80, 0.74, 0.63], KERB_FACE = [0.60, 0.55, 0.48];
    var RUT_COLOR = [0.55, 0.45, 0.33], GRIT_COLOR = [0.70, 0.66, 0.58];
    function detailVertex(x, y, z, color) {
      roadDetailPos.push(x, y, z);
      roadDetailColor.push(color[0], color[1], color[2]);
      return roadDetailPos.length / 3 - 1;
    }
    function detailQuad(a, b, c, d, color) {
      var i0 = detailVertex(a[0], a[1], a[2], color), i1 = detailVertex(b[0], b[1], b[2], color);
      var i2 = detailVertex(c[0], c[1], c[2], color), i3 = detailVertex(d[0], d[1], d[2], color);
      roadDetailIndex.push(i0, i1, i2, i0, i2, i3);
    }
    function roadDetail(points, width, stride) {
      var step = Math.max(1, stride || 2), kerbW = 0.20, kerbH = 0.055, rutW = 0.30;
      for (var i = 0; i + step < points.length; i += step) {
        var p = points[i], q = points[i + step];
        var delta = q.clone().sub(p); delta.y = 0;
        if (delta.lengthSq() < 1e-6) continue;
        var side = new T.Vector3().crossVectors(UP, delta).normalize().multiplyScalar(.5);
        var half = width / 2;
        for (var sign = -1; sign <= 1; sign += 2) {
          var ox = side.x * half * sign, oz = side.z * half * sign;
          var nx = side.x * kerbW * sign, nz = side.z * kerbW * sign;
          var down = kerbH + .16;
          // Kerb top: a narrow strip just outside the carriageway.
          detailQuad(
            [p.x + ox, p.y + kerbH, p.z + oz], [q.x + ox, q.y + kerbH, q.z + oz],
            [q.x + ox + nx, q.y + kerbH, q.z + oz + nz], [p.x + ox + nx, p.y + kerbH, p.z + oz + nz],
            KERB_TOP);
          // Outer face gives the road a real edge instead of a paper-thin cut.
          detailQuad(
            [p.x + ox + nx, p.y + kerbH, p.z + oz + nz], [q.x + ox + nx, q.y + kerbH, q.z + oz + nz],
            [q.x + ox + nx, q.y + kerbH - down, q.z + oz + nz], [p.x + ox + nx, p.y + kerbH - down, p.z + oz + nz],
            KERB_FACE);
        }
        // Two shallow rut bands, a centimetre and a half below the surface.
        for (var rs = -1; rs <= 1; rs += 2) {
          var bx = side.x * (width * .22) * rs, bz = side.z * (width * .22) * rs;
          var rx = side.x * rutW * .5, rz = side.z * rutW * .5;
          detailQuad(
            [p.x + bx - rx, p.y - .015, p.z + bz - rz], [q.x + bx - rx, q.y - .015, q.z + bz - rz],
            [q.x + bx + rx, q.y - .015, q.z + bz + rz], [p.x + bx + rx, p.y - .015, p.z + bz + rz],
            RUT_COLOR);
        }
        // Every few strides a little grit patch on the shoulder. The jitter is a hash
        // of the point index and world position, never the shared random stream: the
        // road must not shift the placement of every tree and flower that follows it.
        if ((i / step) % 5 === 2) {
          var hash = function (seed) { var v = Math.sin(seed * 12.9898 + p.x * 78.233 + p.z * 37.719) * 43758.5453; return v - Math.floor(v); };
          var gs = -1 + hash(1) * 2, gx = side.x * (half + .16) * gs, gz = side.z * (half + .16) * gs;
          var gr = .18 + hash(2) * .16, gp = .16 + hash(3) * .18;
          detailQuad(
            [p.x + gx - gr, p.y + .02, p.z + gz - gr], [p.x + gx + gr, p.y + .02, p.z + gz - gr],
            [p.x + gx + gr, p.y + .02, p.z + gz + gp], [p.x + gx - gr, p.y + .02, p.z + gz + gp],
            GRIT_COLOR);
        }
      }
    }
    function roadDetailMesh() {
      if (!roadDetailIndex.length) return;
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(roadDetailPos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(roadDetailColor, 3));
      g.setIndex(roadDetailIndex);
      g.computeVertexNormals();
      mesh(g, M.roadDetail).name = 'route-detail';
    }

    function roadStrip(points, width, mat) {
      var pp = [], uv = [];
      for (var i = 0; i < points.length - 1; i++) {
        var p = points[i], q = points[i + 1], delta = q.clone().sub(p); delta.y = 0;
        var side = new T.Vector3().crossVectors(UP, delta).normalize().multiplyScalar(width / 2);
        var a = p.clone().add(side), b = p.clone().sub(side), c = q.clone().add(side), d = q.clone().sub(side);
        [a,b,c,b,d,c].forEach(function (v,j) { pp.push(v.x,v.y,v.z); uv.push(j===0||j===2||j===5?0:1,i*.1); });
      }
      var g = new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(pp,3));
      g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();
      return mesh(g,mat);
    }
    M.path.side = T.DoubleSide;
    function addBridge(points, start, end, height) {
      bridgeCount++;
      var samples = [];
      for (var j = start; j <= end; j++) samples.push(points[j]);
      var curve = new T.CatmullRomCurve3(samples), length = curve.getLength();
      var planks = Math.max(8, Math.ceil(length / .36));
      for (var k = 0; k <= planks; k++) {
        var t = k / planks, p = curve.getPoint(t), tangent = curve.getTangent(t); tangent.y = 0;tangent.normalize();
        var plank = mesh(new T.BoxGeometry(1.95,.15,length/planks*.94),M.wood);
        plank.position.copy(p).add(new T.Vector3(0,.035,0));
        plank.rotation.y = Math.atan2(tangent.x,tangent.z);
        if (k % 5 === 0) {
          [-1,1].forEach(function (sign) {
            var side = new T.Vector3().crossVectors(UP,tangent).multiplyScalar(sign*.98);
            var post = mesh(new T.CylinderGeometry(.055,.065,1.18,6),M.darkWood);
            post.position.copy(p).add(side).add(new T.Vector3(0,.5,0));
          });
        }
      }
      [-1,1].forEach(function (sign) {
        var rail = samples.map(function (p,i) {
          var prev=samples[Math.max(0,i-1)],next=samples[Math.min(samples.length-1,i+1)];
          var tangent=next.clone().sub(prev);tangent.y=0;tangent.normalize();
          return p.clone().add(new T.Vector3().crossVectors(UP,tangent).multiplyScalar(sign*.98)).add(new T.Vector3(0,.95,0));
        });
        mesh(new T.TubeGeometry(new T.CatmullRomCurve3(rail),Math.max(12,samples.length),.035,5),M.darkWood);
      });
    }
    routeDefinitions.forEach(function (def) {
      var curve = new T.CatmullRomCurve3(def.controls.map(function (p) { return new T.Vector3(p[0],0,p[1]); }));
      var points = curve.getPoints(Math.max(100,Math.ceil(curve.getLength()*5)));
      points.forEach(function (p) { p.y = heightAt(p.x,p.z)+.075; });
      var spans = [], active = -1;
      for (var i=0;i<points.length;i++) {
        var over=riverDistance(points[i].x,points[i].z)<4.05;
        if(over && active<0)active=Math.max(0,i-1);
        if(active>=0 && (!over||i===points.length-1)){spans.push([active,Math.min(points.length-1,i+1)]);active=-1;}
      }
      spans.forEach(function (span) {
        var a=span[0],b=span[1],startY=points[a].y,endY=points[b].y,deck=Math.max(startY,endY)+.22;
        for(var i=a;i<=b;i++){var t=(i-a)/Math.max(1,b-a);points[i].y=startY+(endY-startY)*t+Math.sin(t*Math.PI)*.22;}
        addBridge(points,a,b,deck);
      });
      roadStrip(points,1.72,M.path).name='route-'+def.from+'-'+def.to;
      roadDetail(points,1.72,2);
      // Narrow edge lanes visually connect the whole route even on steep hills.
      routes.push({from:def.from,to:def.to,width:1.72,points:points.map(function(p){return p.clone();}),bridges:spans.length});
    });
    // A broad approach joins the castle steps to the exploration road.
    var plaza=[];for(var i=0;i<=20;i++){var z=-10.5+i*.4;plaza.push(new T.Vector3(0,heightAt(0,z)+.09,z));}
    roadStrip(plaza,1.85,M.path);
    roadDetail(plaza,1.85,2);
    roadDetailMesh();

    function treeAt(x,z,snowy,scale) {
      if(coastField(x,z)<.15 || riverDistance(x,z)<4.2)return;
      if(routes.some(function(r){return r.points.some(function(p){return Math.hypot(x-p.x,z-p.z)<2.2;});}))return;
      if(Math.hypot(x,z+14)<6 || Math.hypot(x+26,z-12)<3 || Math.hypot(x-18,z-26)<3.5)return;
      place(kit.tree(snowy),x,z,scale || 11,random()*Math.PI*2);
    }
    // Authored belts and groves leave the important roads and entrances readable.
    for(var i=0;i<16;i++) {
      var a=i/16*Math.PI*2;
      treeAt(Math.cos(a)*14,-13+Math.sin(a)*12,false,8+random()*3);
    }
    [[-20,7],[-32,8],[-31,18],[-22,18],[-37,2],[-39,-10],[-23,-10],[-18,-26],[13,-21],[16,-10],[26,20],[23,32],[12,32],[30,-7],[36,2],[43,9],[6,37],[-21,34],[-33,32]].forEach(function(p){treeAt(p[0],p[1],false,10+random()*3);});
    // Small authored groves frame the primary route; their centers leave the
    // plazas, river banks and actual sampled road surfaces unobstructed.
    [[-13,-19],[13,-18],[-14,-2],[14,-2],[-34,6],[-22,22],[26,20],[12,35],[-38,-4],[25,5]].forEach(function(c,ci){
      for(var j=0;j<7;j++){var a=j*2.399,r=1.6+Math.sqrt(j)*1.15;treeAt(c[0]+Math.cos(a)*r,c[1]+Math.sin(a)*r,false,7+random()*3);}
    });
    for(var i=0;i<12;i++)treeAt(-43+random()*24,-40+random()*22,true,10+random()*3);
    [[-57,19],[-51,31],[-40,24],[-46,10],[-37,29],[-55,8],[22,30],[16,32]].forEach(function(p){if(riverDistance(p[0],p[1])>3.5)place(kit.palm(),p[0],p[1],10+random()*3);});

    function flower(x,z,style) {
      if(riverDistance(x,z)<4)return;
      var g=new T.Group();
      mesh(new T.CylinderGeometry(.018,.018,.19,4),M.leaves,g,0,.095,0);
      for(var p=0;p<5;p++){var a=p/5*Math.PI*2;ball(g,petalMaterials[style%3],Math.cos(a)*.06,.21,Math.sin(a)*.06,.065,.026,.065);}
      ball(g,M.flowerCenter,0,.23,0,.038,.02,.038);place(g,x,z,1);
    }
    [[-4,-6],[4,-6],[-8,-9],[8,-9],[-4,-19],[4,-19]].forEach(function(b,bi){for(var f=0;f<7;f++){var a=f*2.4,r=.25+Math.sqrt(f/7)*.62;flower(b[0]+Math.cos(a)*r,b[1]+Math.sin(a)*r,bi+f);}});
    function fence(x,z,count,step,angle) {
      var g=new T.Group();
      for(var i=0;i<count;i++){
        box(g,M.white,i*step,.43,0,.08,.86,.08);
        if(i<count-1){box(g,M.white,i*step+step/2,.36,0,step,.075,.06);box(g,M.white,i*step+step/2,.68,0,step,.075,.06);}
      }
      place(g,x,z,1,angle);
    }
    fence(-11,-1,6,1,0);fence(6,-1,6,1,0);
    [-4.3,4.3].forEach(function(x){var g=new T.Group();box(g,M.wood,0,.4,0,1.3,.13,.48);box(g,M.wood,0,.73,-.25,1.3,.55,.12);[-.45,.45].forEach(function(dx){box(g,M.darkWood,dx,.18,0,.11,.36,.35);});place(g,x,-7,1,x>0?-.2:.2);});
    for(var i=0;i<8;i++)place(kit.coin(),-2.8+i*.8,-4,3.3,0,undefined);

    // Visible pipe network and loading parcels refine the business route first.
    var pipePath=[new T.Vector3(-26,0,15),new T.Vector3(-20,0,18),new T.Vector3(-13,0,20)];
    pipePath.forEach(function(p){p.y=heightAt(p.x,p.z)+.35;});
    mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pipePath),32,.14,8),M.greenPipe);
    for(var i=0;i<6;i++){var x=-29+(i%3)*.9,z=15+Math.floor(i/3)*.85;box(source,M.wood,x,heightAt(x,z)+.34,z,.64,.68,.64);}
    // The harbor's jetty meets the branch, with a small moored boat in the channel.
    var dockZ=29.4,dockY=heightAt(18,26)+.04;
    for(var i=0;i<14;i++){var z=27+i*.27;box(source,M.wood,18,dockY,z,2.2,.13,.25);if(i%4===0)[-1,1].forEach(function(s){box(source,M.darkWood,18+s*.96,dockY-.5,z,.13,1.2,.13);});}
    place(kit.boat(),20.9,32,11,-.32,undefined,SEA+.02);

    // Geological landmarks continue out of the sampled relief instead of floating.
    function peak(x,z,width,height) {
      var g=new T.Group();mesh(new T.ConeGeometry(width,height,9),M.ice,g,0,height/2,0);
      mesh(new T.ConeGeometry(width*.43,height*.43,9),M.snow,g,0,height*.795,0);place(g,x,z,1);
    }
    peak(-37,-37,4.3,8.8);peak(-29,-37,3.0,6.5);peak(-42,-29,3.1,5.8);
    for(var i=0;i<5;i++){var a=i*2.1,x=38+Math.cos(a)*7,z=-31+Math.sin(a)*6,h=4+random()*4;var g=new T.Group();mesh(new T.ConeGeometry(2.2,h,7),M.lavaRock,g,0,h/2,0);place(g,x,z,1);}
    M.lava.side=T.DoubleSide;
    for(var l=0;l<3;l++){var fissure=[];for(var j=0;j<24;j++){var x=35+l*3+Math.sin(j*.45)*.6,z=-35+j*.6;fissure.push(new T.Vector3(x,heightAt(x,z)+.12,z));}roadStrip(fissure,.24,M.lava);}

    // Low stone direction markers line the refined route and junctions.
    [[-8,-5],[-20,3],[-17,19],[2,22],[14,25],[-35,16],[-17,-22],[20,-17]].forEach(function(p,i){
      var g=new T.Group();box(g,M.limestone,0,.58,0,.35,1.16,.35);box(g,i%2?M.pink:M.greenPipe,0,1.18,0,.66,.18,.16);place(g,p[0],p[1],1);
    });

    // Static compilation preserves a role only for the three actual business
    // buildings. Roads/terrain/markers cannot accidentally open a capability.
    source.updateMatrixWorld(true);
    var bins=new Map();
    source.traverse(function(o){
      if(!o.isMesh || !o.geometry || Array.isArray(o.material))return;
      var role='',p=o;
      while(p && p!==source){if(p.userData.nodeId){role=p.userData.nodeId;break;}p=p.parent;}
      if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();var partRadius=o.geometry.boundingSphere.radius*o.matrixWorld.getMaxScaleOnAxis(),tiny=!role&&partRadius<.12;
      var key=o.material.uuid+'/'+role+'/'+(tiny?'tiny':'main'),bin=bins.get(key);
      if(!bin){bin={material:o.material,role:role,p:[],n:[],uv:[],c:[],indices:[],tiny:tiny,maxRadius:0,colored:!!o.geometry.attributes.color};bins.set(key,bin);}
      bin.maxRadius=Math.max(bin.maxRadius,partRadius);
      var g=o.geometry,offset=bin.p.length/3;
      var pos=g.attributes.position,norm=g.attributes.normal,uv=g.attributes.uv,col=g.attributes.color;
      var nm=new T.Matrix3().getNormalMatrix(o.matrixWorld);
      var v=new T.Vector3(),n=new T.Vector3();
      for(var i=0;i<pos.count;i++){
        v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
        n.fromBufferAttribute(norm,i).applyMatrix3(nm).normalize();
        bin.p.push(v.x,v.y,v.z);bin.n.push(n.x,n.y,n.z);bin.uv.push(uv?uv.getX(i):0,uv?uv.getY(i):0);
        if(bin.colored)bin.c.push(col?col.getX(i):1,col?col.getY(i):1,col?col.getZ(i):1);
      }
      if(g.index){for(var j=0;j<g.index.count;j++)bin.indices.push(offset+g.index.getX(j));}
      else{for(var j=0;j<pos.count;j++)bin.indices.push(offset+j);}
    });
    group.remove(source);
    var triangles=2;
    bins.forEach(function(bin){
      var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(bin.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(bin.n,3));g.setAttribute('uv',new T.Float32BufferAttribute(bin.uv,2));
      if(bin.colored)g.setAttribute('color',new T.Float32BufferAttribute(bin.c,3));g.setIndex(bin.indices);g.computeBoundingBox();g.computeBoundingSphere();
      var o=mesh(g,bin.material,group);o.name=bin.role?'map-building-'+bin.role:'compiled-connected-mainland';o.userData.smallDetail=bin.tiny;o.userData.partRadius=bin.maxRadius;o.castShadow=!bin.material.transparent;o.receiveShadow=true;
      if(bin.role)o.userData.nodeId=bin.role;triangles+=g.index.count/3;
    });
    var metadata={
      authorship:'All terrain, roads, bridges and models self-authored in this project.',
      terrainContinuity:'One continuous sampled height field; smooth coastline, relief, biomes and river channel. No independent floating regional plates.',
      regions:regions.map(function(r){return{id:r.id,name:r.name,position:r.position.toArray(),description:r.description};}),
      routes:routes.map(function(r){return{from:r.from,to:r.to,width:r.width,bridges:r.bridges,samples:r.points.length,points:r.points.map(function(p){return p.toArray();})};}),
      bounds:bounds,bridges:bridgeCount,materialBatches:bins.size+1,triangles:triangles,modelCount:modelCount,
      buildingIds:['collaboration','automation','connection'],seaLevel:SEA,
      refinedRoute:['collaboration','automation','connection']
    };
    metadata.geoVersion=geo.version;metadata.projection=geo.projection;metadata.coastStyle='continuous coves, bays and submerged shelf';
    group.userData.map=metadata;
    var unused=new Set();source.traverse(function(o){if(o.geometry)unused.add(o.geometry);});unused.forEach(function(g){g.dispose();});
    source.clear();source=null;bins.clear();bins=null;kit=null;
    return runtimeMap({regions:regions,focusPoints:focusPoints,heightAt:heightAt,bounds:bounds,routes:routes,buildingPositions:buildingPositions,water:water,seaLevel:SEA,coastField:coastField,geoRegions:geo.regions,geography:geo},time);
  }
})(window);
