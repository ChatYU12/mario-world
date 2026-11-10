/* Two-scale world explorer: orbit the globe, descend into one connected map. */
(function () {
  'use strict';
  function latLonToVec3(lat, lon, radius) {
    var a=lat*Math.PI/180,b=lon*Math.PI/180;
    return new THREE.Vector3(radius*Math.cos(a)*Math.cos(b),radius*Math.sin(a),radius*Math.cos(a)*Math.sin(b));
  }
  /* ---------------------------------------------------------- isometric map camera
   * The mainland (map/focus) is drawn by a second, orthographic camera that never
   * rotates, while the planet and the descent keep the perspective camera:
   *   azimuth   45°       the eye sits south-east of the target and looks north-west
   *   elevation 35.264°   atan(1/√2): the true-isometric angle where one unit of x,
   *                       y and z foreshorten equally, so buildings keep equal scale
   *   distance  240       fixed eye-to-target length. It never frames anything; only
   *                       near/far and the fog band are derived from it.
   * The framing follows the 204×174 footprint: it is fitted into the frustum with
   * ISO.margin padding per side, so the ground rectangle fills 1-2*margin = 82% of the
   * binding viewport axis (height on landscape, width on portrait). Terrain and building
   * relief then reaches ~87% of that axis, which leaves the padding the margin promises
   * without ever clipping the silhouette. Zoom is continuous from the whole island to a
   * single building; ISO.zooms only names the three framings the +/-, wheel and pinch
   * controls snap to on a key press, it is not a limit on how close the camera may go.
   */
  var ISO={azimuth:45,elevation:35.264,distance:240,margin:.05,zooms:[1,1.45,2.1],zoomMax:12,
    regionDistance:42,closeDistance:30,focusZoom:11,nearSlack:60,farSlack:260,
    fogNearOffset:-15,fogFarOffset:190};
  var ISO_RAD=Math.PI/180;
  function isoDirection(azimuth, elevation) {
    var a=(azimuth===undefined?ISO.azimuth:azimuth)*ISO_RAD,e=(elevation===undefined?ISO.elevation:elevation)*ISO_RAD;
    return new THREE.Vector3(Math.cos(e)*Math.sin(a),Math.sin(e),Math.cos(e)*Math.cos(a)).normalize();
  }
  /* Three's lookAt basis for a fixed eye direction: x = right, y = screen up,
     z = eye - target. */
  function isoAxes(direction) {
    var back=direction.clone().normalize(),worldUp=new THREE.Vector3(0,1,0);
    var right=new THREE.Vector3().crossVectors(worldUp,back).normalize();
    var screenUp=new THREE.Vector3().crossVectors(back,right).normalize();
    return {back:back,right:right,up:screenUp};
  }
  /* Half extents of a world box around its centre, in camera space. */
  function isoExtents(bounds, minY, maxY, direction) {
    var axes=isoAxes(direction||isoDirection());
    var cx=(bounds.minX+bounds.maxX)/2,cy=(minY+maxY)/2,cz=(bounds.minZ+bounds.maxZ)/2;
    var xs=[bounds.minX,bounds.maxX],ys=[minY,maxY],zs=[bounds.minZ,bounds.maxZ];
    var ex=0,ey=0,ed=0,i,j,k,dx,dy,dz;
    for(i=0;i<2;i++)for(j=0;j<2;j++)for(k=0;k<2;k++){
      dx=xs[i]-cx;dy=ys[j]-cy;dz=zs[k]-cz;
      ex=Math.max(ex,Math.abs(dx*axes.right.x+dy*axes.right.y+dz*axes.right.z));
      ey=Math.max(ey,Math.abs(dx*axes.up.x+dy*axes.up.y+dz*axes.up.z));
      ed=Math.max(ed,Math.abs(dx*axes.back.x+dy*axes.back.y+dz*axes.back.z));
    }
    return {right:axes.right,up:axes.up,back:axes.back,x:ex,y:ey,depth:ed};
  }
  /* Orthographic frustum that contains the box at `zoom`, padded on the tighter
     axis: the contained box therefore fills exactly 1-2*margin of that axis. */
  function isoFrustum(bounds, minY, maxY, aspect, zoom, direction) {
    var extent=isoExtents(bounds,minY,maxY,direction),a=Math.max(.15,aspect||1),z=Math.max(.05,zoom||1);
    var half=Math.max(extent.y,extent.x/a)/(1-ISO.margin*2)/z;
    return {halfHeight:half,halfWidth:half*a,height:half*2,width:half*2*a,
      extentX:extent.x,extentY:extent.y,depth:extent.depth,right:extent.right,up:extent.up,back:extent.back};
  }
  /* The legacy map "distance" stays the public scalar (deep links, snapshots, label
     thresholds, enrichment LOD all read it); the orthographic zoom is a log-linear
     function of it, pinned to the three framings so every historic distance keeps a
     sensible framing and tier stepping can still be expressed as a distance. */
  function isoAnchors(whole) {
    var top=Math.max(ISO.regionDistance+1,isFinite(whole)?whole:ISO.regionDistance*4);
    return [[top,ISO.zooms[0]],[ISO.regionDistance,ISO.zooms[1]],[ISO.closeDistance,ISO.zooms[2]]];
  }
  /* The close-up tier is not the end of the story: beyond it the distance keeps
     falling along the same log-log slope, so a user can push in until one building
     fills the frame. The slope is taken from the last two control points so the
     mapping stays a single continuous function instead of a clamped table. */
  function isoZoomSlope() {
    return (Math.log(ISO.closeDistance)-Math.log(ISO.regionDistance))/(Math.log(ISO.zooms[2])-Math.log(ISO.zooms[1]));
  }
  function zoomForDistance(distance, whole) {
    var anchors=isoAnchors(whole),d=isFinite(distance)?Math.max(.01,distance):anchors[0][0];
    var i,a,b,t;
    if(d>=anchors[0][0])return anchors[0][1];
    if(d<=anchors[2][0]){
      var deeper=Math.exp(Math.log(anchors[2][1])+(Math.log(d)-Math.log(anchors[2][0]))/isoZoomSlope());
      return Math.min(ISO.zoomMax,Math.max(anchors[2][1],deeper));
    }
    for(i=0;i<2;i++){
      a=anchors[i];b=anchors[i+1];
      if(d<=a[0]&&d>=b[0]){t=(Math.log(d)-Math.log(a[0]))/(Math.log(b[0])-Math.log(a[0]));return a[1]+(b[1]-a[1])*t;}
    }
    return anchors[2][1];
  }
  function distanceForZoom(zoom, whole) {
    var anchors=isoAnchors(whole),z=isFinite(zoom)?zoom:1;
    var i,a,b,t;
    if(z<=anchors[0][1])return anchors[0][0];
    if(z>=anchors[2][1]){
      var capped=Math.min(ISO.zoomMax,Math.max(anchors[2][1],z));
      return Math.exp(Math.log(anchors[2][0])+isoZoomSlope()*(Math.log(capped)-Math.log(anchors[2][1])));
    }
    for(i=0;i<2;i++){
      a=anchors[i];b=anchors[i+1];
      if(z>=a[1]&&z<=b[1]){t=(Math.log(z)-Math.log(a[1]))/(Math.log(b[1])-Math.log(a[1]));return Math.exp(Math.log(a[0])+(Math.log(b[0])-Math.log(a[0]))*t);}
    }
    return anchors[2][0];
  }
  /* Measured from the orthographic eye, which always sits ISO.distance from the
     target, so the island's depth range is ISO.distance ± ~113. */
  function isoFogNear(){return ISO.distance+ISO.fogNearOffset;}
  function isoFogFar(){return ISO.distance+ISO.fogFarOffset;}
  function create(canvas, options) {
    var T=THREE,opts=options||{},nodes=opts.nodes||[],reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    T.ColorManagement.legacyMode=false;
    var scene=new T.Scene(),globe=new T.Group(),mapGroup=new T.Group();
    globe.name='surface';mapGroup.name='connected-map';mapGroup.visible=false;scene.add(globe,mapGroup);
    var renderer,rendererAttempts=[];
    function makeRenderer(compatible){return new T.WebGLRenderer({canvas:canvas,alpha:true,antialias:opts.highQuality===true&&!compatible,powerPreference:compatible||opts.quality==='smooth'?'default':'high-performance'});}
    try{renderer=makeRenderer(!!opts.compatibility);}catch(firstError){
      rendererAttempts.push(firstError.message);
      if(opts.compatibility){firstError.code='WEBGL_CREATION_FAILED';throw firstError;}
      opts.compatibility=true;
      try{renderer=makeRenderer(true);}catch(error){error.code='WEBGL_CREATION_FAILED';error.previousError=firstError.message;throw error;}
    }

    renderer.outputEncoding=T.sRGBEncoding;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.10;
    if(renderer.shadowMap){renderer.shadowMap.enabled=opts.shadows===true&&window.innerWidth>680&&!opts.compatibility;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=T.PCFSoftShadowMap;}
    var camera=new T.PerspectiveCamera(38,1,.05,2000),clock=new T.Clock();
    // Second, orthographic camera for the mainland. `camera` above stays the
    // planet/descent camera; nothing outside this closure may assume which one is
    // live, so every consumer (picking, labels, LOD, fog, render) asks
    // activeCamera() instead of naming one.
    var iso=new T.OrthographicCamera(-1,1,1,-1,.05,1000);
    var isoEyeDirection=isoDirection(),isoHeights=null,isoBase=null;
    // The island can be inspected from the opposite side: isoYaw stays 0 or PI and the
    // eased value is what the camera uses, so a 180 degree turn is an animation rather
    // than a jump. Elevation never changes, so the plate keeps its isometric angle.
    var isoYaw=0,isoYawTarget=0;
    function isoEyeFor(yaw){return isoDirection(ISO.azimuth+(yaw||0)*180/Math.PI,ISO.elevation);}
    var isoView={zoom:1,halfHeight:1,halfWidth:1,height:2,width:2,near:.05,far:1000},isoAim=new T.Vector3();
    var overviewDistance=opts.startDistance||4.8,raf=0,disposed=false,visible=true,frames=0;
    var dirty=true,lastRenderAt=-1000,contextLost=false,contextLosses=0,recoveryTimer=0,lostSnapshot=null;
    var maxFPS=opts.maxFPS||60,pixelRatio=1,gpuResident='globe',animationTime=0;
    var globeVillage=null,mapVillage=null,globeFrontier=null,mapFrontier=null,groundScatter=null,islandLandmarks=null;
    var environmentFPS=window.innerWidth<700?30:60,pinsUpdates=0,sunScratch=new T.Vector3();
    var quality=opts.quality||(opts.compatibility?'smooth':'auto'),dynamicScale=1,resolutionMoving=false,drawMS=0,measuredFPS=0,intervals=[],intervalTotal=0,warmFrames=0,enrichment=null,placeRequest=null,extraAnimation=false,globePickTargets=[],mapPickTargets=[],lodHidden=0,residentLabels=[],viewWidth=800,viewHeight=800,pointerRect=null,bufferResizePending=true;
    var profiles={auto:{pixels:1800000,dpr:1.8,motion:.82},detail:{pixels:2600000,dpr:2,motion:.95},smooth:{pixels:786432,dpr:1.1,motion:1}};
    if(!profiles[quality])quality='auto';
    var animateWater=opts.animateWater===true&&!reduced&&!opts.compatibility;
    function schedule(){if(!disposed&&!contextLost&&!document.hidden&&(visible||state.mode==='descending')&&!raf)raf=requestAnimationFrame(loop);}
    function isIsoMode(){return state.mode==='map'||state.mode==='focus';}
    function activeCamera(){return isIsoMode()?iso:camera;}
    // Syncing here keeps the orthographic camera's matrices current for every entry
    // point (mode change, resize, snapshot restore, zoom step), not just the next
    // animation frame, so pointer picking cannot run against a stale frustum.
    function invalidate(){if(isIsoMode())syncIsoCamera();dirty=true;schedule();}
    var up=new T.Vector3(0,1,0),axisX=new T.Vector3(1,0,0),axisY=new T.Vector3(0,1,0);
    var raycaster=new T.Raycaster(),pointer=new T.Vector2(),groundPlane=new T.Plane(up,0);
    var key=new T.DirectionalLight(0xfff0d7,1.65),fill=new T.DirectionalLight(0xc3ddff,.40),hemisphere=new T.HemisphereLight(0xd8eeff,0x596752,.90);
    scene.add(hemisphere);
    scene.add(key,key.target,fill);fill.position.set(3,-1,-2);key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);key.shadow.radius=1.8;
    var story,map=null;try{story=window.MarioStoryWorld.build(T,globe,opts);}catch(error){renderer.dispose();if(renderer.forceContextLoss)renderer.forceContextLoss();throw error;}
    var state={mode:'overview',selected:null,region:null,autoRotate:!!opts.autoRotate&&!reduced,
      yaw:opts.initialYaw||0,pitch:opts.initialPitch===undefined?.16:opts.initialPitch,
      targetYaw:0,targetPitch:.16,distance:overviewDistance,targetDistance:overviewDistance,
      mapDistance:135,mapTargetDistance:42,mapTarget:new T.Vector3(),mapDesired:new T.Vector3(),
      dragging:false,moved:0,hover:null,transitionTime:0,pending:null,fade:1,activePlace:null,activeNpc:null,focusNpc:null,focusNpcPosition:null};
    // mapView stays public state (snapshots, opts.onMapViewChange, getMapView()) but a
    // fixed isometric camera cannot swing to an "immersive" compass direction, so the
    // recorded value no longer moves the eye.
    var mapViews=['overview','immersive'],mapView=opts.mapView==='overview'?'overview':'immersive';
    var look=new T.Vector3(),shadowSun=new T.Vector3(99,99,99),shadowWeather='';
    function setMapView(value){if(mapViews.indexOf(value)<0)return;mapView=value;invalidate();if(opts.onMapViewChange)opts.onMapViewChange(value);}
    var geography=window.MarioWorldGeography;
    var regionColors={snow:'#6cabc4',desert:'#bb8d4c',lava:'#b56b64',forest:'#54885b',gardens:'#c98b54',canyon:'#b86c48',lake:'#4f91b5'};
    var orbitRegions=geography.regions.map(function(g){var n=nodes.find(function(n){return n.id===g.id;});return{id:g.id,name:n?(n.short||n.name):g.name,lat:g.lat,lon:g.lon,color:n?n.color:regionColors[g.id]||'#54885b'};});
    function wholeMapDistance(){var b=geography.bounds,aspect=Math.max(.4,viewWidth/viewHeight);return Math.max(geography.mapOverviewDistance||165,(b.maxX-b.minX)/(.53*aspect));}
    /* --- orthographic mainland framing ------------------------------------- */
    function isoWholeDistance(){return wholeMapDistance();}
    /* Real terrain relief, sampled from the shared geography, so near/far and the fog
       band cover every structure even before (and without) the map group or any optional
       detail module being present. */
    function isoHeightRange(){
      if(isoHeights)return isoHeights;
      var b=geography.bounds,lo=Infinity,hi=-Infinity,i,j,h;
      for(i=0;i<=24;i++)for(j=0;j<=24;j++){
        h=geography.heightAt(b.minX+(b.maxX-b.minX)*i/24,b.minZ+(b.maxZ-b.minZ)*j/24);
        if(h<lo)lo=h;if(h>hi)hi=h;
      }
      if(!isFinite(lo)||!isFinite(hi)){lo=-1;hi=14;}
      return (isoHeights={min:lo,max:hi});
    }
    function isoAspect(){return Math.max(.15,(viewWidth||800)/(viewHeight||800));}
    /* Whole-island frustum at zoom 1; only the viewport aspect changes it. Framing uses
       the footprint plane (the 204×174 rectangle the user measures), depth uses the real
       terrain slab so no hill or building is clipped by the near/far planes. */
    // The map bounds are a rectangle of sea around a rounded island, so fitting
    // them leaves the land at ~60% of the frame. The isometric plate wants the
    // island to fill the frame instead, so the fit uses the land extent measured
    // from the shared height field (falling back to the bounds when the map is
    // missing or the sampled land area is implausibly small).
    var isoLand=null,isoLandKey='';
    function landBounds(){
      var b=geography.bounds,sea=geography.seaLevel||.48;
      var key=b.minX+':'+b.maxX+':'+b.minZ+':'+b.maxZ+':'+sea+':'+(map?'1':'0');
      if(isoLand&&isoLandKey===key)return isoLand;
      var minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,hits=0,i,j,x,z;
      for(i=0;i<=48;i++)for(j=0;j<=48;j++){
        x=b.minX+(b.maxX-b.minX)*i/48;z=b.minZ+(b.maxZ-b.minZ)*j/48;
        if(!map||map.heightAt(x,z)<sea+.6)continue;
        hits++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;
      }
      var full=(b.maxX-b.minX)*(b.maxZ-b.minZ);
      isoLand=(hits>40&&(maxX-minX)*(maxZ-minZ)>full*.25)?{minX:minX,maxX:maxX,minZ:minZ,maxZ:maxZ}:{minX:b.minX,maxX:b.maxX,minZ:b.minZ,maxZ:b.maxZ};
      isoLandKey=key;
      return isoLand;
    }
    function isoBaseFrustum(){
      var aspect=isoAspect(),heights=isoHeightRange(),frame=map?landBounds():geography.bounds;
      if(!isoBase||isoBase.aspect!==aspect||isoBase.minY!==heights.min||isoBase.maxY!==heights.max||isoBase.frame!==frame||isoBase.yaw!==isoYaw){
        var direction=isoEyeFor(isoYaw);
        isoBase=isoFrustum(frame,0,0,aspect,1,direction);
        isoBase.depth=Math.max(isoBase.depth,isoExtents(frame,heights.min,heights.max,direction).depth);
        isoBase.aspect=aspect;isoBase.minY=heights.min;isoBase.maxY=heights.max;isoBase.frame=frame;isoBase.yaw=isoYaw;
      }
      return isoBase;
    }
    /* Places the orthographic camera for the current target and zoom. Map mode used to
       call camera.setViewOffset() to dodge the story sidebar; on an orthographic
       projection that shears the image instead of panning it, so the same 15%/17% of
       viewport is applied here as a world-space translation of both the eye and its
       aim (shift = fraction × frustum extent). */
    function syncIsoCamera(){
      if(!geography||!state)return isoView;
      isoEyeDirection=isoEyeFor(isoYaw);
      var base=isoBaseFrustum(),zoom=zoomForDistance(state.mapDistance,isoWholeDistance());
      var halfHeight=base.height/(2*Math.max(.05,zoom)),halfWidth=halfHeight*isoAspect();
      var panRight=0,panUp=0;
      if((state.selected||state.activePlace)&&window.innerWidth>800)panRight=halfWidth*2*.15;
      else if(state.activePlace&&window.innerWidth<=560)panUp=-halfHeight*2*.17;
      isoAim.copy(state.mapTarget).addScaledVector(base.right,panRight).addScaledVector(base.up,panUp);
      iso.position.copy(isoAim).addScaledVector(isoEyeDirection,ISO.distance);
      iso.up.set(0,1,0);iso.lookAt(isoAim);
      iso.left=-halfWidth;iso.right=halfWidth;iso.top=halfHeight;iso.bottom=-halfHeight;
      // near/far are only depth planes: they must contain the island for any pan and
      // stay generous enough that the environment's sky dome (0.8×far, capped at 420)
      // still encloses tall portrait frustums.
      iso.near=Math.max(.05,ISO.distance-base.depth-ISO.nearSlack);
      iso.far=ISO.distance+base.depth+ISO.farSlack;
      iso.updateProjectionMatrix();iso.updateMatrixWorld(true);
      isoView.zoom=zoom;isoView.halfHeight=halfHeight;isoView.halfWidth=halfWidth;
      isoView.height=halfHeight*2;isoView.width=halfWidth*2;isoView.near=iso.near;isoView.far=iso.far;
      return isoView;
    }
    /* Continuous zoom. The factor is applied to the current zoom and the result is
       clamped between the whole-island framing and ISO.zoomMax, so pinching or rolling
       glides instead of jumping, and no amount of input can push the eye through the
       terrain: the orthographic eye stays ISO.distance from its target at every level.
       Returning false at the ends keeps the caller from re-rendering for nothing. */
    function zoomIso(factor){
      var whole=isoWholeDistance(),level=zoomForDistance(state.mapTargetDistance,whole);
      var next=THREE.MathUtils.clamp(level*(isFinite(factor)&&factor>0?factor:1),ISO.zooms[0],ISO.zoomMax);
      if(Math.abs(next-level)<1e-4)return false;
      state.mapTargetDistance=distanceForZoom(next,whole);
      return true;
    }
    /* Half turn: the camera keeps its elevation and its distance, only the azimuth
       flips, so the user can look at the backs of the buildings. The eased value drives
       the camera; the target is what snapshots and getIsoYaw report. */
    function rotateIso(direction){
      if(!isIsoMode())return false;
      var next=Math.abs(isoYawTarget)>Math.PI/2?0:Math.PI;
      if(Math.abs(next-isoYawTarget)<1e-6&&Math.abs(isoYaw-next)<1e-4)return false;
      isoYawTarget=next;invalidate();return true;
    }
    function setIsoYaw(value){
      var next=isFinite(value)?Math.max(0,Math.min(Math.PI,value)):0;
      isoYaw=isoYawTarget=next;invalidate();return true;
    }
    function getIsoYaw(){return isoYaw;}
    /* Discrete step, kept for the keyboard shortcuts and the accessibility buttons:
       the wheel and pinch use zoomIso so they feel like a camera, not a slide deck. */
    function stepIsoZoom(closer){
      var whole=isoWholeDistance(),level=zoomForDistance(state.mapTargetDistance,whole);
      var next=null,i,value,list=ISO.zooms.concat([ISO.zoomMax]);
      for(i=0;i<list.length;i++){
        value=list[i];
        if(closer?value>level+.001:value<level-.001){if(next===null||(closer?value<next:value>next))next=value;}
      }
      if(next===null)return false;
      state.mapTargetDistance=distanceForZoom(next,whole);
      return true;
    }
    var environment=window.MarioWorldEnvironment?window.MarioWorldEnvironment.create(T,scene,{camera:camera,key:key,fill:fill,hemisphere:hemisphere,reducedMotion:reduced,quality:quality}):null,environmentAnimating=false;
    if(environment&&opts.environment)environment.configure(opts.environment);
    var pinHost=opts.pinHost,labels={},markers={},pointerPoints=new Map(),lastX=0,lastY=0,pinchDistance=0;
    var listeners=[],handoffPending=false,handoffActive=false,handoffTime=0,transitionFrame=null,coastRequested=false;
    function captureTransition(fresh){
      if(reduced||!canvas.parentElement||!canvas.parentElement.appendChild)return false;
      if(!transitionFrame){transitionFrame=document.createElement('canvas');transitionFrame.className='world-transition-frame';transitionFrame.setAttribute('aria-hidden','true');canvas.parentElement.appendChild(transitionFrame);}
      var context=transitionFrame.getContext('2d');if(!context||!context.drawImage)return false;
      if(fresh){var frameCamera=activeCamera();(mapGroup.visible?mapGroup:globe).updateMatrixWorld(true);frameCamera.updateMatrixWorld(true);renderer.render(scene,frameCamera);frames++;}
      transitionFrame.width=canvas.width;transitionFrame.height=canvas.height;context.drawImage(canvas,0,0);transitionFrame.hidden=false;transitionFrame.style.opacity='1';handoffTime=0;handoffActive=true;return true;
    }
    function finishTransition(){handoffActive=false;handoffTime=0;if(transitionFrame){transitionFrame.hidden=true;transitionFrame.width=transitionFrame.height=1;}}
    function setEnvironment(value){if(!environment)return;environment.configure(value);invalidate();if(opts.onEnvironmentChange)opts.onEnvironmentChange(environment.getState());}
    function listen(el,name,fn,options){var handler=function(e){if(contextLost&&['pointerdown','pointermove','pointerup','wheel','keydown'].includes(name)){if(e.cancelable)e.preventDefault();return;}if(fn(e)!==false)invalidate();};el.addEventListener(name,handler,options);listeners.push(function(){el.removeEventListener(name,handler,options);});}
    function freeze(root){root.traverse(function(o){if(o!==root){o.updateMatrix();o.matrixAutoUpdate=false;}});root.updateMatrixWorld(true);}
    function releaseGpu(root){
      var geos=new Set(),mats=new Set(),textures=new Set();
      root.traverse(function(o){if(o.geometry)geos.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(function(m){mats.add(m);['map','normalMap','roughnessMap','alphaMap'].forEach(function(k){if(m[k])textures.add(m[k]);});if(m.uniforms)Object.keys(m.uniforms).forEach(function(k){var value=m.uniforms[k].value;if(value&&value.isTexture)textures.add(value);});});});
      geos.forEach(function(g){g.dispose();});textures.forEach(function(t){t.dispose();});mats.forEach(function(m){m.dispose();});
      if(renderer.renderLists)renderer.renderLists.dispose();
    }
    function activateGpu(name){if(name===gpuResident)return;releaseGpu(gpuResident==='globe'?globe:mapGroup);gpuResident=name;}
    function geometryBytes(root){var geos=new Set(),bytes=0;root.traverse(function(o){var g=o.geometry;if(!g||geos.has(g))return;geos.add(g);Object.keys(g.attributes).forEach(function(k){bytes+=g.attributes[k].array.byteLength;});if(g.index)bytes+=g.index.array.byteLength;});return bytes;}
    /* `distance` is the public map scalar and already encodes the isometric zoom tier;
       `zoom` records the resolved tier so a restored view reports the same framing even
       if the viewport aspect (and therefore the whole-island distance) changed. */
    function snapshot(){return{mode:state.mode==='descending'?'map':state.mode,region:state.mode==='descending'?state.pending:state.region,selected:state.selected,place:state.activePlace,npc:state.activeNpc,yaw:state.yaw,pitch:state.pitch,distance:state.mode==='descending'?42:(state.mode==='map'||state.mode==='focus')?state.mapTargetDistance:state.targetDistance,zoom:isIsoMode()?zoomForDistance(state.mapTargetDistance,isoWholeDistance()):null,target:state.mode==='descending'?null:state.mapDesired.toArray(),isoYaw:isoYawTarget,environment:environment?environment.getState():null,mapView:mapView};}
    function notifyMode(){if(opts.onModeChange)opts.onModeChange(state.mode,state.region);}
    function notifyRegion(id){
      state.region=id;
      var region=map&&map.regions.find(function(r){return r.id===id;});
      if(opts.onRegionChange)opts.onRegionChange(region||orbitRegions.find(function(r){return r.id===id;}));
      Object.keys(labels).forEach(function(k){labels[k].setAttribute('aria-pressed',String(k===id));});
    }
    function shadowScale(large){
      if(renderer.shadowMap){renderer.shadowMap.enabled=!!large&&opts.shadows!==false&&window.innerWidth>800&&!opts.compatibility&&quality!=='smooth';key.shadow.mapSize.setScalar(quality==='detail'?2048:1024);}
      key.intensity=large?2.05:1.65;fill.intensity=large?.16:.40;renderer.toneMappingExposure=large?1.00:1.10;
      key.position.set(large?-65:-3.5,large?110:5,large?85:5);key.target.position.set(0,0,0);
      var size=large?140:2;
      Object.assign(key.shadow.camera,{left:-size,right:size,top:size,bottom:-size,near:large?1:.5,far:large?330:14});
      key.shadow.camera.updateProjectionMatrix();key.shadow.bias=large?-.0003:-.00015;key.shadow.normalBias=large?.035:.0015;
      if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true;
      scene.updateMatrixWorld(true);
    }
    shadowScale(false);
    orbitRegions.forEach(function(r){
      var dir=latLonToVec3(r.lat,r.lon,1),anchor=new T.Group();
      anchor.position.copy(dir).multiplyScalar(story.height(dir)+.085);globe.add(anchor);
      var core=new T.Mesh(new T.SphereGeometry(.009,10,8),new T.MeshBasicMaterial({color:r.color}));core.userData.regionId=r.id;anchor.add(core);markers[r.id]=anchor;
      var n=nodes.find(function(n){return n.id===r.id;});if(n)n._anchor=anchor;
      if(!pinHost)return;
      var button=document.createElement('button');button.type='button';button.className='pin';button.dataset.id=r.id;
      button.style.setProperty('--dot',r.color);button.setAttribute('aria-label','进入'+r.name+'地图');
      var dot=document.createElement('span');dot.className='pin-dot';dot.setAttribute('aria-hidden','true');
      var name=document.createElement('span');name.className='pin-name';name.textContent=r.name;
      button.appendChild(dot);button.appendChild(name);button.addEventListener('click',function(e){e.stopPropagation();enterRegion(r.id);});
      pinHost.appendChild(button);labels[r.id]=button;
    });
    if(window.MarioRenderQuality){if(!environment)window.MarioRenderQuality.fastWater(T,story.ocean,true);window.MarioRenderQuality.overview(T,globe,story,orbitRegions,latLonToVec3);window.MarioRenderQuality.optimize(T,globe);}
    if(environment)environment.attachWater(story.ocean,{kind:'globe'});
    if(window.MarioVillageLife)globeVillage=window.MarioVillageLife.build(T,globe,{kind:'globe'});
    if(window.MarioFrontierWorld)globeFrontier=window.MarioFrontierWorld.build(T,globe,{kind:'globe'});
    globe.traverse(function(o){if(o.isMesh&&(o.userData.nodeId||o.userData.regionId))globePickTargets.push(o);});
    if(globeVillage)globePickTargets=Array.from(new Set(globePickTargets.concat(globeVillage.pickTargets)));
    freeze(globe);scene.matrixWorldAutoUpdate=false;
    function ensureMap(){
      if(map)return;
      if(!window.MarioConnectedMap)throw new Error('Connected map asset did not load.');
      map=window.MarioConnectedMap.build(T,mapGroup,opts);
      if(window.MarioWorldEnrichment)enrichment=window.MarioWorldEnrichment.build(T,mapGroup,{heightAt:map.heightAt,regions:map.regions,kind:'map',reducedMotion:reduced});
      if(window.MarioVillageLife)mapVillage=window.MarioVillageLife.build(T,mapGroup,{kind:'map',heightAt:map.heightAt,places:enrichment?enrichment.places:[]});
      if(window.MarioFrontierWorld)mapFrontier=window.MarioFrontierWorld.build(T,mapGroup,{kind:'map'});
      if(window.MarioRenderQuality){if(!environment)window.MarioRenderQuality.fastWater(T,map.water,false);window.MarioRenderQuality.groundShadows(T,mapGroup,map.heightAt);window.MarioRenderQuality.optimize(T,mapGroup);}
      // Ground scatter and the island props both run after the static-material
      // pass so their own instanced materials are not rewritten. Every exclusion
      // circle comes from the real placements, not a hand-written keep-out table.
      var clearings=[];
      if(enrichment&&enrichment.buildings)enrichment.buildings.forEach(function(b){var p=b.position||b;if(p&&typeof p.x==='number')clearings.push({x:p.x,z:p.z,radius:Math.max(1.2,b.radius||1.4)});});
      if(mapVillage&&mapVillage.sites)mapVillage.sites.forEach(function(s){clearings.push({x:s.x,z:s.z,radius:Math.max(1.4,Math.max(s.width||3,s.depth||3)*.62)});});
      if(mapFrontier&&mapFrontier.sites)mapFrontier.sites.forEach(function(s){clearings.push({x:s.x,z:s.z,radius:s.kind==='landmark'?2.6:1.7});});
      if(window.MarioGroundScatter){
        try{
          groundScatter=window.MarioGroundScatter.build(T,mapGroup,{heightAt:map.heightAt,seaLevel:map.seaLevel||.48,bounds:map.bounds,routes:map.routes,buildings:clearings,regions:map.regions,reducedMotion:reduced,quality:quality});
          if(groundScatter&&groundScatter.group)groundScatter.group.traverse(function(o){if(o.isMesh)o.userData.groundDetail=true;});
        }catch(groundError){groundScatter=null;if(window.console&&console.warn)console.warn('Ground detail layer unavailable:',groundError&&groundError.message);}
      }
      if(window.MarioIslandLandmarks){
        try{
          islandLandmarks=window.MarioIslandLandmarks.build(T,mapGroup,{heightAt:map.heightAt,bounds:map.bounds,seaLevel:map.seaLevel||.48,routes:map.routes,regions:map.regions,buildings:clearings,quality:quality,reducedMotion:reduced});
        }catch(landmarkError){islandLandmarks=null;if(window.console&&console.warn)console.warn('Island landmarks unavailable:',landmarkError&&landmarkError.message);}
      }
      if(environment)environment.attachWater(map.water,{kind:'map',heightAt:map.heightAt,bounds:map.bounds,seaLevel:map.seaLevel||.48,coastField:map.coastField||(geography&&geography.coastField)});
      if(environment&&environment.attachMap)environment.attachMap(mapGroup,{heightAt:map.heightAt,bounds:map.bounds,seaLevel:map.seaLevel||.48,vertexTextures:!!(renderer.capabilities&&renderer.capabilities.maxVertexTextures>0)});
      mapGroup.traverse(function(o){if(o.isMesh&&o.userData.nodeId)mapPickTargets.push(o);});if(enrichment)mapPickTargets=Array.from(new Set(mapPickTargets.concat(enrichment.pickTargets)));
      if(mapVillage)mapPickTargets=Array.from(new Set(mapPickTargets.concat(mapVillage.pickTargets)));
      if(mapFrontier)mapPickTargets=Array.from(new Set(mapPickTargets.concat(mapFrontier.pickTargets)));
      if(enrichment&&pinHost)enrichment.places.forEach(function(place){var npc=enrichment.npcs.find(function(n){return n.placeId===place.id;}),button=document.createElement('button');button.type='button';button.className='resident-pin';button.hidden=true;button.textContent=place.npcName;button.setAttribute('aria-label','与'+place.npcName+'交流，体验'+place.title);button.addEventListener('click',function(e){e.stopPropagation();if(npc)focusResident(npc.id,null);openPlace(place.id,npc&&npc.id);});pinHost.appendChild(button);residentLabels.push({button:button,place:place,npc:npc});});
      freeze(mapGroup);
    }
    function closeStory(){
      state.selected=null;
      if(state.mode==='focus'){state.mode='map';notifyMode();}
      if(opts.onSelect)opts.onSelect(null);
      // Invalidate last: closing a story also removes the sidebar pan, and the camera
      // must be re-aimed before anything can pick against it.
      invalidate();
    }
    function navigate(id,first){
      try{ensureMap();}catch(error){state.mode='overview';if(opts.onFatalError){opts.onFatalError(error);return;}throw error;}
      var region=map.regions.find(function(r){return r.id===id;});if(!region)return;
      closePlace();warmFrames=0;closeStory();state.mode='map';activateGpu('map');globe.visible=false;mapGroup.visible=true;
      state.mapDesired.copy(region.position);state.mapDesired.y+=1.5;
      state.mapTargetDistance=['forest','gardens','canyon','lake'].includes(id)?62:['snow','desert','lava'].includes(id)?57:42;
      if(first){state.mapTarget.copy(state.mapDesired);state.mapDistance=reduced?state.mapTargetDistance:68;state.fade=1;}
      if(reduced){state.mapTarget.copy(state.mapDesired);state.mapDistance=state.mapTargetDistance;}
      // Fog is measured from the orthographic eye, which always sits ISO.distance from
      // the target, so the island occupies a fixed depth slab (ISO.distance ± ~116).
      // This band is what the environment produces when it is handed the same true
      // distance (its presets are offset by max(0, distance-120)); using it here as well
      // keeps the frame readable without the environment module: ~7% haze at the target
      // depth and ~64% at the far corner, so the whole island is never washed out while
      // close-ups still gain depth. Overriding the environment's own fog object is
      // deliberately avoided - one mechanism (the distance) drives near/far.
      shadowScale(true);scene.fog=new T.Fog(0xe9f6ff,isoFogNear(),isoFogFar());
      canvas.style.touchAction='none';notifyRegion(id);notifyMode();invalidate();
      if(placeRequest){var pendingPlace=placeRequest;placeRequest=null;openPlace(pendingPlace.id,pendingPlace.npcId);}
      if(coastRequested){coastRequested=false;openCoast();}
    }
    function openCoast(){
      if(contextLost)return;
      if(state.mode==='overview'||state.mode==='descending'){coastRequested=true;enterRegion('connection',true);return;}
      closePlace();closeStory();setMapView('immersive');state.mapDesired.set(-18,Math.max(.48,map.heightAt(-18,74))+1.5,74);state.mapTargetDistance=65;notifyRegion('connection');
      if(reduced){state.mapTarget.copy(state.mapDesired);state.mapDistance=65;}invalidate();
    }
    function enterRegion(id,forCoast){
      if(contextLost)return;
      if(!forCoast)coastRequested=false;
      invalidate();
      if(!orbitRegions.some(function(r){return r.id===id;}))return;
      if(state.mode==='overview'||state.mode==='descending'){
        finishTransition();handoffPending=false;state.pending=id;state.selected=null;state.mode='descending';state.transitionTime=0;
        var r=orbitRegions.find(function(r){return r.id===id;}),d=latLonToVec3(r.lat,r.lon,1);
        state.targetYaw=Math.atan2(d.x,d.z);state.targetPitch=Math.asin(d.y)-.22;state.targetDistance=1.95;
        if(opts.onSelect)opts.onSelect(null);notifyMode();
        if(reduced)navigate(id,true);
      }else navigate(id,false);
      invalidate();
    }
    function overview(immediate){
      if(contextLost)return;
      var returning=state.mode==='map'||state.mode==='focus',region=orbitRegions.find(function(r){return r.id===state.region;});
      finishTransition();handoffPending=false;coastRequested=false;if(returning&&!immediate&&!reduced)captureTransition(true);
      if(region){var d=latLonToVec3(region.lat,region.lon,1);state.yaw=Math.atan2(d.x,d.z);state.pitch=Math.asin(d.y)-.22;}
      closePlace();warmFrames=0;activateGpu('globe');invalidate();
      state.mode='overview';state.selected=null;state.pending=null;state.region=null;state.fade=1;
      state.distance=returning&&!immediate&&!reduced?2.1:overviewDistance;state.targetDistance=overviewDistance;
      globe.visible=true;mapGroup.visible=false;scene.fog=null;look.set(0,0,0);
      canvas.style.opacity='1';canvas.style.touchAction=opts.zoom?'none':'pan-y';
      shadowScale(false);
      if(opts.onSelect)opts.onSelect(null);notifyMode();
    }
    function select(id){
      if(contextLost)return;
      closePlace();invalidate();var node=nodes.find(function(n){return n.id===id;});if(!node)return;
      if(state.mode==='overview'||state.mode==='descending'){enterRegion(id);return;}
      state.mode='focus';state.selected=id;
      state.mapDesired.copy(map.focusPoints[id]||map.regions.find(function(r){return r.id===id;}).position);
      state.mapDesired.y+=1.5;state.mapTargetDistance=34;
      if(reduced){state.mapTarget.copy(state.mapDesired);state.mapDistance=state.mapTargetDistance;}
      notifyRegion(id);notifyMode();if(opts.onSelect)opts.onSelect(node);
      invalidate();
    }
    function mapOverview(){
      if(contextLost)return;
      closePlace();invalidate();if(!map||state.mode==='overview')return;
      closeStory();setMapView('overview');state.mapDesired.set(-2,map.heightAt(-2,0)+1,0);state.mapTargetDistance=wholeMapDistance();state.region=null;
      // Entering the island from a deep link or the whole-map button never runs
      // navigate(), so the wide shadow frustum has to be armed here as well.
      if(!reduced){shadowScale(true);scene.fog=new T.Fog(0xe9f6ff,isoFogNear(),isoFogFar());}
      Object.keys(labels).forEach(function(id){labels[id].setAttribute('aria-pressed','false');});
      if(opts.onRegionChange)opts.onRegionChange({id:'world',name:'大陆全貌'});
      if(reduced){state.mapTarget.copy(state.mapDesired);state.mapDistance=state.mapTargetDistance;}
      // The whole-island framing is a state change of its own, so re-aim before the next
      // frame (or the next pick) can run against the previous region's frame.
      invalidate();
    }
    function clear(){if(state.activePlace){closePlace();return;}if(state.mode==='map'||state.mode==='focus')closeStory();else overview();}
    /* Resident close-up. The instance matrices are animated by the village layer, so the
       caller may pass the live world position; without one the resident list is the last
       known placement, which is within a metre of where the walk cycle has them. */
    function residentPosition(npcId){
      if(!npcId)return null;
      var lists=[mapVillage&&mapVillage.residents,mapFrontier&&mapFrontier.residents,enrichment&&enrichment.npcs],i,j,entry,px,pz;
      for(i=0;i<lists.length;i++){
        var list=lists[i];if(!list)continue;
        for(j=0;j<list.length;j++){
          entry=list[j];if(!entry)continue;
          if(entry.id!==npcId&&entry.npcId!==npcId)continue;
          px=entry.x!==undefined?entry.x:(entry.position?entry.position.x:NaN);
          pz=entry.z!==undefined?entry.z:(entry.position?entry.position.z:NaN);
          if(isFinite(px)&&isFinite(pz))return{x:px,z:pz};
        }
      }
      return null;
    }
    function focusResident(npcId,worldPosition){
      if(!map||!isIsoMode())return false;
      var target=worldPosition&&isFinite(worldPosition.x)&&isFinite(worldPosition.z)?worldPosition:null;
      if(!target){var found=residentPosition(npcId);if(!found)return false;target={x:found.x,z:found.z,y:map.heightAt(found.x,found.z)};}
      var groundY=isFinite(target.y)?target.y:map.heightAt(target.x,target.z);
      state.focusNpc=npcId||'resident';
      state.focusNpcPosition={x:target.x,y:groundY,z:target.z};
      state.mapDesired.set(target.x,groundY+0.9,target.z);
      state.mapTargetDistance=distanceForZoom(ISO.focusZoom,isoWholeDistance());
      clampMap();invalidate();return true;
    }
    function exitResidentFocus(){
      if(!state.focusNpc)return false;
      var resumePlace=state.activePlace;
      state.focusNpc=null;state.focusNpcPosition=null;
      if(resumePlace&&map){var anchor=map.focusPoints&&map.focusPoints[resumePlace];if(anchor)state.mapDesired.copy(anchor);}
      state.mapTargetDistance=distanceForZoom(ISO.zooms[1],isoWholeDistance());
      invalidate();return true;
    }
    function getResidentFocus(){
      if(!state.focusNpc)return null;
      return{npcId:state.focusNpc,position:state.focusNpcPosition?{x:state.focusNpcPosition.x,y:state.focusNpcPosition.y,z:state.focusNpcPosition.z}:null,zoom:zoomForDistance(state.mapTargetDistance,isoWholeDistance())};
    }
    function closePlace(){if(!state.activePlace)return;var resumePlace=state.activePlace;state.activePlace=null;state.activeNpc=null;extraAnimation=false;
      if(state.focusNpc){state.focusNpc=null;state.focusNpcPosition=null;var anchor=map&&map.focusPoints&&map.focusPoints[resumePlace];if(anchor)state.mapDesired.copy(anchor);state.mapTargetDistance=distanceForZoom(ISO.zooms[1],isoWholeDistance());}
      if(opts.onPlaceSelect)opts.onPlaceSelect(null);invalidate();}
    function openPlace(id,npcId){
      if(contextLost)return;
      if(!map&&(state.mode==='overview'||state.mode==='descending')){var demo=window.MarioDemoBusinesses&&window.MarioDemoBusinesses.get(id);if(demo){placeRequest={id:id,npcId:npcId};enterRegion(demo.region);}return;}
      ensureMap();if(!enrichment)return;var place=enrichment.places.find(function(p){return p.id===id;});if(!place)return;
      if(state.mode==='overview'||state.mode==='descending'){placeRequest={id:id,npcId:npcId};enterRegion(place.region);return;}
      closeStory();state.activePlace=id;state.activeNpc=npcId||id;
      // A resident close-up keeps its own framing; only a plain building click re-aims.
      if(!state.focusNpc){state.mapDesired.copy(place.position);state.mapDesired.y+=1.6;state.mapTargetDistance=window.innerWidth<680?43:30;}
      if(reduced){state.mapTarget.copy(state.mapDesired);state.mapDistance=state.mapTargetDistance;}
      extraAnimation=!reduced;notifyRegion(place.region);if(opts.onPlaceSelect){var resident=enrichment.npcs.find(function(n){return n.id===npcId;});opts.onPlaceSelect(resident?Object.assign({},place,{npcName:resident.name}):place,npcId);}invalidate();
    }
    function clampMap(){
      var b=map.bounds;
      state.mapDesired.x=T.MathUtils.clamp(state.mapDesired.x,b.minX,b.maxX);
      state.mapDesired.z=T.MathUtils.clamp(state.mapDesired.z,b.minZ,b.maxZ);
      state.mapDesired.y=map.heightAt(state.mapDesired.x,state.mapDesired.z)+1.5;
    }
    // Picking always runs against the live camera. The orthographic camera is synced
    // first: its frustum and matrixWorld must match what the last frame drew before
    // Raycaster can unproject the pointer.
    function setPointer(x,y){var r=state.dragging&&pointerRect?pointerRect:canvas.getBoundingClientRect();if(isIsoMode())syncIsoCamera();pointer.set((x-r.left)/r.width*2-1,-((y-r.top)/r.height)*2+1);raycaster.setFromCamera(pointer,activeCamera());}
    function groundPoint(x,y){setPointer(x,y);groundPlane.constant=-state.mapTarget.y;return raycaster.ray.intersectPlane(groundPlane,new T.Vector3());}
    function pick(x,y){
      setPointer(x,y);var root=isIsoMode()?mapGroup:globe;
      var hits=raycaster.intersectObjects(root===mapGroup?mapPickTargets:globePickTargets,false);
      for(var i=0;i<hits.length;i++){
        var o=hits[i].object,p=o,role=null,hidden=false;for(var ancestor=o;ancestor&&ancestor!==root;ancestor=ancestor.parent){if(!ancestor.visible){hidden=true;break;}}if(hidden)continue;
        // The orthographic eye is ISO.distance away, so a fixed 1.5 unit march would cost
        // ~160 heightAt calls per hit. The step stays 1.5 for close perspective views and
        // is stretched only as far as needed to cap the march at 64 probes.
        if(root===mapGroup){var terrainBlocked=false,span=Math.max(0,hits[i].distance-.35),stride=Math.max(1.5,span/64);for(var distance=1;distance<span;distance+=stride){var probe=raycaster.ray.at(distance,new T.Vector3());if(probe.y<map.heightAt(probe.x,probe.z)-.10){terrainBlocked=true;break;}}if(terrainBlocked)continue;}else if(hits[i].point.dot(camera.position)<0)continue;
        if(window.MarioWorldEnrichment){var extraHit=window.MarioWorldEnrichment.resolveHit(hits[i]);if(extraHit)return extraHit;}
        while(p&&p!==root){if(p.userData.nodeId||p.userData.regionId){role=p.userData.nodeId||p.userData.regionId;break;}p=p.parent;}
        if(role)return role;
        if(o.isSprite||o.material&&o.material.transparent)continue;
        return null;
      }
      return null;
    }
    listen(canvas,'pointerdown',function(e){
      if(e.button!==undefined&&e.button!==0)return;
      pointerRect=canvas.getBoundingClientRect();pointerPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointerPoints.size===1){state.dragging=true;state.moved=0;lastX=e.clientX;lastY=e.clientY;canvas.classList.add('is-dragging');}
      if(pointerPoints.size===2){var ps=Array.from(pointerPoints.values());pinchDistance=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);}
      try{canvas.setPointerCapture(e.pointerId);}catch(_){}
    });
    listen(canvas,'pointermove',function(e){
      if(pointerPoints.has(e.pointerId))pointerPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(state.dragging){
        var dx=e.clientX-lastX,dy=e.clientY-lastY;state.moved+=Math.abs(dx)+Math.abs(dy);
        if(pointerPoints.size>1&&map&&state.mode!=='overview'){
          // Pinch steps between the same three framings as the wheel: the baseline is
          // only re-armed when a step lands, so the ratio can accumulate across moves.
          var ps=Array.from(pointerPoints.values()),d=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
          if(d>0&&pinchDistance>0){
            var pinch=d/pinchDistance;
            if(Math.abs(pinch-1)>.01){zoomIso(pinch);pinchDistance=d;}
          }else pinchDistance=d;
        }else if(state.mode==='overview'){
          state.yaw-=dx*.006;state.pitch=T.MathUtils.clamp(state.pitch+dy*.006,-1.1,1.1);
        }else if(isIsoMode()){
          // Pan only: the isometric camera has no rotation input at all, the ground-plane
          // delta is projected through the orthographic ray and clamped to the bounds.
          if(state.moved>6&&state.selected)closeStory();if(state.moved>6&&state.activePlace)closePlace();
          var a=groundPoint(lastX,lastY),b=groundPoint(e.clientX,e.clientY);
          if(a&&b)state.mapDesired.add(a.sub(b));
          clampMap();
        }
        lastX=e.clientX;lastY=e.clientY;return;
      }
      if(e.pointerType==='touch')return false;
      var now=performance.now();if(state.lastHoverAt&&now-state.lastHoverAt<100)return false;
      var hit=pick(e.clientX,e.clientY);state.lastHoverAt=performance.now();canvas.classList.toggle('is-hovering',!!hit);
      if(state.hover!==hit){state.hover=hit;if(opts.onHover)opts.onHover(nodes.find(function(n){return n.id===hit;})||null);}
      return false;
    });
    function release(e,cancel){
      pointerPoints.delete(e.pointerId);
      if(pointerPoints.size){var p=Array.from(pointerPoints.values())[0];lastX=p.x;lastY=p.y;state.moved=100;return;}
      if(!state.dragging)return;state.dragging=false;pointerRect=null;canvas.classList.remove('is-dragging');
      if(cancel||state.moved>6||state.mode==='descending')return;
      var hit=pick(e.clientX,e.clientY);
      if(hit){if(typeof hit==='object'){if(hit.npcId)focusResident(hit.npcId,null);openPlace(hit.placeId||hit.businessId,hit.npcId);}else if(state.mode==='overview'||!nodes.some(function(n){return n.id===hit;}))enterRegion(hit);else select(hit);}
      else if(state.mode==='focus')closeStory();
    }
    listen(canvas,'pointerup',function(e){release(e,false);});listen(canvas,'pointercancel',function(e){release(e,true);});
    listen(canvas,'wheel',function(e){
      if(isIsoMode()){e.preventDefault();zoomIso(Math.exp(-e.deltaY*.0016));}
      else if(opts.zoom&&state.mode==='overview'){e.preventDefault();state.targetDistance=T.MathUtils.clamp(state.targetDistance+e.deltaY*.002,3.6,6.5);}
    },{passive:false});
    canvas.tabIndex=0;
    listen(canvas,'keydown',function(e){
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home','r','R'].includes(e.key))return;
      e.preventDefault();
      if(isIsoMode()){
        if(e.key==='r'||e.key==='R'){rotateIso(1);return;}
        var step=state.mapTargetDistance*.065;
        if(e.key==='ArrowLeft')state.mapDesired.x-=step;if(e.key==='ArrowRight')state.mapDesired.x+=step;
        if(e.key==='ArrowUp')state.mapDesired.z-=step;if(e.key==='ArrowDown')state.mapDesired.z+=step;
        if(e.key==='+'||e.key==='=')zoomIso(1.35);
        if(e.key==='-')zoomIso(1/1.35);
        if(e.key==='Home')mapOverview();else clampMap();
      }else{if(e.key==='ArrowLeft')state.yaw+=.10;if(e.key==='ArrowRight')state.yaw-=.10;if(e.key==='ArrowUp')state.pitch-=.10;if(e.key==='ArrowDown')state.pitch+=.10;}
    });
    function resize(){
      var parent=canvas.parentElement||canvas.parentNode||canvas,w=parent.clientWidth||800,h=parent.clientHeight||800;
      var viewportChanged=w!==viewWidth||h!==viewHeight;
      viewWidth=w;viewHeight=h;camera.aspect=w/h;camera.updateProjectionMatrix();
      // The orthographic frustum is refitted from the new aspect by invalidate() ->
      // syncIsoCamera() -> isoBaseFrustum(); only the map extent needs resetting here.
      if(viewportChanged&&map&&state.mode==='map'&&!state.region&&mapView==='overview'){state.mapTargetDistance=wholeMapDistance();if(reduced)state.mapDistance=state.mapTargetDistance;}
      // Resizing clears WebGL's drawing buffer. Apply it only inside the next
      // render callback, before drawing, so the compositor keeps a painted frame.
      bufferResizePending=true;invalidate();
    }
    function resizeDrawingBuffer(){
      var w=viewWidth,h=viewHeight,profile=profiles[quality],factor=resolutionMoving?profile.motion*dynamicScale:1;
      var next=Math.min(window.devicePixelRatio||1,opts.maxPixelRatio||profile.dpr,profile.dpr,Math.sqrt(profile.pixels/(w*h)))*factor;
      if(Math.abs(next-pixelRatio)>.025||canvas.width!==Math.floor(w*next)||canvas.height!==Math.floor(h*next)){pixelRatio=next;renderer.setPixelRatio(pixelRatio);renderer.setSize(w,h,false);}
      bufferResizePending=false;
    }
    function setQuality(value){if(!profiles[value])return;quality=value;dynamicScale=1;intervals=[];shadowScale(mapGroup.visible);resize();if(opts.onQualityChange)opts.onQualityChange(value);}
    var ro=null,io=null;
    if(typeof ResizeObserver==='function'){ro=new ResizeObserver(resize);ro.observe(canvas.parentElement||canvas.parentNode||canvas);}
    if(opts.pauseOffscreen&&typeof IntersectionObserver==='function'){io=new IntersectionObserver(function(entries){var r=canvas.getBoundingClientRect();visible=entries[0].isIntersecting||(r.width>0&&r.height>0&&r.bottom>0&&r.top<window.innerHeight&&r.right>0&&r.left<window.innerWidth);if(visible)invalidate();else if(raf&&state.mode!=='descending'){cancelAnimationFrame(raf);raf=0;}},{threshold:.01});io.observe(canvas);}
    // R also works when the canvas is not focused, which is what people expect from a
    // shortcut; typing into a form field or using a browser chord is left alone.
    listen(window,'keydown',function(e){
      if(!isIsoMode())return;
      var tag=(e.target&&e.target.tagName)||'';
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(tag)||e.metaKey||e.ctrlKey||e.altKey)return;
      if(e.key==='r'||e.key==='R'){e.preventDefault();rotateIso(1);}
    });
    listen(window,'resize',resize);
    listen(document,'visibilitychange',function(){if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;return false;}lastRenderAt=performance.now();});
    function recoveryTimeout(){if(disposed||!contextLost)return;if(document.hidden||!visible){recoveryTimer=setTimeout(recoveryTimeout,3000);return;}if(opts.onRecoverNeeded)opts.onRecoverNeeded(lostSnapshot);}
    listen(canvas,'webglcontextlost',function(e){e.preventDefault();contextLost=true;contextLosses++;lostSnapshot=snapshot();pointerPoints.clear();state.dragging=false;canvas.classList.remove('is-dragging');if(raf)cancelAnimationFrame(raf);raf=0;if(opts.onContextState)opts.onContextState('lost',lostSnapshot);recoveryTimer=setTimeout(recoveryTimeout,opts.recoveryTimeout||7000);return false;});
    listen(canvas,'webglcontextrestored',function(){if(recoveryTimer)clearTimeout(recoveryTimer);recoveryTimer=0;contextLost=false;if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true;if(opts.onContextState)opts.onContextState('restored',lostSnapshot);lastRenderAt=-1000;});
    /* Restores a snapshot. In isometric terms that is the map target plus a zoom tier:
       `distance` is the public scalar that encodes the tier, `zoom` is accepted as a
       fallback so a snapshot taken at a different aspect (and therefore a different
       whole-island distance) still lands on the same framing. Target and zoom are
       applied in one step, exactly like the reduced-motion path. */
    function restoreView(view){
      if(!view)return;
      isoYaw=isoYawTarget=isFinite(view.isoYaw)?Math.max(0,Math.min(Math.PI,view.isoYaw)):0;
      if(view.mapView)setMapView(view.mapView);
      if(environment&&view.environment)environment.configure(view.environment);
      if(view.mode==='overview'||view.mode==='descending'){
        overview(true);state.yaw=view.yaw||0;state.pitch=view.pitch||0;state.distance=state.targetDistance=view.distance||overviewDistance;
      }else{
        var restored=view.distance!==undefined&&view.distance!==null?view.distance:distanceForZoom(view.zoom||1,isoWholeDistance());
        navigate(view.region||'collaboration',true);
        state.region=view.region;
        if(view.place)openPlace(view.place,view.npc);
        if(view.target)state.mapDesired.fromArray(view.target);
        state.mapTarget.copy(state.mapDesired);
        state.mapDistance=state.mapTargetDistance=restored;state.fade=1;
        if(view.selected){state.selected=view.selected;state.mode='focus';if(opts.onSelect)opts.onSelect(nodes.find(function(n){return n.id===view.selected;}));}
        if(!view.region&&opts.onRegionChange)opts.onRegionChange({id:'world',name:'大陆全貌'});
        notifyMode();
      }
      invalidate();
    }
    function destroy(){if(disposed)return;disposed=true;if(raf)cancelAnimationFrame(raf);if(recoveryTimer)clearTimeout(recoveryTimer);listeners.forEach(function(stop){stop();});if(ro)ro.disconnect();if(io)io.disconnect();if(transitionFrame)transitionFrame.remove();if(environment)environment.dispose();if(groundScatter){groundScatter.dispose();groundScatter=null;}if(islandLandmarks){islandLandmarks.dispose();islandLandmarks=null;}releaseGpu(globe);releaseGpu(mapGroup);renderer.dispose();if(renderer.forceContextLoss)renderer.forceContextLoss();if(pinHost)pinHost.replaceChildren();}
    listen(window,'pagehide',function(e){if(!e.persisted)destroy();else{releaseGpu(globe);if(map)releaseGpu(mapGroup);if(raf)cancelAnimationFrame(raf);raf=0;}return false;});
    listen(window,'pageshow',function(){lastRenderAt=-1000;resize();});
    function shortAngle(a,b){var d=(b-a)%(Math.PI*2);return d>Math.PI?d-Math.PI*2:d<-Math.PI?d+Math.PI*2:d;}
    function pins(){
      if(!pinHost)return;pinsUpdates++;
      var rect={width:viewWidth,height:viewHeight},isMap=state.mode==='map'||state.mode==='focus';
      orbitRegions.forEach(function(r){
        var button=labels[r.id];if(!button)return;
        var pos;
        if(isMap){var region=map.regions.find(function(z){return z.id===r.id;});if(!region){button.style.opacity=0;return;}pos=region.position.clone();pos.y+=r.id==='collaboration'?10:r.id==='automation'?7:r.id==='connection'?6:6;}
        else pos=markers[r.id].getWorldPosition(new T.Vector3());
        var show=state.mode!=='descending';
        // On a narrow whole-map view the ten labels overlap the continent.
        // The horizontal region navigator remains available for every destination.
        if(isMap&&viewWidth<600&&state.mapDistance>150)show=false;
        if(!isMap&&pos.clone().normalize().dot(camera.position.clone().normalize())<.18)show=false;
        // Labels project through whichever camera is live: the orthographic map framing
        // changes where a region lands, the perspective globe view does not.
        var screen=pos.project(activeCamera());if(Math.abs(screen.x)>1.06||Math.abs(screen.y)>1.06||screen.z>1)show=false;
        var sx=(screen.x*.5+.5)*rect.width,sy=(-screen.y*.5+.5)*rect.height;
        if(sx<50||sx>rect.width-50||sy<18||sy>rect.height-18)show=false;
        if(button.hidden===show)button.hidden=!show;button.style.opacity=show?String(state.fade):'0';button.style.pointerEvents=show?'auto':'none';
        button.style.transform='translate('+((screen.x*.5+.5)*rect.width).toFixed(1)+'px,'+((-screen.y*.5+.5)*rect.height).toFixed(1)+'px) translate(-50%,-50%)';
        button.classList.toggle('is-active',state.region===r.id);
      });
      residentLabels.forEach(function(label){var p=(label.npc?label.npc.position:label.place.position).clone();p.y+=1.65;var screen=p.project(activeCamera()),show=isMap&&!state.activePlace&&state.mapDistance<90&&Math.abs(screen.x)<.92&&Math.abs(screen.y)<.85&&screen.z<1;label.button.hidden=!show;if(show)label.button.style.transform='translate('+((screen.x*.5+.5)*rect.width).toFixed(1)+'px,'+((-screen.y*.5+.5)*rect.height).toFixed(1)+'px) translate(-50%,-100%)';});
    }
    // The map camera can no longer orbit, so its only motion is the target easing, the
    // zoom tier easing and the fade.
    function moving(){if(state.mode==='descending')return true;if(state.mode==='overview')return Math.abs(state.distance-state.targetDistance)>.001;return Math.abs(state.mapDistance-state.mapTargetDistance)>.02||state.mapTarget.distanceToSquared(state.mapDesired)>.0004||state.fade<.999||Math.abs(isoYawTarget-isoYaw)>1e-4;}
    function loop(timestamp){
      raf=0;if(disposed||contextLost||document.hidden||(!visible&&state.mode!=='descending'))return;
      var rotating=state.mode==='overview'&&state.autoRotate&&!state.dragging;
      if(!dirty&&!moving()&&!rotating&&!animateWater&&!extraAnimation&&!environmentAnimating&&!handoffActive)return;
      var active=state.dragging||moving()||rotating||handoffActive,frameLimit=active?maxFPS:environmentAnimating?Math.min(maxFPS,environmentFPS):extraAnimation?30:maxFPS;
      if(timestamp-lastRenderAt<1000/frameLimit-1.0){schedule();return;}
      var requested=dirty,cameraChanged=active||requested||frames===0||active!==resolutionMoving||bufferResizePending;
      var gap=timestamp-lastRenderAt,dt=Math.min(.1,Math.max(.001,gap/1000));lastRenderAt=timestamp;dirty=false;animationTime+=dt;warmFrames++;
      if(active!==resolutionMoving){resolutionMoving=active;resize();dirty=false;}
      if(active&&warmFrames>6&&gap<250){intervals.push(gap);intervalTotal+=gap;if(intervals.length>=15&&intervalTotal>=500){measuredFPS=1000/(intervalTotal/intervals.length);if(quality==='auto'){var adjusted=dynamicScale;if(measuredFPS<44)adjusted=Math.max(.66,dynamicScale*.88);else if(measuredFPS>57&&drawMS<9)adjusted=Math.min(1,dynamicScale+.05);if(adjusted!==dynamicScale){dynamicScale=adjusted;resize();dirty=false;}}intervals=[];intervalTotal=0;}}
      if(bufferResizePending)resizeDrawingBuffer();
      if(cameraChanged&&(state.mode==='overview'||state.mode==='descending')){
        if(state.mode==='descending'){
          state.transitionTime+=dt;
          state.yaw+=shortAngle(state.yaw,state.targetYaw)*(1-Math.exp(-dt*7));state.pitch+=(state.targetPitch-state.pitch)*(1-Math.exp(-dt*7));
          if(state.transitionTime>=1.1)handoffPending=true;
        }else if(state.autoRotate&&!state.dragging)state.yaw+=dt*.10;
        globe.quaternion.setFromAxisAngle(axisX,state.pitch).multiply(new T.Quaternion().setFromAxisAngle(axisY,-state.yaw));
        state.distance+=(state.targetDistance-state.distance)*(1-Math.exp(-dt*4));
        camera.position.set(0,0,state.distance);look.set(0,0,0);camera.lookAt(look);
      }
      if(cameraChanged&&isIsoMode()){
        // Motion is only the target easing plus the zoom-tier easing: the orthographic
        // camera keeps its 45°/35.264° orientation, so nothing here can rotate or tilt
        // the island. The sidebar offset is applied inside syncIsoCamera as a world-space
        // pan (setViewOffset would shear an orthographic projection).
        // While a resident is being inspected the camera rides along with them: the
        // walk cycle moves a metre or two, which would otherwise slide the subject out
        // of the close-up within a couple of seconds.
        if(state.focusNpc&&mapVillage&&mapVillage.residents){
          var followed=null;
          for(var fi=0;fi<mapVillage.residents.length;fi++){if(mapVillage.residents[fi]&&mapVillage.residents[fi].id===state.focusNpc){followed=mapVillage.residents[fi];break;}}
          if(!followed&&mapFrontier&&mapFrontier.residents){for(var fj=0;fj<mapFrontier.residents.length;fj++){if(mapFrontier.residents[fj]&&mapFrontier.residents[fj].id===state.focusNpc){followed=mapFrontier.residents[fj];break;}}}
          if(followed&&isFinite(followed.x)&&isFinite(followed.z)){
            state.focusNpcPosition.x=followed.x;state.focusNpcPosition.z=followed.z;
            state.mapDesired.x=followed.x;state.mapDesired.z=followed.z;
          }
        }
        state.mapDistance+=(state.mapTargetDistance-state.mapDistance)*(1-Math.exp(-dt*5));
        state.mapTarget.lerp(state.mapDesired,1-Math.exp(-dt*5));
        if(Math.abs(isoYawTarget-isoYaw)>1e-4){
          isoYaw+=(isoYawTarget-isoYaw)*(1-Math.exp(-dt/.16));
          if(Math.abs(isoYawTarget-isoYaw)<1e-4)isoYaw=isoYawTarget;
          dirty=true;
        }
        syncIsoCamera();
        state.fade=1;
        if(!state.selected&&state.dragging){var near=map.regions.reduce(function(a,b){return a.position.distanceToSquared(state.mapDesired)<b.position.distanceToSquared(state.mapDesired)?a:b;});if(near.id!==state.region)notifyRegion(near.id);}
      }
      if(canvas.style.opacity!=='1')canvas.style.opacity='1';
      if(handoffActive){handoffTime+=dt;var blend=T.MathUtils.smoothstep(handoffTime,0,.42);if(transitionFrame)transitionFrame.style.opacity=String(1-blend);if(blend>=1)finishTransition();}
      // Enrichment keeps the legacy map scalar (its LOD and "close enough to greet a
      // resident" threshold are tuned to 30..70), the environment gets the true
      // orthographic eye distance so its fog band lands on the island's depth slab, and
      // it always receives the live camera.
      if(enrichment&&mapGroup.visible&&(cameraChanged||extraAnimation))extraAnimation=!!enrichment.update(timestamp/1000,{target:state.mapTarget,distance:state.mapDistance,active:state.activeNpc||state.activePlace,reducedMotion:reduced});else if(!mapGroup.visible)extraAnimation=false;
      if(environment){environmentAnimating=!!environment.update(timestamp/1000,{mode:state.mode,quality:quality,distance:isIsoMode()?ISO.distance:state.mapDistance,interacting:state.dragging||moving(),settled:!moving(),camera:activeCamera(),height:viewHeight,pixelRatio:pixelRatio});var skyState=environment.getFrameState?environment.getFrameState():environment.getState();if(renderer.shadowMap&&renderer.shadowMap.enabled){var sun=sunScratch.copy(key.position).normalize();if(shadowSun.distanceToSquared(sun)>.0009||shadowWeather!==skyState.weather){shadowSun.copy(sun);shadowWeather=skyState.weather;renderer.shadowMap.needsUpdate=true;}}if(opts.onEnvironmentChange&&(skyState.quality!==state.lastEnvironmentQuality||skyState.mode!==state.lastEnvironmentMode||(skyState.cycle&&timestamp-(state.lastEnvironmentNotify||0)>1000))){state.lastEnvironmentNotify=timestamp;state.lastEnvironmentQuality=skyState.quality;state.lastEnvironmentMode=skyState.mode;opts.onEnvironmentChange(environment.getState());}}
      // pixels per world unit: the perspective camera divides its cone at the target
      // distance, the orthographic camera simply maps its frustum height onto the viewport.
      var activeRoot=mapGroup.visible?mapGroup:globe,projection=mapGroup.visible?(viewHeight*pixelRatio/Math.max(.001,isoView.height)):(viewHeight*pixelRatio/(2*Math.tan(camera.fov*Math.PI/360)*Math.max(.5,state.distance-1.15)));if(cameraChanged){lodHidden=0;activeRoot.traverse(function(o){if(o.userData.smallDetail){o.visible=quality==='detail'||o.userData.partRadius*projection>=(active?2.0:.65);if(!o.visible)lodHidden++;}});}
      if(cameraChanged||extraAnimation)activeRoot.updateMatrixWorld(true);if(cameraChanged)activeCamera().updateMatrixWorld(true);
      // Residents walk while the scene is live. They follow the same "dynamic" switch as
      // water and weather: turning the environment animation off must leave a still
      // frame, so the layers stop reporting motion and the scheduler can idle.
      var environmentLive=environment?(environment.getState().effectiveAnimate!==false):true;
      var residentsMoving=!reduced&&!opts.compatibility&&environmentLive;
      if(mapVillage&&typeof mapVillage.update==='function'&&mapGroup.visible){if(mapVillage.update(timestamp/1000,{animate:residentsMoving,reducedMotion:reduced,heightAt:map.heightAt}))extraAnimation=true;}
      if(mapFrontier&&typeof mapFrontier.update==='function'&&mapGroup.visible){if(mapFrontier.update(timestamp/1000,{animate:residentsMoving,reducedMotion:reduced,heightAt:map.heightAt}))extraAnimation=true;}
      if(groundScatter)groundScatter.update(timestamp/1000,{animate:animateWater&&!reduced,active:active||cameraChanged});
      // The sakura petals live in a vertex uniform, so the layer only asks for a
      // frame while weather animation is on; a still, dry scene keeps it frozen.
      if(islandLandmarks&&islandLandmarks.update(timestamp/1000,{animate:animateWater&&!reduced}))extraAnimation=true;
      if(story)story.tick(animateWater?animationTime:0);if(map)map.tick(animateWater?animationTime:0);
      if(cameraChanged)pins();var drawStart=performance.now();try{renderer.render(scene,activeCamera());}catch(error){if(opts.onFatalError){opts.onFatalError(error);return;}throw error;}drawMS=performance.now()-drawStart;frames++;
      if(renderer.shadowMap)renderer.shadowMap.needsUpdate=false;
      if(handoffPending){captureTransition(false);handoffPending=false;navigate(state.pending,true);if(disposed)return;invalidate();}
      if(moving()||rotating||animateWater||extraAnimation||environmentAnimating||handoffActive)schedule();
      else if(resolutionMoving&&!state.dragging){resolutionMoving=false;resize();}
    }
    resize();canvas.style.touchAction=opts.zoom?'none':'pan-y';invalidate();
    return {
      rotateIso:rotateIso,setIsoYaw:setIsoYaw,getIsoYaw:getIsoYaw,focusResident:focusResident,exitResidentFocus:exitResidentFocus,getResidentFocus:getResidentFocus,
      select:select,focus:select,openPlace:openPlace,closePlace:closePlace,getPlaces:function(){ensureMap();return enrichment?enrichment.places:[];},setQuality:setQuality,getQuality:function(){return quality;},enterRegion:enterRegion,enterMap:enterRegion,clear:clear,overview:overview,mapOverview:mapOverview,
      setAutoRotate:function(on){state.autoRotate=!!on;invalidate();},isAutoRotating:function(){return state.autoRotate;},
      getMode:function(){return state.mode;},getDistance:function(){return state.mode==='map'||state.mode==='focus'?state.mapTargetDistance:state.targetDistance;},
      getMapState:function(){return{mode:state.mode,region:state.region,target:state.mapDesired.toArray(),currentTarget:state.mapTarget.toArray(),distance:state.mapTargetDistance,currentDistance:state.mapDistance,bounds:map?map.bounds:null};},
      // getCamera() is always the live camera: orthographic in map/focus, perspective on
      // the globe and during the descent.
      getScene:function(){return scene;},getCamera:function(){return activeCamera();},getViewState:snapshot,restoreView:restoreView,
      get selected(){return state.selected;},
      surfaceHeight:function(d){return story.height(d);},
      getRenderStatus:function(){return{settled:!dirty&&!bufferResizePending&&!(environment&&environment.getFrameState&&environment.getFrameState().transitioning)&&!moving()&&!state.dragging&&!handoffActive&&state.mode!=='descending'&&!(state.mode==='overview'&&state.autoRotate),transition:state.mode==='descending'?'approach':handoffActive?'blend':null,environmentAnimating:environmentAnimating,environmentFPS:environmentFPS,pinsUpdates:pinsUpdates,environment:environment?environment.getState():null,frames:frames,webgl:!contextLost,contextLost:contextLost,contextLosses:contextLosses,paused:!raf,visible:visible,documentHidden:!!document.hidden,dirty:dirty,pixelRatio:pixelRatio,quality:quality,adaptiveScale:dynamicScale,measuredFPS:measuredFPS,lodHidden:lodHidden,drawMS:drawMS,enrichment:enrichment?enrichment.stats:null,village:(mapGroup.visible?mapVillage:globeVillage)?(mapGroup.visible?mapVillage:globeVillage).stats:null,frontier:(mapGroup.visible?mapFrontier:globeFrontier)?(mapGroup.visible?mapFrontier:globeFrontier).stats:null,ground:groundScatter?groundScatter.stats:null,landmarks:islandLandmarks?islandLandmarks.stats:null,maxFPS:maxFPS,geometryBytes:geometryBytes(globe)+geometryBytes(mapGroup),residentGeometryBytes:geometryBytes(gpuResident==='globe'?globe:mapGroup),rendererMemory:renderer.info&&renderer.info.memory,programs:renderer.info&&renderer.info.programs?renderer.info.programs.length:0,compatibility:!!opts.compatibility,rendererAttempts:rendererAttempts,shadows:!!(renderer.shadowMap&&renderer.shadowMap.enabled),calls:renderer.info?renderer.info.render.calls:null,triangles:renderer.info?renderer.info.render.triangles:null,mode:state.mode,residentFocus:getResidentFocus(),camera:{type:isIsoMode()?'orthographic':'perspective',azimuth:ISO.azimuth,elevation:ISO.elevation,isoYaw:isoYaw,yawTarget:isoYawTarget,eyeDistance:isIsoMode()?ISO.distance:state.distance,zoom:isIsoMode()?isoView.zoom:null,targetZoom:isIsoMode()?zoomForDistance(state.mapTargetDistance,isoWholeDistance()):null,frustumHeight:isIsoMode()?isoView.height:null,frustumWidth:isIsoMode()?isoView.width:null,fogNear:scene.fog?scene.fog.near:null,fogFar:scene.fog?scene.fog.far:null}};},
      stats:function(){var meshes=0,tris=0,instances=0;var root=mapGroup.visible?mapGroup:globe;root.traverse(function(o){if(!o.isMesh)return;meshes++;var g=o.geometry;var count=o.isInstancedMesh?o.count:1;if(o.isInstancedMesh)instances+=o.count;tris+=(g.index?g.index.count/3:g.attributes.position.count/3)*count;});return{meshes:meshes,instances:instances,triangles:Math.round(tris)};},
      openCoast:openCoast,setMapView:setMapView,getMapView:function(){return mapView;},setEnvironment:setEnvironment,getEnvironment:function(){return environment?environment.getState():null;},getMapWeather:function(){return environment&&environment.getMapWeather?environment.getMapWeather():null;},getGroundDetail:function(){return groundScatter?groundScatter.stats:null;},getIslandLandmarks:function(){return islandLandmarks?islandLandmarks.stats:null;},
      resize:resize,destroy:destroy
    };
  }
  // Pure isometric framing helpers are exported so they can be asserted in Node
  // (test/iso-camera.mjs) without a browser, a GPU or a renderer stub.
  window.MarioPlanet={create:create,latLonToVec3:latLonToVec3,iso:{config:ISO,direction:isoDirection,axes:isoAxes,extents:isoExtents,frustum:isoFrustum,zoomForDistance:zoomForDistance,distanceForZoom:distanceForZoom,fogBand:function(){return {near:isoFogNear(),far:isoFogFar()};}}};
})();
