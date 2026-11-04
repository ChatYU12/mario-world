/* Two-scale world explorer: orbit the globe, descend into one connected map. */
(function () {
  'use strict';
  function latLonToVec3(lat, lon, radius) {
    var a=lat*Math.PI/180,b=lon*Math.PI/180;
    return new THREE.Vector3(radius*Math.cos(a)*Math.cos(b),radius*Math.sin(a),radius*Math.cos(a)*Math.sin(b));
  }
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
    var camera=new T.PerspectiveCamera(38,1,.05,1000),clock=new T.Clock();
    var overviewDistance=opts.startDistance||4.8,raf=0,disposed=false,visible=true,frames=0;
    var dirty=true,lastRenderAt=-1000,contextLost=false,contextLosses=0,recoveryTimer=0,lostSnapshot=null;
    var maxFPS=opts.maxFPS||60,pixelRatio=1,gpuResident='globe',animationTime=0;
    var quality=opts.quality||(opts.compatibility?'smooth':'auto'),dynamicScale=1,resolutionMoving=false,drawMS=0,measuredFPS=0,intervals=[],warmFrames=0,enrichment=null,placeRequest=null,extraAnimation=false,globePickTargets=[],mapPickTargets=[],lodHidden=0,residentLabels=[],viewWidth=800,viewHeight=800,pointerRect=null,bufferResizePending=true;
    var profiles={auto:{pixels:1800000,dpr:1.8,motion:.82},detail:{pixels:2600000,dpr:2,motion:.95},smooth:{pixels:786432,dpr:1.1,motion:1}};
    if(!profiles[quality])quality='auto';
    var animateWater=opts.animateWater===true&&!reduced&&!opts.compatibility;
    function schedule(){if(!disposed&&!contextLost&&!document.hidden&&(visible||state.mode==='descending')&&!raf)raf=requestAnimationFrame(loop);}
    function invalidate(){dirty=true;schedule();}
    var up=new T.Vector3(0,1,0),axisX=new T.Vector3(1,0,0),axisY=new T.Vector3(0,1,0);
    var raycaster=new T.Raycaster(),pointer=new T.Vector2(),groundPlane=new T.Plane(up,0);
    var key=new T.DirectionalLight(0xfff0d7,1.65),fill=new T.DirectionalLight(0xc3ddff,.40),hemisphere=new T.HemisphereLight(0xd8eeff,0x596752,.90);
    scene.add(hemisphere);
    scene.add(key,key.target,fill);fill.position.set(3,-1,-2);key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);key.shadow.radius=3;
    var story,map=null;try{story=window.MarioStoryWorld.build(T,globe,opts);}catch(error){renderer.dispose();if(renderer.forceContextLoss)renderer.forceContextLoss();throw error;}
    var state={mode:'overview',selected:null,region:null,autoRotate:!!opts.autoRotate&&!reduced,
      yaw:opts.initialYaw||0,pitch:opts.initialPitch===undefined?.16:opts.initialPitch,
      targetYaw:0,targetPitch:.16,distance:overviewDistance,targetDistance:overviewDistance,
      mapDistance:135,mapTargetDistance:42,mapTarget:new T.Vector3(),mapDesired:new T.Vector3(),
      dragging:false,moved:0,hover:null,transitionTime:0,pending:null,fade:1,activePlace:null,activeNpc:null};
    var mapViews={overview:new T.Vector3(.48,.93,1.12).normalize(),immersive:new T.Vector3(.20,.38,1.55).normalize()},mapView=opts.mapView==='overview'?'overview':'immersive';
    var mapDirection=mapViews[mapView].clone(),mapDesiredDirection=mapDirection.clone(),look=new T.Vector3(),shadowSun=new T.Vector3(99,99,99),shadowWeather='';
    function setMapView(value){if(!mapViews[value])return;mapView=value;mapDesiredDirection.copy(mapViews[value]);if(reduced)mapDirection.copy(mapDesiredDirection);invalidate();if(opts.onMapViewChange)opts.onMapViewChange(value);}
    var orbitRegions=nodes.map(function(n){return{id:n.id,name:n.short||n.name,lat:n.lat,lon:n.lon,color:n.color};}).concat([
      {id:'snow',name:'雪山山麓',lat:30,lon:143,color:'#6cabc4'},
      {id:'desert',name:'沙漠边境',lat:-8,lon:139,color:'#bb8d4c'},
      {id:'lava',name:'熔岩山口',lat:24,lon:36,color:'#b56b64'}
    ]);
    var geography=window.MarioWorldGeography;
    if(geography)orbitRegions.forEach(function(r){var g=geography.regions.find(function(g){return g.id===r.id;});if(g){r.lat=g.lat;r.lon=g.lon;}});
    var environment=window.MarioWorldEnvironment?window.MarioWorldEnvironment.create(T,scene,{camera:camera,key:key,fill:fill,hemisphere:hemisphere,reducedMotion:reduced,quality:quality}):null,environmentAnimating=false;
    if(environment&&opts.environment)environment.configure(opts.environment);
    var pinHost=opts.pinHost,labels={},markers={},pointerPoints=new Map(),lastX=0,lastY=0,pinchDistance=0;
    var listeners=[],handoffPending=false,handoffActive=false,handoffTime=0,transitionFrame=null,coastRequested=false;
    function captureTransition(fresh){
      if(reduced||!canvas.parentElement||!canvas.parentElement.appendChild)return false;
      if(!transitionFrame){transitionFrame=document.createElement('canvas');transitionFrame.className='world-transition-frame';transitionFrame.setAttribute('aria-hidden','true');canvas.parentElement.appendChild(transitionFrame);}
      var context=transitionFrame.getContext('2d');if(!context||!context.drawImage)return false;
      if(fresh){(mapGroup.visible?mapGroup:globe).updateMatrixWorld(true);camera.updateMatrixWorld(true);renderer.render(scene,camera);frames++;}
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
    function snapshot(){return{mode:state.mode==='descending'?'map':state.mode,region:state.mode==='descending'?state.pending:state.region,selected:state.selected,place:state.activePlace,npc:state.activeNpc,yaw:state.yaw,pitch:state.pitch,distance:state.mode==='descending'?42:(state.mode==='map'||state.mode==='focus')?state.mapTargetDistance:state.targetDistance,target:state.mode==='descending'?null:state.mapDesired.toArray(),environment:environment?environment.getState():null,mapView:mapView};}
    function notifyMode(){if(opts.onModeChange)opts.onModeChange(state.mode,state.region);}
    function notifyRegion(id){
      state.region=id;
      var region=map&&map.regions.find(function(r){return r.id===id;});
      if(opts.onRegionChange)opts.onRegionChange(region||orbitRegions.find(function(r){return r.id===id;}));
      Object.keys(labels).forEach(function(k){labels[k].setAttribute('aria-pressed',String(k===id));});
    }
    function shadowScale(large){
      if(renderer.shadowMap){renderer.shadowMap.enabled=!!large&&opts.shadows!==false&&window.innerWidth>800&&!opts.compatibility&&quality!=='smooth';key.shadow.mapSize.setScalar(quality==='detail'?1024:512);}
      key.intensity=large?1.4:1.65;fill.intensity=large?.30:.40;renderer.toneMappingExposure=large?1.05:1.10;
      key.position.set(large?-65:-3.5,large?110:5,large?85:5);key.target.position.set(0,0,0);
      var size=large?72:2;
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
    globe.traverse(function(o){if(o.isMesh&&(o.userData.nodeId||o.userData.regionId))globePickTargets.push(o);});
    freeze(globe);scene.matrixWorldAutoUpdate=false;
    function ensureMap(){
      if(map)return;
      if(!window.MarioConnectedMap)throw new Error('Connected map asset did not load.');
      map=window.MarioConnectedMap.build(T,mapGroup,opts);
      if(window.MarioWorldEnrichment)enrichment=window.MarioWorldEnrichment.build(T,mapGroup,{heightAt:map.heightAt,regions:map.regions,kind:'map',reducedMotion:reduced});
      if(window.MarioRenderQuality){if(!environment)window.MarioRenderQuality.fastWater(T,map.water,false);window.MarioRenderQuality.groundShadows(T,mapGroup,map.heightAt);window.MarioRenderQuality.optimize(T,mapGroup);}
      if(environment)environment.attachWater(map.water,{kind:'map',heightAt:map.heightAt,bounds:map.bounds,seaLevel:map.seaLevel||.48,coastField:map.coastField||(geography&&geography.coastField)});
      mapGroup.traverse(function(o){if(o.isMesh&&o.userData.nodeId)mapPickTargets.push(o);});if(enrichment)mapPickTargets=Array.from(new Set(mapPickTargets.concat(enrichment.pickTargets)));
      if(enrichment&&pinHost)enrichment.places.forEach(function(place){var npc=enrichment.npcs.find(function(n){return n.placeId===place.id;}),button=document.createElement('button');button.type='button';button.className='resident-pin';button.hidden=true;button.textContent=place.npcName;button.setAttribute('aria-label','与'+place.npcName+'交流，体验'+place.title);button.addEventListener('click',function(e){e.stopPropagation();openPlace(place.id,npc&&npc.id);});pinHost.appendChild(button);residentLabels.push({button:button,place:place,npc:npc});});
      freeze(mapGroup);
    }
    function closeStory(){
      invalidate();state.selected=null;
      if(state.mode==='focus'){state.mode='map';notifyMode();}
      if(opts.onSelect)opts.onSelect(null);
    }
    function navigate(id,first){
      try{ensureMap();}catch(error){state.mode='overview';if(opts.onFatalError){opts.onFatalError(error);return;}throw error;}
      var region=map.regions.find(function(r){return r.id===id;});if(!region)return;
      closePlace();warmFrames=0;closeStory();state.mode='map';activateGpu('map');globe.visible=false;mapGroup.visible=true;
      state.mapDesired.copy(region.position);state.mapDesired.y+=1.5;
      state.mapTargetDistance=['snow','desert','lava'].includes(id)?57:42;
      if(first){state.mapTarget.copy(state.mapDesired);state.mapDistance=reduced?state.mapTargetDistance:68;state.fade=1;}
      if(reduced){state.mapTarget.copy(state.mapDesired);state.mapDistance=state.mapTargetDistance;}
      shadowScale(true);scene.fog=new T.Fog(0xe9f6ff,120,330);
      canvas.style.touchAction='none';notifyRegion(id);notifyMode();invalidate();
      if(placeRequest){var pendingPlace=placeRequest;placeRequest=null;openPlace(pendingPlace.id,pendingPlace.npcId);}
      if(coastRequested){coastRequested=false;openCoast();}
    }
    function openCoast(){
      if(contextLost)return;
      if(state.mode==='overview'||state.mode==='descending'){coastRequested=true;enterRegion('connection',true);return;}
      closePlace();closeStory();setMapView('immersive');state.mapDesired.set(-18,Math.max(.48,map.heightAt(-18,48))+1.5,48);state.mapTargetDistance=65;notifyRegion('connection');
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
      camera.clearViewOffset();shadowScale(false);
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
    }
    function mapOverview(){
      if(contextLost)return;
      closePlace();invalidate();if(!map||state.mode==='overview')return;
      closeStory();setMapView('overview');state.mapDesired.set(-2,map.heightAt(-2,0)+1,0);state.mapTargetDistance=165;state.region=null;
      Object.keys(labels).forEach(function(id){labels[id].setAttribute('aria-pressed','false');});
      if(opts.onRegionChange)opts.onRegionChange({id:'world',name:'大陆全貌'});
      if(reduced){state.mapTarget.copy(state.mapDesired);state.mapDistance=165;}
    }
    function clear(){if(state.activePlace){closePlace();return;}if(state.mode==='map'||state.mode==='focus')closeStory();else overview();}
    function closePlace(){if(!state.activePlace)return;state.activePlace=null;state.activeNpc=null;extraAnimation=false;if(opts.onPlaceSelect)opts.onPlaceSelect(null);invalidate();}
    function openPlace(id,npcId){
      if(contextLost)return;
      if(!map&&(state.mode==='overview'||state.mode==='descending')){var demo=window.MarioDemoBusinesses&&window.MarioDemoBusinesses.get(id);if(demo){placeRequest={id:id,npcId:npcId};enterRegion(demo.region);}return;}
      ensureMap();if(!enrichment)return;var place=enrichment.places.find(function(p){return p.id===id;});if(!place)return;
      if(state.mode==='overview'||state.mode==='descending'){placeRequest={id:id,npcId:npcId};enterRegion(place.region);return;}
      closeStory();state.activePlace=id;state.activeNpc=npcId||id;state.mapDesired.copy(place.position);state.mapDesired.y+=1.6;state.mapTargetDistance=window.innerWidth<680?43:30;
      if(reduced){state.mapTarget.copy(state.mapDesired);state.mapDistance=state.mapTargetDistance;}
      extraAnimation=!reduced;notifyRegion(place.region);if(opts.onPlaceSelect){var resident=enrichment.npcs.find(function(n){return n.id===npcId;});opts.onPlaceSelect(resident?Object.assign({},place,{npcName:resident.name}):place,npcId);}invalidate();
    }
    function clampMap(){
      var b=map.bounds;
      state.mapDesired.x=T.MathUtils.clamp(state.mapDesired.x,b.minX,b.maxX);
      state.mapDesired.z=T.MathUtils.clamp(state.mapDesired.z,b.minZ,b.maxZ);
      state.mapDesired.y=map.heightAt(state.mapDesired.x,state.mapDesired.z)+1.5;
    }
    function setPointer(x,y){var r=state.dragging&&pointerRect?pointerRect:canvas.getBoundingClientRect();pointer.set((x-r.left)/r.width*2-1,-((y-r.top)/r.height)*2+1);raycaster.setFromCamera(pointer,camera);}
    function groundPoint(x,y){setPointer(x,y);groundPlane.constant=-state.mapTarget.y;return raycaster.ray.intersectPlane(groundPlane,new T.Vector3());}
    function pick(x,y){
      setPointer(x,y);var root=(state.mode==='map'||state.mode==='focus')?mapGroup:globe;
      var hits=raycaster.intersectObjects(root===mapGroup?mapPickTargets:globePickTargets,false);
      for(var i=0;i<hits.length;i++){
        var o=hits[i].object,p=o,role=null,hidden=false;for(var ancestor=o;ancestor&&ancestor!==root;ancestor=ancestor.parent){if(!ancestor.visible){hidden=true;break;}}if(hidden)continue;
        if(root===mapGroup){var terrainBlocked=false;for(var distance=1;distance<hits[i].distance-.35;distance+=1.5){var probe=raycaster.ray.at(distance,new T.Vector3());if(probe.y<map.heightAt(probe.x,probe.z)-.10){terrainBlocked=true;break;}}if(terrainBlocked)continue;}else if(hits[i].point.dot(camera.position)<0)continue;
        if(enrichment&&root===mapGroup){var extraHit=enrichment.resolveHit?enrichment.resolveHit(hits[i]):null;if(extraHit)return extraHit;if(o.userData.placeId)return{placeId:o.userData.placeId};}
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
          var ps=Array.from(pointerPoints.values()),d=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
          if(d>0&&pinchDistance>0)state.mapTargetDistance=T.MathUtils.clamp(state.mapTargetDistance*pinchDistance/d,16,180);
          pinchDistance=d;
        }else if(state.mode==='overview'){
          state.yaw-=dx*.006;state.pitch=T.MathUtils.clamp(state.pitch+dy*.006,-1.1,1.1);
        }else if(state.mode==='map'||state.mode==='focus'){
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
      if(hit){if(typeof hit==='object')openPlace(hit.placeId||hit.businessId,hit.npcId);else if(state.mode==='overview')enterRegion(hit);else select(hit);}
      else if(state.mode==='focus')closeStory();
    }
    listen(canvas,'pointerup',function(e){release(e,false);});listen(canvas,'pointercancel',function(e){release(e,true);});
    listen(canvas,'wheel',function(e){
      if(state.mode==='map'||state.mode==='focus'){e.preventDefault();state.mapTargetDistance=T.MathUtils.clamp(state.mapTargetDistance*Math.exp(e.deltaY*.0011),16,180);}
      else if(opts.zoom&&state.mode==='overview'){e.preventDefault();state.targetDistance=T.MathUtils.clamp(state.targetDistance+e.deltaY*.002,3.6,6.5);}
    },{passive:false});
    canvas.tabIndex=0;
    listen(canvas,'keydown',function(e){
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(e.key))return;
      e.preventDefault();
      if(state.mode==='map'||state.mode==='focus'){
        var step=state.mapTargetDistance*.065;
        if(e.key==='ArrowLeft')state.mapDesired.x-=step;if(e.key==='ArrowRight')state.mapDesired.x+=step;
        if(e.key==='ArrowUp')state.mapDesired.z-=step;if(e.key==='ArrowDown')state.mapDesired.z+=step;
        if(e.key==='+'||e.key==='=')state.mapTargetDistance=Math.max(16,state.mapTargetDistance*.85);
        if(e.key==='-')state.mapTargetDistance=Math.min(180,state.mapTargetDistance/ .85);
        if(e.key==='Home')mapOverview();else clampMap();
      }else{if(e.key==='ArrowLeft')state.yaw+=.10;if(e.key==='ArrowRight')state.yaw-=.10;if(e.key==='ArrowUp')state.pitch-=.10;if(e.key==='ArrowDown')state.pitch+=.10;}
    });
    function resize(){
      var parent=canvas.parentElement||canvas.parentNode||canvas,w=parent.clientWidth||800,h=parent.clientHeight||800;
      viewWidth=w;viewHeight=h;camera.aspect=w/h;camera.updateProjectionMatrix();
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
    listen(window,'resize',resize);
    listen(document,'visibilitychange',function(){if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;return false;}lastRenderAt=performance.now();});
    function recoveryTimeout(){if(disposed||!contextLost)return;if(document.hidden||!visible){recoveryTimer=setTimeout(recoveryTimeout,3000);return;}if(opts.onRecoverNeeded)opts.onRecoverNeeded(lostSnapshot);}
    listen(canvas,'webglcontextlost',function(e){e.preventDefault();contextLost=true;contextLosses++;lostSnapshot=snapshot();pointerPoints.clear();state.dragging=false;canvas.classList.remove('is-dragging');if(raf)cancelAnimationFrame(raf);raf=0;if(opts.onContextState)opts.onContextState('lost',lostSnapshot);recoveryTimer=setTimeout(recoveryTimeout,opts.recoveryTimeout||7000);return false;});
    listen(canvas,'webglcontextrestored',function(){if(recoveryTimer)clearTimeout(recoveryTimer);recoveryTimer=0;contextLost=false;if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true;if(opts.onContextState)opts.onContextState('restored',lostSnapshot);lastRenderAt=-1000;});
    function restoreView(view){if(!view)return;if(view.mapView)setMapView(view.mapView);if(environment&&view.environment)environment.configure(view.environment);if(view.mode==='overview'||view.mode==='descending'){overview(true);state.yaw=view.yaw||0;state.pitch=view.pitch||0;state.distance=state.targetDistance=view.distance||overviewDistance;}else{navigate(view.region||'collaboration',true);state.region=view.region;if(view.place)openPlace(view.place,view.npc);if(view.target)state.mapDesired.fromArray(view.target);state.mapTarget.copy(state.mapDesired);state.mapDistance=state.mapTargetDistance=view.distance;state.fade=1;if(view.selected){state.selected=view.selected;state.mode='focus';if(opts.onSelect)opts.onSelect(nodes.find(function(n){return n.id===view.selected;}));}if(!view.region&&opts.onRegionChange)opts.onRegionChange({id:'world',name:'大陆全貌'});notifyMode();}invalidate();}
    function destroy(){if(disposed)return;disposed=true;if(raf)cancelAnimationFrame(raf);if(recoveryTimer)clearTimeout(recoveryTimer);listeners.forEach(function(stop){stop();});if(ro)ro.disconnect();if(io)io.disconnect();if(transitionFrame)transitionFrame.remove();if(environment)environment.dispose();releaseGpu(globe);releaseGpu(mapGroup);renderer.dispose();if(renderer.forceContextLoss)renderer.forceContextLoss();if(pinHost)pinHost.replaceChildren();}
    listen(window,'pagehide',function(e){if(!e.persisted)destroy();else{releaseGpu(globe);if(map)releaseGpu(mapGroup);if(raf)cancelAnimationFrame(raf);raf=0;}return false;});
    listen(window,'pageshow',function(){lastRenderAt=-1000;resize();});
    function shortAngle(a,b){var d=(b-a)%(Math.PI*2);return d>Math.PI?d-Math.PI*2:d<-Math.PI?d+Math.PI*2:d;}
    function pins(){
      if(!pinHost)return;
      var rect={width:viewWidth,height:viewHeight},isMap=state.mode==='map'||state.mode==='focus';
      orbitRegions.forEach(function(r){
        var button=labels[r.id];if(!button)return;
        var pos;
        if(isMap){var region=map.regions.find(function(z){return z.id===r.id;});if(!region){button.style.opacity=0;return;}pos=region.position.clone();pos.y+=r.id==='collaboration'?10:r.id==='automation'?7:r.id==='connection'?6:6;}
        else pos=markers[r.id].getWorldPosition(new T.Vector3());
        var show=state.mode!=='descending';
        if(!isMap&&pos.clone().normalize().dot(camera.position.clone().normalize())<.18)show=false;
        var screen=pos.project(camera);if(Math.abs(screen.x)>1.06||Math.abs(screen.y)>1.06||screen.z>1)show=false;
        var sx=(screen.x*.5+.5)*rect.width,sy=(-screen.y*.5+.5)*rect.height;
        if(sx<50||sx>rect.width-50||sy<18||sy>rect.height-18)show=false;
        if(button.hidden===show)button.hidden=!show;button.style.opacity=show?String(state.fade):'0';button.style.pointerEvents=show?'auto':'none';
        button.style.transform='translate('+((screen.x*.5+.5)*rect.width).toFixed(1)+'px,'+((-screen.y*.5+.5)*rect.height).toFixed(1)+'px) translate(-50%,-50%)';
        button.classList.toggle('is-active',state.region===r.id);
      });
      residentLabels.forEach(function(label){var p=(label.npc?label.npc.position:label.place.position).clone();p.y+=1.65;var screen=p.project(camera),show=isMap&&!state.activePlace&&state.mapDistance<90&&Math.abs(screen.x)<.92&&Math.abs(screen.y)<.85&&screen.z<1;label.button.hidden=!show;if(show)label.button.style.transform='translate('+((screen.x*.5+.5)*rect.width).toFixed(1)+'px,'+((-screen.y*.5+.5)*rect.height).toFixed(1)+'px) translate(-50%,-100%)';});
    }
    function moving(){if(state.mode==='descending')return true;if(state.mode==='overview')return Math.abs(state.distance-state.targetDistance)>.001;return Math.abs(state.mapDistance-state.mapTargetDistance)>.02||state.mapTarget.distanceToSquared(state.mapDesired)>.0004||mapDirection.distanceToSquared(mapDesiredDirection)>.00001||state.fade<.999;}
    function loop(timestamp){
      raf=0;if(disposed||contextLost||document.hidden||(!visible&&state.mode!=='descending'))return;
      var rotating=state.mode==='overview'&&state.autoRotate&&!state.dragging;
      if(!dirty&&!moving()&&!rotating&&!animateWater&&!extraAnimation&&!environmentAnimating&&!handoffActive)return;
      var active=state.dragging||moving()||rotating||handoffActive,frameLimit=active?maxFPS:environmentAnimating?24:extraAnimation?20:maxFPS;
      if(timestamp-lastRenderAt<1000/frameLimit-1.0){schedule();return;}
      var gap=timestamp-lastRenderAt,dt=Math.min(.05,Math.max(.001,gap/1000));lastRenderAt=timestamp;dirty=false;animationTime+=dt;warmFrames++;
      if(active!==resolutionMoving){resolutionMoving=active;resize();dirty=false;}
      if(active&&warmFrames>12&&gap<150){intervals.push(gap);if(intervals.length>=45){measuredFPS=1000/(intervals.reduce(function(a,b){return a+b;},0)/intervals.length);if(quality==='auto'){var adjusted=dynamicScale;if(measuredFPS<44)adjusted=Math.max(.66,dynamicScale*.88);else if(measuredFPS>57&&drawMS<9)adjusted=Math.min(1,dynamicScale+.05);if(adjusted!==dynamicScale){dynamicScale=adjusted;resize();dirty=false;}}intervals=[];}}
      if(bufferResizePending)resizeDrawingBuffer();
      if(state.mode==='overview'||state.mode==='descending'){
        if(state.mode==='descending'){
          state.transitionTime+=dt;
          state.yaw+=shortAngle(state.yaw,state.targetYaw)*Math.min(1,dt*7);state.pitch+=(state.targetPitch-state.pitch)*Math.min(1,dt*7);
          if(state.transitionTime>=1.1)handoffPending=true;
        }else if(state.autoRotate&&!state.dragging)state.yaw+=dt*.10;
        globe.quaternion.setFromAxisAngle(axisX,state.pitch).multiply(new T.Quaternion().setFromAxisAngle(axisY,-state.yaw));
        state.distance+=(state.targetDistance-state.distance)*Math.min(1,dt*4);
        camera.position.set(0,0,state.distance);look.set(0,0,0);camera.clearViewOffset();camera.lookAt(look);
      }
      if(state.mode==='map'||state.mode==='focus'){
        state.mapDistance+=(state.mapTargetDistance-state.mapDistance)*Math.min(1,dt*5);
        state.mapTarget.lerp(state.mapDesired,Math.min(1,dt*5));
        mapDirection.lerp(mapDesiredDirection,Math.min(1,dt*5)).normalize();
        camera.position.copy(state.mapTarget).addScaledVector(mapDirection,state.mapDistance);camera.lookAt(state.mapTarget);
        if((state.selected||state.activePlace)&&window.innerWidth>800){camera.setViewOffset(viewWidth,viewHeight,viewWidth*.15,0,viewWidth,viewHeight);}else if(state.activePlace&&window.innerWidth<=560){camera.setViewOffset(viewWidth,viewHeight,0,viewHeight*.17,viewWidth,viewHeight);}else camera.clearViewOffset();
        state.fade=1;
        if(!state.selected&&state.dragging){var near=map.regions.reduce(function(a,b){return a.position.distanceToSquared(state.mapDesired)<b.position.distanceToSquared(state.mapDesired)?a:b;});if(near.id!==state.region)notifyRegion(near.id);}
      }
      if(canvas.style.opacity!=='1')canvas.style.opacity='1';
      if(handoffActive){handoffTime+=dt;var blend=T.MathUtils.smoothstep(handoffTime,0,.42);if(transitionFrame)transitionFrame.style.opacity=String(1-blend);if(blend>=1)finishTransition();}
      if(enrichment&&mapGroup.visible)extraAnimation=!!enrichment.update(timestamp/1000,{target:state.mapTarget,distance:state.mapDistance,active:state.activeNpc||state.activePlace,reducedMotion:reduced});else extraAnimation=false;
      if(environment){environmentAnimating=!!environment.update(timestamp/1000,{mode:state.mode,quality:quality,interacting:state.dragging||moving(),settled:!moving(),camera:camera});var skyState=environment.getState();if(renderer.shadowMap&&renderer.shadowMap.enabled){var sun=key.position.clone().normalize();if(shadowSun.distanceToSquared(sun)>.0009||shadowWeather!==skyState.weather){shadowSun.copy(sun);shadowWeather=skyState.weather;renderer.shadowMap.needsUpdate=true;}}if(opts.onEnvironmentChange&&(skyState.quality!==state.lastEnvironmentQuality||skyState.mode!==state.lastEnvironmentMode||(skyState.cycle&&timestamp-(state.lastEnvironmentNotify||0)>1000))){state.lastEnvironmentNotify=timestamp;state.lastEnvironmentQuality=skyState.quality;state.lastEnvironmentMode=skyState.mode;opts.onEnvironmentChange(skyState);}}
      var activeRoot=mapGroup.visible?mapGroup:globe,distance=mapGroup.visible?state.mapDistance:Math.max(.5,state.distance-1.15),projection=viewHeight*pixelRatio/(2*Math.tan(camera.fov*Math.PI/360)*distance);lodHidden=0;activeRoot.traverse(function(o){if(o.userData.smallDetail){o.visible=quality==='detail'||o.userData.partRadius*projection>=(active?2.0:.65);if(!o.visible)lodHidden++;}});
      activeRoot.updateMatrixWorld(true);camera.updateMatrixWorld(true);
      if(story)story.tick(animateWater?animationTime:0);if(map)map.tick(animateWater?animationTime:0);
      pins();var drawStart=performance.now();try{renderer.render(scene,camera);}catch(error){if(opts.onFatalError){opts.onFatalError(error);return;}throw error;}drawMS=performance.now()-drawStart;frames++;
      if(renderer.shadowMap)renderer.shadowMap.needsUpdate=false;
      if(handoffPending){captureTransition(false);handoffPending=false;navigate(state.pending,true);if(disposed)return;invalidate();}
      if(moving()||rotating||animateWater||extraAnimation||environmentAnimating||handoffActive)schedule();
      else if(resolutionMoving&&!state.dragging){resolutionMoving=false;resize();}
    }
    resize();canvas.style.touchAction=opts.zoom?'none':'pan-y';invalidate();
    return {
      select:select,focus:select,openPlace:openPlace,closePlace:closePlace,getPlaces:function(){ensureMap();return enrichment?enrichment.places:[];},setQuality:setQuality,getQuality:function(){return quality;},enterRegion:enterRegion,enterMap:enterRegion,clear:clear,overview:overview,mapOverview:mapOverview,
      setAutoRotate:function(on){state.autoRotate=!!on;invalidate();},isAutoRotating:function(){return state.autoRotate;},
      getMode:function(){return state.mode;},getDistance:function(){return state.mode==='map'||state.mode==='focus'?state.mapTargetDistance:state.targetDistance;},
      getMapState:function(){return{mode:state.mode,region:state.region,target:state.mapDesired.toArray(),currentTarget:state.mapTarget.toArray(),distance:state.mapTargetDistance,currentDistance:state.mapDistance,bounds:map?map.bounds:null};},
      getScene:function(){return scene;},getCamera:function(){return camera;},getViewState:snapshot,restoreView:restoreView,
      get selected(){return state.selected;},
      surfaceHeight:function(d){return story.height(d);},
      getRenderStatus:function(){return{settled:!dirty&&!bufferResizePending&&!moving()&&!state.dragging&&!handoffActive&&state.mode!=='descending'&&!(state.mode==='overview'&&state.autoRotate),transition:state.mode==='descending'?'approach':handoffActive?'blend':null,environmentAnimating:environmentAnimating,environment:environment?environment.getState():null,frames:frames,webgl:!contextLost,contextLost:contextLost,contextLosses:contextLosses,paused:!raf,visible:visible,documentHidden:!!document.hidden,dirty:dirty,pixelRatio:pixelRatio,quality:quality,adaptiveScale:dynamicScale,measuredFPS:measuredFPS,lodHidden:lodHidden,drawMS:drawMS,enrichment:enrichment?enrichment.stats:null,maxFPS:maxFPS,geometryBytes:geometryBytes(globe)+geometryBytes(mapGroup),residentGeometryBytes:geometryBytes(gpuResident==='globe'?globe:mapGroup),rendererMemory:renderer.info&&renderer.info.memory,programs:renderer.info&&renderer.info.programs?renderer.info.programs.length:0,compatibility:!!opts.compatibility,rendererAttempts:rendererAttempts,shadows:!!(renderer.shadowMap&&renderer.shadowMap.enabled),calls:renderer.info?renderer.info.render.calls:null,triangles:renderer.info?renderer.info.render.triangles:null,mode:state.mode};},
      stats:function(){var meshes=0,tris=0,instances=0;var root=mapGroup.visible?mapGroup:globe;root.traverse(function(o){if(!o.isMesh)return;meshes++;var g=o.geometry;var count=o.isInstancedMesh?o.count:1;if(o.isInstancedMesh)instances+=o.count;tris+=(g.index?g.index.count/3:g.attributes.position.count/3)*count;});return{meshes:meshes,instances:instances,triangles:Math.round(tris)};},
      openCoast:openCoast,setMapView:setMapView,getMapView:function(){return mapView;},setEnvironment:setEnvironment,getEnvironment:function(){return environment?environment.getState():null;},
      resize:resize,destroy:destroy
    };
  }
  window.MarioPlanet={create:create,latLonToVec3:latLonToVec3};
})();
