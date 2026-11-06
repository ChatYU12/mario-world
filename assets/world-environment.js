/* Self-authored offline atmosphere and single-pass water for Three.js r147.
 * No DOM, loaders, render targets, storage, listeners or animation scheduler.
 * update() receives seconds from the engine; its return value requests another
 * environment frame without implying that the navigation camera is moving.
 */
(function (root) {
  'use strict';
  var VERSION = '1.1.0';
  var DEFAULTS = { timeOfDay: 14, weather: 'clear', animate: true, cycle: false };
  var WEATHER = {
    clear:  { top: '#72b5df', horizon: '#dceef1', cover: .20, light: 1, near: 105, far: 310 },
    cloudy: { top: '#91a9bb', horizon: '#d2dde1', cover: .72, light: .68, near: 85, far: 260 },
    rain:   { top: '#596f83', horizon: '#9aaeb8', cover: .94, light: .43, near: 45, far: 180 },
    snow:   { top: '#a9b9c8', horizon: '#e2eaf0', cover: .86, light: .67, near: 55, far: 210 }
  };
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function number(x, fallback) { return typeof x === 'number' && isFinite(x) ? x : fallback; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function isMap(mode) { return mode === 'map' || mode === 'focus'; }
  function qualityName(value) { return value === 'smooth' || value === 'detail' ? value : 'auto'; }

  var WATER_VERTEX = [
    'varying vec3 vWorld; varying vec3 vSurfaceNormal; varying vec2 vWaterUv;',
    'void main(){',
    ' vec4 world=modelMatrix*vec4(position,1.0); vWorld=world.xyz;',
    ' vSurfaceNormal=normalize(mat3(modelMatrix)*normal); vWaterUv=uv;',
    ' gl_Position=projectionMatrix*viewMatrix*world;',
    '}'
  ].join('\n');
  var WATER_FRAGMENT = [
    'uniform sampler2D uRipples; uniform sampler2D uDepth;',
    'uniform float uTime; uniform float uGlobe; uniform float uHasDepth; uniform float uRain; uniform float uWind;',
    'uniform vec4 uBounds; uniform vec3 uDeep; uniform vec3 uShallow;',
    'uniform vec3 uSkyTop; uniform vec3 uHorizon; uniform vec3 uLightDirection;',
    'uniform vec3 uLightColor; uniform float uLightPower;',
    'uniform vec3 uFogColor; uniform vec2 uFogRange;',
    'varying vec3 vWorld; varying vec3 vSurfaceNormal; varying vec2 vWaterUv;',
    'void main(){',
    ' vec2 mapUv=(vWorld.xz-uBounds.xy)/uBounds.zw;',
    ' vec2 depthUv=mix(mapUv,vec2(fract(vWaterUv.x),clamp(vWaterUv.y,0.0,1.0)),uGlobe);',
    ' float inside=step(0.0,depthUv.x)*step(depthUv.x,1.0)*step(0.0,depthUv.y)*step(depthUv.y,1.0);',
    ' float depth=mix(12.0,texture2D(uDepth,clamp(depthUv,0.001,0.999)).r*12.0,uHasDepth*inside);',
    ' vec2 rippleUv=mix(vWorld.xz*0.055,vWaterUv*vec2(16.0,8.0),uGlobe);',
    ' vec4 a=texture2D(uRipples,rippleUv+vec2(uTime*0.007,-uTime*0.004)*(0.7+uWind));',
    ' vec4 b=texture2D(uRipples,rippleUv*2.13+vec2(-uTime*0.009,uTime*0.006)*(0.7+uWind));',
    ' vec2 wave=(a.rg*2.0-1.0)*0.67+(b.rg*2.0-1.0)*0.33;',
    ' vec3 surface=normalize(vSurfaceNormal);',
    ' vec3 reference=abs(surface.y)>0.9?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0);',
    ' vec3 tangent=normalize(cross(reference,surface)); vec3 bitangent=cross(surface,tangent);',
    ' vec3 normal=normalize(surface+(tangent*wave.x+bitangent*wave.y)*(0.065+uWind*0.055+uRain*0.045));',
    ' vec3 eye=normalize(cameraPosition-vWorld); float facing=max(dot(normal,eye),0.0);',
    ' vec3 reflected=reflect(-eye,normal);',
    ' vec3 reflection=mix(uHorizon,uSkyTop,pow(clamp(reflected.y,0.0,1.0),0.6));',
    ' float fresnel=0.025+0.75*pow(1.0-facing,5.0);',
    ' vec3 color=mix(uShallow,uDeep,smoothstep(0.10,3.1,depth));',
    ' color*=0.94+0.08*a.b; color=mix(color,reflection,fresnel);',
    ' float glint=pow(max(dot(reflect(-uLightDirection,normal),eye),0.0),110.0-uRain*58.0);',
    ' color+=uLightColor*glint*uLightPower*0.85;',
    ' float shore=(1.0-smoothstep(0.06,0.30,depth))*smoothstep(0.015,0.06,depth);',
    ' float lace=smoothstep(0.78,0.96,0.5+0.5*sin(depth*12.0+a.b*5.0-uTime*0.8));',
    ' color=mix(color,mix(uHorizon,vec3(0.88),0.35),shore*lace*0.16);',
    ' float haze=smoothstep(uFogRange.x,uFogRange.y,length(cameraPosition-vWorld));',
    ' color=mix(color,uFogColor,haze); gl_FragColor=vec4(color,1.0);',
    ' #include <tonemapping_fragment>',
    ' #include <encodings_fragment>',
    '}'
  ].join('\n');
  var SKY_VERTEX = [
    'varying vec3 vSkyDirection;',
    'void main(){vSkyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
  ].join('\n');
  var SKY_FRAGMENT = [
    'uniform sampler2D uClouds; uniform float uTime; uniform float uCloudCover;',
    'uniform vec3 uSkyTop; uniform vec3 uHorizon; uniform vec3 uSunDirection;',
    'uniform vec3 uLightColor; uniform float uDay; varying vec3 vSkyDirection;',
    'void main(){',
    ' vec3 direction=normalize(vSkyDirection); float elevation=clamp(direction.y,0.0,1.0);',
    ' float sunlight=max(dot(direction,uSunDirection),0.0);',
    ' float twilight=(1.0-smoothstep(0.04,0.42,abs(uSunDirection.y)))*smoothstep(-0.18,0.03,uSunDirection.y);',
    ' vec3 color=mix(uHorizon,uSkyTop,pow(elevation,0.55));',
    ' color+=uLightColor*pow(sunlight,14.0)*0.17*uDay*(1.0-uCloudCover*0.7);',
    ' color=mix(color,vec3(0.80,0.35,0.17),twilight*pow(sunlight,5.0)*pow(1.0-elevation,3.0)*0.3);',
    ' float sun=smoothstep(0.99978,0.99994,sunlight)*smoothstep(-0.055,0.025,uSunDirection.y);',
    ' color=mix(color,vec3(1.0,0.86,0.60),sun*(1.0-uCloudCover*0.86));',
    ' float moon=smoothstep(0.99955,0.99987,dot(direction,-uSunDirection))*(1.0-uDay);',
    ' color=mix(color,vec3(0.68,0.76,0.88),moon*(1.0-uCloudCover*0.84));',
    ' vec2 uv=direction.xz/(0.28+max(0.06,direction.y))*0.14+vec2(uTime*0.0013,uTime*0.0005);',
    ' vec4 cloud=texture2D(uClouds,uv); float detail=texture2D(uClouds,uv*2.17+0.24).r;',
    ' float density=cloud.r*0.78+detail*0.22; float threshold=mix(0.69,0.28,uCloudCover);',
    ' float clouds=smoothstep(threshold,threshold+0.16,density)*smoothstep(0.0,0.085,direction.y);',
    ' float rim=smoothstep(threshold+0.04,threshold+0.17,density);',
    ' vec3 cloudBase=mix(uHorizon*0.52,vec3(0.84,0.89,0.93),uDay*(1.0-uCloudCover*0.52));',
    ' vec3 cloudTop=mix(cloudBase,uLightColor,uDay*0.42+twilight*0.25);',
    ' vec3 cloudColor=mix(cloudBase,cloudTop,clamp(cloud.g*0.6+rim*0.4,0.0,1.0));',
    ' cloudColor+=uLightColor*pow(sunlight,12.0)*clouds*(1.0-rim)*0.16*uDay;',
    ' color=mix(color,cloudColor,clouds*(0.64+uCloudCover*0.27));gl_FragColor=vec4(color,1.0);',
    ' #include <tonemapping_fragment>',
    ' #include <encodings_fragment>',
    '}'
  ].join('\n');
  var PRECIP_VERTEX = [
    'uniform float uTime; uniform float uSnow; uniform float uPointScale; uniform float uWind;',
    'varying float vDistance;',
    'void main(){',
    ' vec3 p=position; float speed=mix(16.0,2.6,uSnow);',
    ' p.y=mod(p.y-uTime*speed+38000.0,38.0);',
    ' p.x+=sin(position.z*0.23+uTime*0.5)*uSnow*1.7+sin(uTime*0.18)*0.6+(38.0-p.y)*uWind*0.08;',
    ' vec4 mv=modelViewMatrix*vec4(p,1.0);vDistance=-mv.z;',
    ' gl_Position=projectionMatrix*mv;',
    ' gl_PointSize=clamp(mix(14.0,3.3,uSnow)*uPointScale/max(12.0,-mv.z),1.0,18.0);',
    '}'
  ].join('\n');
  var PRECIP_FRAGMENT = [
    'uniform float uSnow; uniform float uDay; uniform float uFall; uniform vec3 uHorizon; varying float vDistance;',
    'void main(){',
    ' vec2 p=gl_PointCoord*2.0-1.0;',
    ' float rain=(1.0-smoothstep(0.06,0.18,abs(p.x+p.y*0.12)))*(1.0-p.y*p.y);',
    ' float snow=1.0-smoothstep(0.32,1.0,length(p));',
    ' float alpha=mix(rain*0.38,snow*0.68,uSnow)*uFall*(1.0-smoothstep(60.0,145.0,vDistance));',
    ' if(alpha<0.025)discard;',
    ' vec3 color=mix(uHorizon,vec3(0.94,0.97,1.0),0.35+0.4*uDay);',
    ' gl_FragColor=vec4(color,alpha);',
    ' #include <tonemapping_fragment>',
    ' #include <encodings_fragment>',
    '}'
  ].join('\n');

  function create(T, scene, options) {
    if (!T || !scene || typeof scene.add !== 'function') throw new TypeError('Environment requires Three.js and a Scene.');
    var opts = options || {}, disposed = false, state = Object.assign({}, DEFAULTS);
    var mode = 'overview', quality = qualityName(opts.quality), camera = opts.camera || null;
    var lastTime = null, elapsed = 0, needsAnimation = false, revision = 0;
    var reducedQuery = typeof root.matchMedia === 'function' ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var environment = new T.Group(); environment.name = 'world-environment'; scene.add(environment);
    environment.userData.environment = { version: VERSION, ownsScheduler: false, renderTargets: 0 };
    var originalBackground = scene.background, originalFog = scene.fog;
    var waters = [], ownLights = [], savedLights = [];
    var cameraPosition = new T.Vector3(), forward = new T.Vector3(), precipitationCenter = new T.Vector3();
    var sunDirection = new T.Vector3(), lightDirection = new T.Vector3();
    var colors = {};
    ['#071322','#23374b','#07455c','#69b9ad','#041a2b','#173944','#fff5df','#efba89','#eba087','#8e94b7','#bacfed','#627b65','#15232a'].forEach(function(hex){colors[hex]=new T.Color(hex);});
    Object.keys(WEATHER).forEach(function(name){WEATHER[name].topColor = WEATHER[name].topColor || new T.Color(WEATHER[name].top);WEATHER[name].horizonColor = WEATHER[name].horizonColor || new T.Color(WEATHER[name].horizon);});
    var skyTop = new T.Color(), horizon = new T.Color(), lightColor = new T.Color(), deep = new T.Color(), shallow = new T.Color(), groundColor = new T.Color();
    var day = 1, sunAltitude = 0, cloudCover = .2, lightPower = 1;
    var fog = new T.Fog(0xdceef1, 105, 310);
    var shared = {
      uTime: { value: 0 }, uRipples: { value: null },
      uSkyTop: { value: skyTop }, uHorizon: { value: horizon },
      uSunDirection: { value: sunDirection }, uLightDirection: { value: lightDirection },
      uLightColor: { value: lightColor }, uLightPower: { value: 1 },
      uDay: { value: 1 }, uCloudCover: { value: .2 }, uRain: { value: 0 }, uWind: { value: .2 }, uFall: { value: 0 }, uClouds: { value: null }
    };
    function saveLight(light, owned) {
      if (owned) { ownLights.push(light); environment.add(light); if(light.target)environment.add(light.target); }
      else savedLights.push({ light: light, color: light.color.clone(), intensity: light.intensity, position: light.position.clone(), ground: light.groundColor && light.groundColor.clone(), target: light.target && light.target.position.clone() });
      return light;
    }
    var key = saveLight(opts.key || new T.DirectionalLight(0xffffff, 1.6), !opts.key);
    var fill = saveLight(opts.fill || new T.DirectionalLight(0xc3ddff, .4), !opts.fill);
    var hemisphere = saveLight(opts.hemisphere || new T.HemisphereLight(0xdceeff, 0x627b65, .9), !opts.hemisphere);

    function texture(data, width, height, name, repeat) {
      var value = new T.DataTexture(data, width, height, T.RGBAFormat, T.UnsignedByteType);
      value.name = name; value.encoding = T.LinearEncoding;
      value.wrapS = repeat ? T.RepeatWrapping : T.ClampToEdgeWrapping;
      value.wrapT = T.ClampToEdgeWrapping;
      value.minFilter = value.magFilter = T.LinearFilter; value.generateMipmaps = false;
      value.needsUpdate = true; return value;
    }
    function makeRipples() {
      var n = 64, data = new Uint8Array(n * n * 4), tau = Math.PI * 2;
      function h(x,y){x=x/n*tau;y=y/n*tau;return Math.sin(x+1.3)*.30+Math.sin(x*2+y*2)*.22+Math.cos(y*3-.4)*.20+Math.cos(x*3-y*2+.8)*.16;}
      for(var y=0;y<n;y++)for(var x=0;x<n;x++){
        var i=(y*n+x)*4;
        data[i]=Math.round(clamp(.5+(h(x+1,y)-h(x-1,y))*1.3,0,1)*255);
        data[i+1]=Math.round(clamp(.5+(h(x,y+1)-h(x,y-1))*1.3,0,1)*255);
        data[i+2]=Math.round(clamp(.5+h(x,y)*.5,0,1)*255); data[i+3]=255;
      }
      var result=texture(data,n,n,'environment-ripples',true);result.wrapT=T.RepeatWrapping;return result;
    }
    function makeClouds(){
      var n=128,data=new Uint8Array(n*n*4);
      function hash(x,y,cells){x=(x%cells+cells)%cells;y=(y%cells+cells)%cells;var h=Math.imul(x+17,374761393)^Math.imul(y+31,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;}
      function noise(x,y,cells){x=x/n*cells;y=y/n*cells;var ix=Math.floor(x),iy=Math.floor(y),a=x-ix,b=y-iy;a=a*a*(3-2*a);b=b*b*(3-2*b);return(hash(ix,iy,cells)*(1-a)+hash(ix+1,iy,cells)*a)*(1-b)+(hash(ix,iy+1,cells)*(1-a)+hash(ix+1,iy+1,cells)*a)*b;}
      for(var y=0;y<n;y++)for(var x=0;x<n;x++){var i=(y*n+x)*4,d=noise(x,y,4)*.55+noise(x,y,8)*.28+noise(x,y,16)*.12+noise(x,y,32)*.05;data[i]=Math.round(d*255);data[i+1]=Math.round(clamp(d+(noise(x+2,y-2,8)-d)*.6,0,1)*255);data[i+2]=data[i];data[i+3]=255;}
      var t=texture(data,n,n,'environment-cloud-density',true);t.wrapT=T.RepeatWrapping;return t;
    }
    var ripples = makeRipples(),cloudTexture=makeClouds(); shared.uRipples.value = ripples;shared.uClouds.value=cloudTexture;
    var skyGeometry = new T.SphereGeometry(1,32,16);
    var skyMaterial = new T.ShaderMaterial({ uniforms: {
      uClouds:shared.uClouds,uTime:shared.uTime,uSkyTop:shared.uSkyTop,uHorizon:shared.uHorizon,
      uSunDirection:shared.uSunDirection,uLightColor:shared.uLightColor,uDay:shared.uDay,uCloudCover:shared.uCloudCover
    }, vertexShader:SKY_VERTEX, fragmentShader:SKY_FRAGMENT, side:T.BackSide, depthWrite:false, depthTest:false, fog:false });
    skyMaterial.name='environment-sky';
    var sky = new T.Mesh(skyGeometry,skyMaterial);sky.name='environment-sky';sky.frustumCulled=false;sky.renderOrder=-1000;environment.add(sky);
    var positions=new Float32Array(192*3),seed=0x454e5652;
    function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
    for(var p=0;p<192;p++){positions[p*3]=(random()-.5)*84;positions[p*3+1]=random()*38;positions[p*3+2]=(random()-.5)*84;}
    var particleGeometry=new T.BufferGeometry();particleGeometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));particleGeometry.computeBoundingSphere();
    var particleMaterial=new T.ShaderMaterial({ uniforms:{uTime:shared.uTime,uSnow:{value:0},uPointScale:{value:120},uDay:shared.uDay,uHorizon:shared.uHorizon,uFall:shared.uFall,uWind:shared.uWind},
      vertexShader:PRECIP_VERTEX,fragmentShader:PRECIP_FRAGMENT,transparent:true,depthWrite:false,depthTest:true,fog:false });
    particleMaterial.name='environment-precipitation';
    var precipitation=new T.Points(particleGeometry,particleMaterial);precipitation.name='environment-precipitation';precipitation.frustumCulled=false;precipitation.renderOrder=6;environment.add(precipitation);
    var particleCount=0;
    function reducedMotion(){return opts.reducedMotion===true || !!(reducedQuery&&reducedQuery.matches);}
    function motionAllowed(){return state.animate && !reducedMotion() && quality!=='smooth';}

    function boundsOf(value) {
      var b=value||{},minX=number(b.minX,-68),maxX=number(b.maxX,68),minZ=number(b.minZ,-58),maxZ=number(b.maxZ,58);
      return {minX:minX,maxX:Math.max(minX+1,maxX),minZ:minZ,maxZ:Math.max(minZ+1,maxZ)};
    }
    function makeDepth(settings,kind) {
      var geo=root.MarioWorldGeography||{},bounds=boundsOf(settings.bounds||geo.bounds);
      var sample=settings.heightAt||geo.heightAt,coast=settings.coastField||geo.coastField;
      // Sample beyond the terrain rectangle so the open sea has no rectangular
      // color/foam boundary where the terrain buffer happens to end.
      if(kind==='map'){bounds.minX-=24;bounds.maxX+=24;bounds.minZ-=24;bounds.maxZ+=24;}
      var project=settings.directionToMap||geo.directionToMap,sea=number(settings.seaLevel,number(geo.seaLevel,.48));
      var usable=typeof sample==='function' && (kind==='map'||typeof project==='function');
      var n=quality==='detail'?256:128,w=n,h=kind==='globe'?n/2:n,data=new Uint8Array(w*h*4),direction={x:0,y:0,z:0};
      for(var y=0;y<h;y++)for(var x=0;x<w;x++){
        var mx=bounds.minX+(x+.5)/w*(bounds.maxX-bounds.minX),mz=bounds.minZ+(y+.5)/h*(bounds.maxZ-bounds.minZ),valid=usable;
        if(kind==='globe'){
          var phi=(x+.5)/w*Math.PI*2,lat=((y+.5)/h-.5)*Math.PI,cs=Math.cos(lat);
          direction.x=-Math.cos(phi)*cs;direction.y=Math.sin(lat);direction.z=Math.sin(phi)*cs;
          var mapped=typeof project==='function'?project(direction):null;
          valid=usable&&mapped&&mapped.front!==false&&mapped.inside!==false&&isFinite(mapped.x)&&isFinite(mapped.z);
          if(valid){mx=mapped.x;mz=mapped.z;}
        }
        var height=valid?sample(mx,mz):sea-12,depth=valid?clamp(sea-number(height,sea-12),0,12):12;
        var field=valid&&typeof coast==='function'?number(coast(mx,mz),-1):-1,i=(y*w+x)*4;
        data[i]=Math.round(depth/12*255);data[i+1]=Math.round((clamp(field,-1,1)*.5+.5)*255);
        data[i+2]=height<sea?255:0;data[i+3]=255;
      }
      return {texture:texture(data,w,h,'environment-depth-'+kind,kind==='globe'),width:w,height:h,bounds:bounds,seaLevel:sea,sampler:sample,usable:usable,source:usable?'shared-heightAt':'deep-water-fallback'};
    }
    function attachWater(mesh,settings) {
      if(disposed)return null;
      if(!mesh||!mesh.isMesh||!mesh.geometry)throw new TypeError('attachWater requires an existing water Mesh.');
      settings=settings||{};
      for(var old=0;old<waters.length;old++)if(waters[old].mesh===mesh){waters[old].depth.texture.needsUpdate=true;ripples.needsUpdate=true;return waters[old].material;}
      var kind=settings.kind==='globe'?'globe':'map',depthField=makeDepth(settings,kind),b=depthField.bounds;
      var material=new T.ShaderMaterial({ uniforms:{
        uRipples:shared.uRipples,uTime:shared.uTime,uDeep:{value:deep},uShallow:{value:shallow},
        uSkyTop:shared.uSkyTop,uHorizon:shared.uHorizon,uLightDirection:shared.uLightDirection,
        uLightColor:shared.uLightColor,uLightPower:shared.uLightPower,uRain:shared.uRain,uWind:shared.uWind,
        uDepth:{value:depthField.texture},uGlobe:{value:kind==='globe'?1:0},uHasDepth:{value:depthField.usable?1:0},
        uBounds:{value:new T.Vector4(b.minX,b.minZ,b.maxX-b.minX,b.maxZ-b.minZ)},
        uFogColor:{value:horizon},uFogRange:{value:new T.Vector2(kind==='map'?fog.near:500,kind==='map'?fog.far:900)}
      },vertexShader:WATER_VERTEX,fragmentShader:WATER_FRAGMENT,depthWrite:true,fog:false});
      material.name='environment-water-'+kind;
      var record={mesh:mesh,kind:kind,depth:depthField,material:material,originalMaterial:mesh.material,originalMetadata:mesh.userData.environmentWater};
      record.metadata={kind:kind,depthSource:depthField.source,depthSize:[depthField.width,depthField.height],singlePass:true};
      mesh.userData.environmentWater=record.metadata;mesh.material=material;waters.push(record);revision++;
      return material;
    }

    var viewDistance=0,transitionAge=2,transitionDuration=1.6,transitioning=false,lightingDirty=true,lightingUpdates=0;
    var visual={hour:state.timeOfDay,cover:.2,light:1,near:105,far:310,rain:0,snow:0,top:new T.Color(WEATHER.clear.top),horizon:new T.Color(WEATHER.clear.horizon)},fromVisual=null;
    function captureVisual(){return{hour:visual.hour,cover:visual.cover,light:visual.light,near:visual.near,far:visual.far,rain:visual.rain,snow:visual.snow,top:visual.top.clone(),horizon:visual.horizon.clone()};}
    function syncVisual(t){var p=WEATHER[state.weather],f=fromVisual||captureVisual(),dh=((state.timeOfDay-f.hour+36)%24)-12;
      visual.hour=t>=1?state.timeOfDay:(f.hour+dh*t+24)%24;
      ['cover','light','near','far'].forEach(function(k){visual[k]=f[k]+(p[k]-f[k])*t;});
      visual.rain=f.rain+((state.weather==='rain'?1:0)-f.rain)*t;visual.snow=f.snow+((state.weather==='snow'?1:0)-f.snow)*t;
      visual.top.copy(f.top).lerp(p.topColor,t);visual.horizon.copy(f.horizon).lerp(p.horizonColor,t);lightingDirty=true;
    }
    function setFogRange(){var p=visual,offset=Math.max(0,viewDistance-120);fog.near=p.near+offset;fog.far=p.far+offset;waters.forEach(function(w){if(w.kind==='map')w.material.uniforms.uFogRange.value.set(fog.near,fog.far);});}
    function updatePrecipitation(){var amount=clamp(visual.rain+visual.snow,0,1),compact=number(root.innerWidth,1024)<700;
      particleCount=isMap(mode)&&amount>.003?(quality==='smooth'?24:compact?64:quality==='detail'?192:128):0;
      precipitation.visible=particleCount>0;particleGeometry.setDrawRange(0,particleCount);shared.uFall.value=amount;
      particleMaterial.uniforms.uSnow.value=amount>.001?visual.snow/amount:0;
    }
    function applyLighting() {
      var preset=visual,phase=(visual.hour-6)/24*Math.PI*2;lightingUpdates++;
      sunDirection.set(-Math.cos(phase),Math.sin(phase)*.90,.32).normalize();
      sunAltitude=Math.asin(clamp(sunDirection.y,-1,1))*180/Math.PI;
      day=smooth(-.12,.22,sunDirection.y);
      lightDirection.copy(sunDirection);
      // Twilight outlives direct daylight. Only blend toward moonlight after the
      // sun is below the horizon; ambient dayFactor must not cool a sunset sun.
      var twilight=(1-smooth(.05,.45,Math.abs(sunDirection.y)))*smooth(-.22,-.035,sunDirection.y);
      var warmth=twilight*(1-preset.cover*.85),skyWarmth=twilight*Math.pow(1-preset.cover,1.5);
      var moonlight=1-smooth(-.24,-.045,sunDirection.y);
      lightColor.copy(colors['#fff5df']).lerp(colors['#efba89'],warmth).lerp(colors['#bacfed'],moonlight);
      skyTop.copy(colors['#071322']).lerp(preset.top,day).lerp(colors['#8e94b7'],skyWarmth*.26);
      horizon.copy(colors['#23374b']).lerp(preset.horizon,day).lerp(colors['#eba087'],skyWarmth*.95);
      deep.copy(colors['#041a2b']).lerp(colors['#07455c'],day*preset.light);
      shallow.copy(colors['#173944']).lerp(colors['#69b9ad'],day*(.45+preset.light*.55));
      groundColor.copy(colors['#15232a']).lerp(colors['#627b65'],day);
      cloudCover=preset.cover;lightPower=(.10+(day*1.3))*preset.light;
      shared.uDay.value=day;shared.uCloudCover.value=cloudCover;shared.uLightPower.value=lightPower;shared.uRain.value=visual.rain;shared.uWind.value=.18+preset.cover*.45+visual.rain*.3;
      var mapView=isMap(mode),scale=mapView?145:6;
      key.color.copy(lightColor);key.intensity=(.025+Math.sqrt(Math.max(0,sunDirection.y))*1.65)*preset.light*smooth(-.06,.07,sunDirection.y);key.position.copy(lightDirection).multiplyScalar(scale);
      if(key.target)key.target.position.set(0,0,0);
      // A restrained cool lift makes the unlit sides of buildings navigable at
      // night, without changing daylight, twilight, the sky or the moon key.
      fill.color.copy(horizon).lerp(colors['#bacfed'],moonlight*.65);fill.intensity=.12+day*.33*preset.light+moonlight*.24+twilight*.14;fill.position.copy(sunDirection).multiplyScalar(-scale);
      hemisphere.color.copy(horizon).lerp(colors['#bacfed'],moonlight*.25);if(hemisphere.groundColor)hemisphere.groundColor.copy(groundColor);hemisphere.intensity=.30+day*.65*preset.light+moonlight*.18+twilight*.12;
      if(mapView){fog.color.copy(horizon);setFogRange();scene.fog=fog;scene.background=horizon;}
      else{if(scene.fog===fog)scene.fog=originalFog;if(scene.background===horizon)scene.background=originalBackground;}
      waters.forEach(function(w){if(w.kind==='map')w.material.uniforms.uFogRange.value.set(fog.near,fog.far);});
      sky.visible=mapView;
      updatePrecipitation();lightingDirty=false;
    }
    function configure(patch) {
      if(disposed)return getState();patch=patch||{};var changed=false,visualChanged=false;
      if(patch.timeOfDay!==undefined){var time=Number(patch.timeOfDay);if(isFinite(time)){time=((time%24)+24)%24;if(time!==state.timeOfDay){state.timeOfDay=time;changed=visualChanged=true;}}}
      if(typeof patch.weather==='string'&&Object.prototype.hasOwnProperty.call(WEATHER,patch.weather)&&patch.weather!==state.weather){state.weather=patch.weather;changed=visualChanged=true;}
      ['animate','cycle'].forEach(function(k){if(typeof patch[k]==='boolean'&&patch[k]!==state[k]){state[k]=patch[k];changed=true;}});
      if(visualChanged){fromVisual=captureVisual();transitionAge=0;transitioning=!reducedMotion();if(!transitioning)syncVisual(1);}
      if(changed){revision++;if(!transitioning)applyLighting();}
      needsAnimation=transitioning||motionAllowed()&&(state.cycle||isMap(mode));return getState();
    }
    function update(time,viewer) {
      if(disposed)return false;viewer=viewer||{};
      if(typeof viewer.mode==='string'&&viewer.mode!==mode){mode=viewer.mode;lightingDirty=true;}
      if(viewer.quality!==undefined&&qualityName(viewer.quality)!==quality){quality=qualityName(viewer.quality);lightingDirty=true;}
      if(viewer.camera)camera=viewer.camera;
      var nextDistance=number(viewer.distance,viewDistance);if(Math.abs(nextDistance-viewDistance)>.05){viewDistance=nextDistance;setFogRange();}
      time=number(time,lastTime===null?0:lastTime);var dt=lastTime===null||time<lastTime?0:clamp(time-lastTime,0,.10);lastTime=time;
      var animate=motionAllowed();
      if(animate&&state.cycle){state.timeOfDay=(state.timeOfDay+dt*24/900)%24;if(!transitioning){visual.hour=state.timeOfDay;lightingDirty=true;}}
      if(transitioning){transitionAge+=dt;var progress=reducedMotion()?1:clamp(transitionAge/transitionDuration,0,1);syncVisual(smooth(0,1,progress));if(progress>=1){transitioning=false;fromVisual=null;}}
      if(animate&&isMap(mode))elapsed+=dt;
      shared.uTime.value=elapsed;if(lightingDirty)applyLighting();
      if(camera){
        camera.getWorldPosition(cameraPosition);sky.position.copy(cameraPosition);sky.scale.setScalar(Math.max(.5,Math.min(420,number(camera.far,1000)*.80)));
        camera.getWorldDirection(forward);
        var sea=.48,mapWater=null;
        for(var w=0;w<waters.length;w++)if(waters[w].kind==='map'){mapWater=waters[w];sea=mapWater.depth.seaLevel;break;}
        var reach=forward.y<-.05?clamp((sea+3-cameraPosition.y)/forward.y,0,90):35;
        precipitationCenter.copy(cameraPosition).addScaledVector(forward,reach);
        var floor=sea;
        if(mapWater&&typeof mapWater.depth.sampler==='function')floor=number(mapWater.depth.sampler(precipitationCenter.x,precipitationCenter.z),sea);
        precipitation.position.set(precipitationCenter.x,Math.max(sea,floor)+.8,precipitationCenter.z);
        particleMaterial.uniforms.uPointScale.value=clamp(180/Math.max(.35,Math.tan(number(camera.fov,38)*Math.PI/360)),150,450);
      }
      // Scene.matrixWorldAutoUpdate is disabled by the host engine. This root is
      // deliberately outside its frozen terrain groups; lights also need updates.
      environment.updateMatrixWorld(true);key.updateMatrixWorld(true);fill.updateMatrixWorld(true);hemisphere.updateMatrixWorld(true);if(key.target)key.target.updateMatrixWorld(true);
      needsAnimation=transitioning||animate&&(state.cycle||isMap(mode));return needsAnimation;
    }
    function byteSize(geometry){var bytes=0;if(!geometry)return bytes;Object.keys(geometry.attributes).forEach(function(k){bytes+=geometry.attributes[k].array.byteLength;});if(geometry.index)bytes+=geometry.index.array.byteLength;return bytes;}
    function getState() {
      var textureBytes=disposed?0:(64*64+128*128)*4;
      var waterState=waters.map(function(w){textureBytes+=w.depth.width*w.depth.height*4;return{kind:w.kind,depthSource:w.depth.source,depthSize:[w.depth.width,w.depth.height],singlePass:true,material:w.material.type};});
      return {timeOfDay:state.timeOfDay,weather:state.weather,animate:state.animate,cycle:state.cycle,
        version:VERSION,mode:mode,quality:quality,reducedMotion:reducedMotion(),effectiveAnimate:!disposed&&motionAllowed()&&isMap(mode),effectiveCycle:!disposed&&motionAllowed()&&state.cycle,
        transitioning:!disposed&&transitioning,renderTimeOfDay:visual.hour,weatherBlend:{rain:visual.rain,snow:visual.snow,cloudCover:visual.cover},lightingUpdates:lightingUpdates,needsAnimation:!disposed&&(transitioning||motionAllowed()&&(state.cycle||isMap(mode))),disposed:disposed,revision:revision,
        sunAltitude:sunAltitude,sunDirection:sunDirection.toArray(),dayFactor:day,elapsed:elapsed,
        waterCount:waters.length,water:waterState,particleCount:particleCount,
        resources:{renderTargets:0,textureCount:disposed?0:2+waters.length,textureBytes:textureBytes,
          geometryBytes:byteSize(skyGeometry)+byteSize(particleGeometry),skyTriangles:disposed?0:960,
          extraVisibleDraws:disposed?0:(sky.visible?1:0)+(precipitation.visible?1:0),maxParticles:192}}
    }
    function dispose() {
      if(disposed)return;disposed=true;needsAnimation=false;
      waters.forEach(function(w){if(w.mesh.material===w.material)w.mesh.material=w.originalMaterial;if(w.mesh.userData.environmentWater===w.metadata){if(w.originalMetadata===undefined)delete w.mesh.userData.environmentWater;else w.mesh.userData.environmentWater=w.originalMetadata;}w.material.dispose();w.depth.texture.dispose();});waters.length=0;
      if(scene.background===horizon)scene.background=originalBackground;if(scene.fog===fog)scene.fog=originalFog;
      savedLights.forEach(function(s){s.light.color.copy(s.color);s.light.intensity=s.intensity;s.light.position.copy(s.position);if(s.ground&&s.light.groundColor)s.light.groundColor.copy(s.ground);if(s.target&&s.light.target)s.light.target.position.copy(s.target);s.light.updateMatrixWorld(true);if(s.light.target)s.light.target.updateMatrixWorld(true);});
      ripples.dispose();cloudTexture.dispose();skyMaterial.dispose();particleMaterial.dispose();skyGeometry.dispose();particleGeometry.dispose();
      scene.remove(environment);environment.clear();particleCount=0;
      sky=null;precipitation=null;skyGeometry=null;particleGeometry=null;skyMaterial=null;particleMaterial=null;ripples=null;shared.uRipples.value=null;shared.uClouds.value=null;cloudTexture=null;ownLights.length=0;savedLights.length=0;
    }
    var frameState={};
    function getFrameState(){frameState.weather=state.weather;frameState.quality=quality;frameState.mode=mode;frameState.cycle=state.cycle;frameState.transitioning=transitioning;return frameState;}
    applyLighting();environment.updateMatrixWorld(true);
    return {getFrameState:getFrameState,configure:configure,getState:getState,attachWater:attachWater,update:update,dispose:dispose};
  }
  root.MarioWorldEnvironment={version:VERSION,create:create};
})(typeof window!=='undefined'?window:globalThis);
