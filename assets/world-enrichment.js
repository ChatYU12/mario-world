/* Town outposts and inhabitants. Optional CC0 kit input; no loaders or network. */
(function (root) {
  'use strict';
  var SITE_PLAN = [
    {id:'project-hall',region:'collaboration',title:'项目协作馆',npcName:'栗栗',category:'collaboration',at:[6,-21],annex:[2,-22],models:['houseA','tavern'],widths:[3.1,2.4]},
    {id:'automation-post',region:'automation',title:'自动化邮局',npcName:'豆豆',category:'automation',at:[-30,5],annex:[-26,3],models:['houseB','blacksmith'],widths:[3.0,2.5]},
    {id:'data-observatory',region:'connection',title:'数据观测台',npcName:'澄澄',category:'connection',at:[12,18],annex:[17,19],models:['watchtower','watermill'],widths:[2.4,2.7]},
    {id:'service-station',region:'desert',title:'客户服务站',npcName:'阿杏',category:'automation',at:[-42,11],annex:[-46,14],models:['market','houseB'],widths:[3.1,2.5]},
    {id:'knowledge-library',region:'snow',title:'知识图书馆',npcName:'绵绵',category:'collaboration',at:[-23,-27],annex:[-27,-32],models:['tavern','houseA'],widths:[3.0,2.5]},
    {id:'integration-garage',region:'lava',title:'集成维修铺',npcName:'阿栓',category:'connection',at:[26,-14],annex:[31,-14],models:['blacksmith','lumbermill'],widths:[3.0,2.7]}
  ];
  var ROUTES = [
    [[0,-14],[0,-9],[-7,-6],[-16,0],[-22,6],[-26,10],[-26,12]],
    [[-26,12],[-24,14],[-16,19],[-4,20],[7,24],[15,26],[18,26]],
    [[0,-14],[-3,-17],[-12,-20],[-21,-21],[-27,-26],[-32,-28]],
    [[-26,12],[-29,13],[-35,15],[-41,19],[-48,22]],
    [[0,-14],[4,-15],[13,-17],[21,-18],[27,-22],[34,-24]]
  ];
  var RESERVED = [[0,-14,5.2],[-26,12,3.9],[18,26,4.0],[-49,22,4.5],[-42,28,3.1],[36,-25,4.5],[-7,-10,1.6],[7,-10,1.6],[-6,-3,1.5],[6,-3,1.5],[-10,-17,1.5],[10,-17,1.5],[-37,-37,4.5],[-29,-37,3.2],[-42,-29,3.3]];
  var C = {cream:0xffedce,stone:0xd9c49e,white:0xfffbec,roof:0xe9879e,roofDark:0xa85268,wood:0x9c704c,dark:0x493c3a,blue:0x72bac9,green:0x76a96a,gold:0xf1c765,skin:0xf6cba0,hair:0x704935,shoe:0x57473f,path:0xe1c69e};

  function resolveHit(hit) {
    if(!hit || !hit.object)return null;
    var o=hit.object,d=o.userData||{},instance=hit.instanceId;
    if(instance!==undefined&&d.instancePlaces){var id=d.instancePlaces[instance];return id?{kind:'npc',placeId:id,businessId:id,npcId:d.instanceNpcs[instance],object:o,instanceId:instance}:null;}
    while(o){d=o.userData||{};if(d.placeId)return{kind:d.npcId?'npc':'place',placeId:d.placeId,businessId:d.placeId,npcId:d.npcId||null,object:hit.object};o=o.parent;}
    return null;
  }
  function runtime(T,result,actors,reducedMotion) {
    var lastTime=-Infinity,lastActive=null,lastTarget=null,pulseEnd=-Infinity,pulseId=null;
    var matrix=new T.Matrix4(),position=new T.Vector3(),scale=new T.Vector3(1,1,1),quaternion=new T.Quaternion(),up=new T.Vector3(0,1,0);
    var reducedQuery=typeof root.matchMedia==='function'?root.matchMedia('(prefers-reduced-motion: reduce)'):null;
    function activate(id,time){if(!actors.some(function(a){return a.id===id||a.placeId===id;}))return false;pulseId=id;pulseEnd=(typeof time==='number'?time:lastTime===-Infinity?0:lastTime)+1.3;return true;}
    result.activateNpc=activate;result.setActive=activate;
    result.update=function(time,viewer){
      viewer=viewer||{};time=Number.isFinite(time)?time:0;
      if(reducedMotion||viewer.reducedMotion||(reducedQuery&&reducedQuery.matches))return false;
      if(time<lastTime){lastTime=-Infinity;lastActive=null;lastTarget=null;pulseEnd=-Infinity;}
      var active=viewer.activeNpcId||viewer.activePlaceId||(typeof viewer.active==='string'?viewer.active:viewer.active&&viewer.active.npcId||viewer.active&&viewer.active.placeId)||null;
      if(active!==lastActive){lastActive=active;if(active)activate(active,time);}
      var target=viewer.target||viewer.position;
      if(target&&Number.isFinite(target.x)&&Number.isFinite(target.z)){
        if(!lastTarget||Math.hypot(target.x-lastTarget.x,target.z-lastTarget.z)>2.2){
          lastTarget={x:target.x,z:target.z};
          if(!active&&time>=pulseEnd&&(viewer.distance===undefined||viewer.distance<70)&&actors.length){var nearest=null,best=18;actors.forEach(function(a){var d=Math.hypot(a.base.x-target.x,a.base.z-target.z);if(d<best){best=d;nearest=a;}});if(nearest)activate(nearest.id,time);}
        }
      }
      var animated=time<pulseEnd;
      if(animated&&time-lastTime<.1&&time>=lastTime)return true;
      lastTime=time;var touched=new Set();
      actors.forEach(function(a){
        var wave=animated&&(a.id===pulseId||a.placeId===pulseId),angle=a.yaw+(wave?Math.sin(time*4.5+a.phase)*.15:0),rise=wave?Math.max(0,Math.sin(time*5+a.phase))*.022:0;
        if(Math.abs(angle-a.lastYaw)<.0001&&Math.abs(rise-a.lastRise)<.0001)return;
        position.copy(a.base);position.y+=rise;quaternion.setFromAxisAngle(up,angle);matrix.compose(position,quaternion,scale);
        a.mesh.setMatrixAt(a.instance,matrix);a.lastYaw=angle;a.lastRise=rise;touched.add(a.mesh);
      });
      touched.forEach(function(mesh){mesh.instanceMatrix.needsUpdate=true;mesh.updateMatrix();mesh.updateMatrixWorld(true);});
      return animated;
    };
    result.resolveHit=resolveHit;
    result.dispose=function(){var geos=new Set(),mats=new Set();result.group.traverse(function(o){if(o.geometry)geos.add(o.geometry);if(o.material)mats.add(o.material);if(o.isInstancedMesh&&o.dispose)o.dispose();});geos.forEach(function(g){g.dispose();});mats.forEach(function(m){m.dispose();});result.group.removeFromParent();};
    return result;
  }

  function build(T,parent,options) {
    var opts=options||{},kind=opts.kind||'map',reduced=!!opts.reducedMotion;
    if(opts.reducedMotion===undefined&&typeof root.matchMedia==='function')reduced=root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var group=new T.Group();group.name='world-enrichment';parent.add(group);
    var staticGroup=new T.Group(),dynamicGroup=new T.Group();staticGroup.name='enrichment-architecture';dynamicGroup.name='enrichment-inhabitants';group.add(staticGroup,dynamicGroup);
    var material=new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.82,metalness:0});
    var palette=new Map(),geometryPool=new Map();
    function paint(hex){if(!palette.has(hex))palette.set(hex,new T.MeshBasicMaterial({color:hex}));return palette.get(hex);}
    function geom(name,make){if(!geometryPool.has(name))geometryPool.set(name,make());return geometryPool.get(name);}
    function part(to,g,color,x,y,z,sx,sy,sz,rx,ry,rz){var m=new T.Mesh(g,paint(color));m.position.set(x||0,y||0,z||0);m.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);m.rotation.set(rx||0,ry||0,rz||0);to.add(m);return m;}
    function box(to,color,x,y,z,w,h,d,rx,ry,rz){return part(to,geom('box',function(){return new T.BoxGeometry(1,1,1);}),color,x,y,z,w,h,d,rx,ry,rz);}
    function ball(to,color,x,y,z,w,h,d){return part(to,geom('sphere',function(){return new T.SphereGeometry(1,10,7);}),color,x,y,z,w,h,d);}
    function cylinder(to,color,x,y,z,rt,rb,h,sides,rx,ry,rz){var key=['c',rt,rb,h,sides||8].join('/');return part(to,geom(key,function(){return new T.CylinderGeometry(rt,rb,h,sides||8);}),color,x,y,z,1,1,1,rx,ry,rz);}
    function compile(source,mat,name,owner){
      source.updateMatrixWorld(true);var p=[],n=[],colors=[],indices=[],v=new T.Vector3(),normal=new T.Vector3(),nm=new T.Matrix3(),color=new T.Color();
      source.traverse(function(o){
        if(!o.isMesh||!o.geometry)return;
        var g=o.geometry,a=g.attributes.position,na=g.attributes.normal,ca=g.attributes.color,index=g.index,offset=p.length/3;
        var m=Array.isArray(o.material)?o.material[0]:o.material;
        color.copy(m&&m.color?m.color:new T.Color(0xffffff));nm.getNormalMatrix(o.matrixWorld);
        for(var i=0;i<a.count;i++){
          v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);normal.set(0,1,0);if(na)normal.fromBufferAttribute(na,i);normal.applyMatrix3(nm).normalize();
          p.push(v.x,v.y,v.z);n.push(normal.x,normal.y,normal.z);colors.push(color.r*(ca?ca.getX(i):1),color.g*(ca?ca.getY(i):1),color.b*(ca?ca.getZ(i):1));
        }
        if(index){for(var j=0;j<index.count;j++)indices.push(offset+index.getX(j));}else{for(var j=0;j<a.count;j++)indices.push(offset+j);}
      });
      var geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(p,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(n,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
      var mesh=new T.Mesh(geometry,mat);mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=false;if(owner){mesh.userData.placeId=owner;mesh.userData.demoOnly=true;}return mesh;
    }
    function triangles(model){var count=0;model.traverse(function(o){if(o.isMesh)count+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});return count;}
    function cottage(style){
      var m=new T.Group(),roof=style===2?C.green:C.roof;
      box(m,C.cream,0,.72,0,1.55,1.35,1.24);box(m,C.stone,0,.10,0,1.7,.20,1.38);
      var roofGeo=geom('roof',function(){return new T.CylinderGeometry(1,1,1,3,1,false,Math.PI/2);});
      part(m,roofGeo,roof,0,1.58,0,1.02,1.50,.78,0,0,Math.PI/2);
      box(m,C.wood,.36,1.84,-.18,.17,.62,.19);box(m,C.dark,0,.45,.637,.36,.72,.055);
      box(m,C.wood,0,.45,.676,.27,.62,.04);ball(m,C.gold,.075,.46,.707,.025,.025,.025);
      [-.51,.51].forEach(function(x){box(m,C.white,x,.88,.646,.34,.42,.055);box(m,C.blue,x,.88,.683,.24,.31,.025);box(m,C.wood,x,.88,.704,.025,.31,.025);box(m,C.wood,x,.88,.704,.24,.025,.025);});
      box(m,C.white,0,1.23,.72,1.70,.11,.30);return m;
    }
    function symbol(to,type,width,height,depth){
      var x=0,y=height*.68,z=depth*.51+.06,s=Math.min(.48,width*.18),g=new T.Group();g.position.set(x,y,z);to.add(g);
      box(g,C.wood,0,0,-.035,s*1.8,s*1.25,.09);box(g,C.cream,0,0,.02,s*1.58,s*.98,.04);
      if(type==='automation-post'){box(g,C.roof,0,0,.055,s*.9,s*.50,.035);box(g,C.white,-s*.19,0,.08,s*.52,.025,.025,0,0,-.5);box(g,C.white,s*.19,0,.08,s*.52,.025,.025,0,0,.5);}
      else if(type==='knowledge-library'){box(g,C.blue,-s*.19,0,.06,s*.33,s*.60,.06,0,0,.12);box(g,C.roof,s*.19,0,.06,s*.33,s*.60,.06,0,0,-.12);box(g,C.white,0,-s*.03,.08,.035,s*.57,.035);}
      else if(type==='data-observatory'){cylinder(g,C.blue,0,0,.075,s*.31,s*.31,.055,10,Math.PI/2);cylinder(g,C.gold,0,0,.11,s*.12,s*.12,.035,10,Math.PI/2);}
      else if(type==='integration-garage'){box(g,C.blue,0,0,.07,s*.15,s*.8,.055,0,0,.65);cylinder(g,C.gold,s*.19,s*.23,.075,s*.18,s*.18,.06,6,Math.PI/2);}
      else if(type==='service-station'){cylinder(g,C.gold,0,0,.08,s*.32,s*.32,.05,10,Math.PI/2);box(g,C.white,0,0,.12,s*.42,s*.08,.025);box(g,C.white,0,0,.12,s*.08,s*.42,.025);}
      else{[-.28,0,.28].forEach(function(x,i){ball(g,[C.roof,C.blue,C.green][i],x*s,s*.12,.09,s*.14,s*.14,s*.08);box(g,[C.roof,C.blue,C.green][i],x*s,-s*.15,.08,s*.20,s*.24,.06);});}
    }
    function npcPrototype(variant){
      var g=new T.Group(),shirt=[C.blue,C.roof,C.green][variant],skin=variant===2?0xdba77c:C.skin;
      ball(g,shirt,0,.63,0,.215,.27,.145);box(g,C.wood,0,.445,.01,.32,.06,.25);
      [-1,1].forEach(function(side){
        cylinder(g,C.dark,side*.09,.27,0,.058,.062,.28,7);ball(g,C.shoe,side*.09,.10,.035,.085,.075,.135);
        cylinder(g,shirt,side*.235,.66,0,.058,.065,.29,7,0,0,side*(variant===1?.48:.18));ball(g,skin,side*.265,.51,.018,.070,.075,.067);
        box(g,C.gold,side*.095,.69,.148,.040,.30,.026);
      });
      ball(g,skin,0,1.01,.012,.175,.195,.155);ball(g,C.hair,0,1.095,-.025,.18,.115,.145);
      ball(g,skin,0,1.0,.171,.043,.047,.045);
      [-1,1].forEach(function(side){ball(g,C.white,side*.062,1.04,.152,.041,.048,.024);ball(g,C.dark,side*.060,1.035,.173,.018,.027,.012);box(g,C.hair,side*.061,1.092,.154,.051,.012,.020);ball(g,skin,side*.178,1.015,0,.035,.055,.038);});
      box(g,C.roofDark,0,.955,.160,.052,.014,.013);
      if(variant!==2){cylinder(g,shirt,0,1.17,0,.18,.19,.12,10);cylinder(g,shirt,0,1.12,.035,.205,.205,.035,12);cylinder(g,C.gold,0,1.165,.183,.047,.047,.022,6,Math.PI/2);}
      else{part(g,geom('hood',function(){return new T.SphereGeometry(1,10,5,0,Math.PI*2,0,Math.PI*.5);}),C.cream,0,1.13,-.015,.205,.17,.17);box(g,C.cream,0,.84,.03,.34,.055,.29);}
      box(g,C.cream,0,.63,.158,.19,.18,.028);cylinder(g,C.gold,.055,.70,.185,.025,.025,.025,7,Math.PI/2);
      return g;
    }
    var places=[],buildings=[],npcs=[],pickTargets=[],npcTargets=[],actors=[];
    var props=new T.Group(),shadows=new T.Group(),imported=null,importedCount=0,scaleFactor=opts.scale||1;
    if(opts.importedKit)imported=opts.importedKit;else if(root.MarioImportedModels&&typeof root.MarioImportedModels.create==='function')imported=root.MarioImportedModels.create(T);
    var heightAt=typeof opts.heightAt==='function'?opts.heightAt:function(){return 0;},hasTerrain=typeof opts.heightAt==='function';
    function nearestRoad(x,z){var best={x:x,z:z+4,d:Infinity};ROUTES.forEach(function(route){for(var i=0;i<route.length-1;i++){var a=route[i],b=route[i+1],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz))),px=a[0]+t*dx,pz=a[1]+t*dz,d=Math.hypot(x-px,z-pz);if(d<best.d)best={x:px,z:pz,d:d};}});return best;}
    function safeSite(seed,width){
      var radius=width*.64,candidates=[[0,0],[1.8,0],[-1.8,0],[0,1.8],[0,-1.8],[2,2],[-2,-2],[3.5,0],[-3.5,0],[0,3.5],[0,-3.5]],best=null;
      candidates.forEach(function(delta){
        var x=seed[0]+delta[0],z=seed[1]+delta[1],road=nearestRoad(x,z),sample=[[x,z],[x-radius,z-radius],[x+radius,z-radius],[x-radius,z+radius],[x+radius,z+radius]].map(function(p){return heightAt(p[0],p[1]);});
        var lo=Math.min.apply(null,sample),hi=Math.max.apply(null,sample),clear=RESERVED.every(function(r){return Math.hypot(x-r[0],z-r[1])>r[2]+radius;})&&buildings.every(function(b){return Math.hypot(x-b.position.x,z-b.position.z)>b.radius+radius+.5;});
        if(!clear||(hasTerrain&&lo<.9)||road.d<radius+.95)return;
        var score=Math.hypot(delta[0],delta[1])+Math.max(0,hi-lo-.8)*6;
        if(!best||score<best.score)best={x:x,z:z,y:hi+.035,low:lo,score:score,road:road};
      });
      if(!best){var x=seed[0],z=seed[1];best={x:x,z:z,y:heightAt(x,z)+.04,low:heightAt(x,z),road:nearestRoad(x,z),fallback:true};}
      return best;
    }
    function path(from,to){var dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz),steps=Math.max(2,Math.ceil(length/.55));for(var i=0;i<steps;i++){var t=(i+.5)/steps,x=from.x+dx*t,z=from.z+dz*t;box(props,C.path,x,heightAt(x,z)+.065,z,.72,.08,length/steps*1.07,0,Math.atan2(dx,dz),0);}}
    function addShadow(x,z){var disk=part(shadows,geom('shadow',function(){return new T.CircleGeometry(.29,12);}),0x234a36,x,heightAt(x,z)+.028,z,1,1,1,-Math.PI/2);return disk;}
    if(kind!=='globe')SITE_PLAN.forEach(function(plan,index){
      var experience=new T.Group(),record={id:plan.id,title:plan.title,region:plan.region,category:plan.category,npcName:plan.npcName,demoOnly:true,position:null,focusPoint:null,buildingIds:[],npcIds:[],assetModels:[]};
      [plan.at,plan.annex].forEach(function(seed,j){
        var width=plan.widths[j]*scaleFactor,site=safeSite(seed,width),model=null,modelName=plan.models[j],isImported=false;
        if(imported&&typeof imported.build==='function'){try{model=imported.build(modelName);isImported=!!model;if(model&&triangles(model)>3400){model=null;isImported=false;}}catch(ignore){model=null;}}
        if(!model)model=cottage(index%3);
        model.updateMatrixWorld(true);var bounds=new T.Box3().setFromObject(model),dimensions=bounds.getSize(new T.Vector3()),factor=Math.min(width/Math.max(dimensions.x,dimensions.z,.001),4.8*scaleFactor/Math.max(dimensions.y,.001));
        model.scale.multiplyScalar(factor);model.position.y-=bounds.min.y*factor;
        var wrapper=new T.Group(),yaw=Math.atan2(site.road.x-site.x,site.road.z-site.z);wrapper.position.set(site.x,site.y,site.z);wrapper.rotation.y=yaw;wrapper.add(model);experience.add(wrapper);
        var actualWidth=dimensions.x*factor,actualDepth=dimensions.z*factor,actualHeight=dimensions.y*factor;
        box(wrapper,C.stone,0,-(site.y-site.low)*.5-.035,0,actualWidth+.17,site.y-site.low+.07,actualDepth+.17);
        symbol(wrapper,plan.id,actualWidth,actualHeight,actualDepth);
        var id=plan.id+(j?'-annex':'-main'),position=new T.Vector3(site.x,site.y,site.z),front={x:site.x+Math.sin(yaw)*(actualDepth*.5+.55),z:site.z+Math.cos(yaw)*(actualDepth*.5+.55)};
        buildings.push({id:id,placeId:plan.id,region:plan.region,position:position,radius:width*.64,width:actualWidth,depth:actualDepth,height:actualHeight,yaw:yaw,assetModel:isImported?modelName:null,demoOnly:true});
        record.buildingIds.push(id);if(isImported){importedCount++;record.assetModels.push(modelName);}
        if(!j){record.position=position.clone();record.focusPoint=position.clone().add(new T.Vector3(0,Math.min(2.5,actualHeight*.55),0));record.front=front;record.yaw=yaw;}
        path(front,site.road);
        // Joined furniture stays in one non-interactive material batch.
        var bench=new T.Group(),bx=front.x+Math.cos(yaw)*2.05,bz=front.z-Math.sin(yaw)*2.05;bench.position.set(bx,heightAt(bx,bz)+.015,bz);bench.rotation.y=yaw;props.add(bench);
        box(bench,C.wood,0,.38,0,1,.12,.38);box(bench,C.wood,0,.65,-.15,1,.40,.08);[-.34,.34].forEach(function(x){box(bench,C.dark,x,.18,0,.10,.36,.28);});
        var px=front.x-Math.cos(yaw)*1.05,pz=front.z+Math.sin(yaw)*1.05,py=heightAt(px,pz);box(props,C.wood,px,py+.20,pz,.40,.40,.40);box(props,C.cream,px,py+.20,pz,.055,.41,.41);
      });
      var combined=compile(experience,material,'enrichment-place-'+plan.id,plan.id);staticGroup.add(combined);pickTargets.push(combined);experience.clear();places.push(record);
    });
    // Overview outposts are optional and intentionally much lighter than mainland towns.
    if(kind==='globe'){
      var globeLayout=[['project-hall','collaboration',18,105],['automation-post','automation',-5,170],['data-observatory','connection',-20,78],['service-station','desert',-8,139],['knowledge-library','snow',30,143],['integration-garage','lava',24,36]];
      globeLayout.forEach(function(def,i){var a=def[2]*Math.PI/180,b=def[3]*Math.PI/180,normal=new T.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),Math.cos(a)*Math.sin(b)),radius=typeof opts.surfaceHeight==='function'?opts.surfaceHeight(normal):1.18,g=new T.Group();box(g,C.cream,0,.018,0,.037,.036,.033);part(g,geom('globe-roof',function(){return new T.ConeGeometry(.033,.025,4);}),i%2?C.roof:C.green,0,.047,0,1,1,1,0,Math.PI/4);g.position.copy(normal).multiplyScalar(radius+.003);g.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),normal);var m=compile(g,material,'overview-outpost-'+def[0],def[0]);staticGroup.add(m);pickTargets.push(m);places.push({id:def[0],title:SITE_PLAN[i].title,region:def[1],npcName:SITE_PLAN[i].npcName,category:SITE_PLAN[i].category,position:g.position.clone(),focusPoint:g.position.clone(),demoOnly:true});buildings.push({id:def[0]+'-overview',placeId:def[0],position:g.position.clone(),demoOnly:true});});
    }
    if(props.children.length){var propMesh=compile(props,material,'enrichment-route-furniture');staticGroup.add(propMesh);}
    if(kind!=='globe'){
      var definitions=[];places.forEach(function(place,i){definitions.push({place:place,name:place.npcName,type:i%3,side:-.65});if(i<4)definitions.push({place:place,name:['小芽','阿包','小帆','小荷'][i],type:(i+1)%3,side:.85});});
      for(var type=0;type<3;type++){
        var selected=definitions.filter(function(d){return d.type===type;}),prototype=npcPrototype(type);prototype.scale.setScalar(1.3);var prototypeMesh=compile(prototype,material,'npc-prototype');
        var instances=new T.InstancedMesh(prototypeMesh.geometry,material,selected.length);instances.name='enrichment-npcs-'+type;instances.frustumCulled=false;instances.instanceMatrix.setUsage(T.DynamicDrawUsage);instances.userData.instancePlaces=[];instances.userData.instanceNpcs=[];instances.userData.demoOnly=true;instances.userData.resolveHit=resolveHit;
        var matrix=new T.Matrix4(),q=new T.Quaternion(),unitScale=new T.Vector3(1,1,1),up=new T.Vector3(0,1,0);
        selected.forEach(function(def,i){var place=def.place,x=place.front.x+Math.cos(place.yaw)*def.side,z=place.front.z-Math.sin(place.yaw)*def.side,id=place.id+'-npc-'+i+'-'+type,base=new T.Vector3(x,heightAt(x,z)+.015,z),yaw=place.yaw;
          q.setFromAxisAngle(up,yaw);matrix.compose(base,q,unitScale);instances.setMatrixAt(i,matrix);instances.userData.instancePlaces.push(place.id);instances.userData.instanceNpcs.push(id);
          actors.push({id:id,placeId:place.id,base:base,mesh:instances,instance:i,yaw:yaw,phase:actors.length*.9,lastYaw:yaw,lastRise:0});
          npcs.push({id:id,npcId:id,placeId:place.id,businessId:place.id,name:def.name,region:place.region,position:base.clone(),demoOnly:true});place.npcIds.push(id);addShadow(x,z);
        });
        instances.instanceMatrix.needsUpdate=true;instances.updateMatrix();dynamicGroup.add(instances);npcTargets.push(instances);pickTargets.push(instances);prototype.clear();
      }
    }
    if(shadows.children.length){var shadowMaterial=new T.MeshBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,opacity:.16,depthWrite:false,side:T.DoubleSide}),shadowMesh=compile(shadows,shadowMaterial,'enrichment-contact-shadows');shadowMesh.renderOrder=1;staticGroup.add(shadowMesh);}
    staticGroup.updateMatrixWorld(true);dynamicGroup.updateMatrixWorld(true);
    var stats={buildings:buildings.length,npcs:npcs.length,places:places.length,triangles:0,drawCalls:0,geometryBytes:0,importedBuildings:importedCount};
    var unique=new Set();group.traverse(function(o){if(!o.isMesh)return;stats.drawCalls++;stats.triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);if(!unique.has(o.geometry)){unique.add(o.geometry);Object.keys(o.geometry.attributes).forEach(function(k){stats.geometryBytes+=o.geometry.attributes[k].array.byteLength;});if(o.geometry.index)stats.geometryBytes+=o.geometry.index.array.byteLength;}if(o.instanceMatrix)stats.geometryBytes+=o.instanceMatrix.array.byteLength;});
    stats.triangles=Math.round(stats.triangles);group.userData.enrichment={demoOnly:true,stats:stats};
    var result={group:group,staticGroup:staticGroup,dynamicGroup:dynamicGroup,places:places,buildings:buildings,npcs:npcs,pickTargets:pickTargets,npcTargets:npcTargets,stats:stats,kind:kind};
    props.clear();shadows.clear();palette.forEach(function(m){m.dispose();});palette.clear();geometryPool.clear();imported=null;
    return runtime(T,result,actors,reduced);
  }
  root.MarioWorldEnrichment={build:build,resolveHit:resolveHit,sitePlan:SITE_PLAN};
})(window);
