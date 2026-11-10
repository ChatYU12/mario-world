/* Self-authored village architecture and static residents; no assets or network. */
(function(root){
  'use strict';

  // Shared by village and frontier; install defensively so either script can load first.
  if(!root.MarioResidentMotion)root.MarioResidentMotion=function(T,options){
    var cfg=options,actors=[],clock=0,lastTime=null,disposed=false;
    var uniform={value:0},material=cfg.material.clone(),dummy=new T.Object3D();
    material.onBeforeCompile=function(shader){
      shader.uniforms.uResidentTime=uniform;
      shader.vertexShader='uniform float uResidentTime;\nattribute vec2 residentMotion;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nfloat gait=residentMotion.x;\nfloat walking=residentMotion.y;\ntransformed.x+=sin(gait)*(0.017+0.008*walking)*max(position.y,0.0)*walking;\ntransformed.y+=abs(sin(gait))*(0.020+0.015*walking)*walking;\nfloat breath=sin(uResidentTime*0.85+residentMotion.x);\ntransformed.y+=breath*0.007*clamp(position.y/1.8,0.0,1.0)*(1.0-walking);');
    };
    material.customProgramCacheKey=function(){return 'resident-patrol-natural-v2';};
    material.userData.residentTime=uniform;
    function random(id,channel,count){var text=id+'|'+channel+'|'+(count||0),hash=2166136261;for(var i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d);hash^=hash>>>15;hash=Math.imul(hash,0x846ca68b);return ((hash^(hash>>>16))>>>0)/4294967296;}
    function smooth(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
    function integral(t){t=Math.max(0,Math.min(1,t));return t*t*t*(1-t*.5);}
    function angle(a){return Math.atan2(Math.sin(a),Math.cos(a));}
    function resetLeg(actor){actor.legStart=actor.distance;actor.elapsed=0;actor.legLength=null;}
    function profile(actor,time){
      var peak=actor.legPeak,duration=actor.duration;
      if(time<.35)return{distance:peak*.35*integral(time/.35),speed:peak*smooth(time/.35)};
      if(time>duration-.4)return{distance:actor.legLength-peak*.4*integral((duration-time)/.4),speed:peak*smooth((duration-time)/.4)};
      return{distance:peak*(time-.175),speed:peak};
    }
    function turn(actor,delta){
      var r=actor.record,a=r.path[actor.segment],b=r.path[actor.segment+r.direction],target=Math.atan2(b.x-a.x,b.z-a.z);
      if(actor.turnTarget===null||Math.abs(angle(target-actor.turnTarget))>1e-6){actor.turnFrom=r.yaw;actor.turnTarget=r.yaw+angle(target-r.yaw);actor.turnElapsed=0;}
      actor.turnElapsed=Math.min(r.turnDuration,actor.turnElapsed+delta);
      var wanted=actor.turnFrom+(actor.turnTarget-actor.turnFrom)*smooth(actor.turnElapsed/r.turnDuration);
      r.yaw+=Math.max(-.34,Math.min(.34,angle(wanted-r.yaw)));
    }
    function segment(a,b,ignore){var count=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/.18));for(var k=0;k<=count;k++){var t=k/count;if(!cfg.safe(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,ignore))return false;}return true;}
    function prepare(record,index){
      var home={x:record.x,z:record.z,yaw:record.yaw},start=null;
      if(cfg.safe(home.x,home.z,record))start={x:home.x,z:home.z};
      for(var ring=1;!start&&ring<=30;ring++){for(var k=0;k<48;k++){var a=k*Math.PI/24,x=home.x+Math.cos(a)*ring*.12,z=home.z+Math.sin(a)*ring*.12;if(cfg.safe(x,z,record)){start={x:x,z:z};break;}}}
      if(!start)throw new Error('No dry patrol origin for '+record.id);
      var path=[start],phase=index*2.399963;
      for(var step=0;step<3;step++){
        var best=null,prev=path[path.length-1];
        search:for(var ring=0;ring<4;ring++)for(var k=0;k<32;k++){
          var a=phase+k*Math.PI/16+step*.7,r=2.6+ring*.9,p={x:start.x+Math.cos(a)*r,z:start.z+Math.sin(a)*r};
          if(path.some(function(q){return Math.hypot(q.x-p.x,q.z-p.z)<1.1;})||!cfg.safe(p.x,p.z,record)||!segment(prev,p,record))continue;
          best=p;break search;
        }
        if(best)path.push(best);
      }
      // Narrow clearances may admit only one long segment: split it into valid waypoints.
      if(path.length===2){var end=path.pop();path.push({x:(start.x+end.x)*.5,z:(start.z+end.z)*.5},end);}
      if(path.length<3)throw new Error('No safe patrol polyline for '+record.id);
      record.home=home;record.x=start.x;record.z=start.z;record.path=path;record.progress=0;record.direction=1;record.wait=0;
      record.peakSpeed=.55+.40*random(record.id,'speed');record.pauseDuration=1.2+3.3*random(record.id,'pause');
      // Preserve legacy configuration fields; actual gait uses the richer parameters above.
      record.speed=Math.min(.85,record.peakSpeed);record.pause=Math.min(2.4,record.pauseDuration);
      record.startDelay=1.8*random(record.id,'start');record.wait=record.startDelay;record.stopDuration=record.startDelay;record.currentSpeed=0;
      record.gaitPhase=Math.PI*2*random(record.id,'gait');record.turnDuration=(record.type===1||record.type===4)?.36+.04*random(record.id,'turn'):.25+.10*random(record.id,'turn');
      record.roundTrips=0;record.restChecks=0;record.restCount=0;record.nextRestCycle=2+Math.floor(3*random(record.id,'restEvery'));record.temporaryRest=false;
      record.current={x:start.x,z:start.z,y:cfg.heightAt(start.x,start.z)+.02};
      return record;
    }
    function add(mesh,records){
      var values=new Float32Array(records.length*2);mesh.geometry.setAttribute('residentMotion',new T.InstancedBufferAttribute(values,2));mesh.material=material;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      records.forEach(function(record,index){var actor={mesh:mesh,index:index,record:record,segment:0,distance:0,gaitPhase:record.gaitPhase,order:actors.length,turnTarget:null,turnFrom:record.yaw,turnElapsed:0};resetLeg(actor);actors.push(actor);values[index*2]=actor.gaitPhase;cfg.orient(dummy,record.x,record.z,cfg.heightAt(record.x,record.z)+.02,record.yaw);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);});
      mesh.instanceMatrix.needsUpdate=true;
    }
    function arrive(actor){
      var r=actor.record;actor.segment+=r.direction;actor.distance=0;resetLeg(actor);r.currentSpeed=0;
      if(actor.segment===0||actor.segment===r.path.length-1){
        r.direction*=-1;r.wait=1.2+3.3*random(r.id,'endpoint',r.roundTrips*2+(actor.segment===0?1:0));r.temporaryRest=false;
        if(actor.segment===0){
          r.roundTrips++;
          if(r.roundTrips>=r.nextRestCycle){
            r.restChecks++;
            if(random(r.id,'restChance',r.restChecks)<.25){r.wait=2+4*random(r.id,'restLength',r.restChecks);r.temporaryRest=true;r.restCount++;}
            r.nextRestCycle=r.roundTrips+2+Math.floor(3*random(r.id,'restEvery',r.restChecks));
          }
        }
        r.stopDuration=r.wait;
      }
    }
    function update(time,viewer){
      viewer=viewer||{};
      if(disposed||!viewer.animate||cfg.reducedMotion||viewer.reducedMotion||(typeof root.matchMedia==='function'&&root.matchMedia('(prefers-reduced-motion: reduce)').matches)){lastTime=Number.isFinite(time)?time:null;return false;}
      time=Number.isFinite(time)?time:0;var delta=lastTime===null?.1:Math.max(0,Math.min(.25,time-lastTime));lastTime=time;clock+=delta;uniform.value=clock;
      actors.forEach(function(actor){
        var r=actor.record,remaining=delta,saved={segment:actor.segment,distance:actor.distance,legStart:actor.legStart,elapsed:actor.elapsed,legLength:actor.legLength,legPeak:actor.legPeak,duration:actor.duration,x:r.x,z:r.z,progress:r.progress,direction:r.direction,wait:r.wait,roundTrips:r.roundTrips,restChecks:r.restChecks,restCount:r.restCount,nextRestCycle:r.nextRestCycle,temporaryRest:r.temporaryRest,stopDuration:r.stopDuration};
        r.currentSpeed=0;
        while(remaining>1e-8){
          if(r.wait>0){var rest=Math.min(r.wait,remaining);r.wait=Math.max(0,r.wait-rest);remaining-=rest;continue;}
          var a=r.path[actor.segment],b=r.path[actor.segment+r.direction],length=Math.hypot(b.x-a.x,b.z-a.z);
          if(actor.legLength===null){actor.legLength=Math.max(1e-8,length-actor.legStart);actor.legPeak=Math.min(r.peakSpeed,2*actor.legLength/.75);actor.duration=actor.legLength/actor.legPeak+.375;}
          var used=Math.min(remaining,actor.duration-actor.elapsed);actor.elapsed+=used;remaining-=used;
          var state=profile(actor,actor.elapsed);actor.distance=Math.min(length,actor.legStart+state.distance);r.currentSpeed=state.speed;
          var t=actor.distance/length;r.x=a.x+(b.x-a.x)*t;r.z=a.z+(b.z-a.z)*t;r.progress=actor.segment+r.direction*t;
          if(actor.elapsed>=actor.duration-1e-8)arrive(actor);
        }
        var blocker=actors.find(function(other){return other!==actor&&Math.hypot(r.x-other.record.x,r.z-other.record.z)<.60;});
        if(blocker){
          ['segment','distance','legStart','elapsed','legLength','legPeak','duration'].forEach(function(k){actor[k]=saved[k];});
          r.x=saved.x;r.z=saved.z;r.progress=saved.progress;r.direction=saved.direction;r.wait=saved.wait;r.currentSpeed=0;['roundTrips','restChecks','restCount','nextRestCycle','temporaryRest','stopDuration'].forEach(function(k){r[k]=saved[k];});
          if(actor.order>blocker.order&&r.wait<=0&&actor.distance>.05){var from=r.path[actor.segment],to=r.path[actor.segment+r.direction];actor.distance=Math.hypot(to.x-from.x,to.z-from.z)-actor.distance;actor.segment+=r.direction;r.direction*=-1;r.wait=.35;}
          resetLeg(actor);
        }
        turn(actor,delta);
        var travelled=Math.hypot(r.x-saved.x,r.z-saved.z);actor.gaitPhase+=travelled*10;r.gaitPhase=actor.gaitPhase;
        r.current.x=r.x;r.current.z=r.z;r.current.y=cfg.heightAt(r.x,r.z)+.02;
        cfg.orient(dummy,r.x,r.z,r.current.y,r.yaw);dummy.updateMatrix();actor.mesh.setMatrixAt(actor.index,dummy.matrix);
        var attr=actor.mesh.geometry.attributes.residentMotion;attr.setX(actor.index,actor.gaitPhase);attr.setY(actor.index,r.wait>0?0:r.currentSpeed/.95);
      });
      var touched=new Set();actors.forEach(function(a){touched.add(a.mesh);});touched.forEach(function(mesh){mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.residentMotion.needsUpdate=true;});
      return true;
    }
    return{material:material,uniform:uniform,prepare:prepare,add:add,update:update,dispose:function(){if(disposed)return;disposed=true;actors.length=0;material.dispose();}};
  };
  var C={cream:0xffedce,pink:0xe9879e,wood:0x9c704c,blue:0x72bac9,white:0xfff8e8,dark:0x493c3a,stone:0xc9b69b,green:0x76a96a,gold:0xf1c765,red:0xb75c63,skin:0xf6cba0};
  var PLANS=[
    {id:'project-hall',region:'collaboration',center:[6,-21],seeds:[[7,-28],[15,-27],[2,-31]],types:['bakery','florist','market']},
    {id:'automation-post',region:'automation',center:[-30,5],seeds:[[-34,-3],[-24,-5],[-39,4]],types:['mill','water-tower','farmhouse']},
    {id:'data-observatory',region:'connection',center:[12,18],seeds:[[21,14],[27,18],[8,12]],types:['lighthouse','fishing-hut','fish-market']},
    {id:'service-station',region:'desert',center:[-42,11],seeds:[[-49,4],[-51,12],[-38,21]],types:['caravanserai','spice-market','oasis-house']},
    {id:'knowledge-library',region:'snow',center:[-23,-27],seeds:[[-35,-22],[-23,-43],[-17,-30]],types:['snow-chalet','alpine-inn','woodcutter']},
    {id:'integration-garage',region:'lava',center:[26,-14],seeds:[[24,-6],[34,-6],[39,-16]],types:['repair-shed','foundry','supply-depot']}
  ];
  var RESERVED=[[0,-14,5.5],[-26,12,4.3],[18,26,4.4],[-49,22,4.8],[-42,28,3.5],[36,-25,5],[-7,-10,1.8],[7,-10,1.8],[-6,-3,1.8],[6,-3,1.8],[-10,-17,1.8],[10,-17,1.8],[-37,-37,4.8],[-29,-37,3.5],[-42,-29,3.6],[-11,-7,1],[11,-7,1],[-30,16,1], [22,25,1],[-24,7,1]];
  // Existing enrichment can search 3.5 units away from these authored seeds.
  var ENRICHMENT=[[6,-21],[2,-22],[-30,5],[-26,3],[12,18],[17,19],[-42,11],[-46,14],[-23,-27],[-27,-32],[26,-14],[31,-14]];
  function build(T,parent,options){
    var opts=options||{},geo=root.MarioWorldGeography;
    if(!geo||!geo.mapToDirection||!geo.terrainRadiusAt)throw new Error('MarioVillageLife requires MarioWorldGeography');
    var kind=opts.kind==='globe'?'globe':'map',heightAt=typeof opts.heightAt==='function'?opts.heightAt:geo.heightAt;
    var group=new T.Group();group.name='mario-village-life';
    var material=new T.MeshLambertMaterial({color:0xffffff,vertexColors:true}),pool=new Map(),paints=new Map();
    var sites=[],pickTargets=[],residents=[],props=0,up=new T.Vector3(0,1,0),scale=kind==='globe'?.014*1.15:1;
    function geometry(key,make){if(!pool.has(key))pool.set(key,make());return pool.get(key);}
    function paint(hex){if(!paints.has(hex))paints.set(hex,new T.MeshBasicMaterial({color:hex}));return paints.get(hex);}
    function part(g,shape,color,x,y,z,sx,sy,sz,rx,ry,rz){var m=new T.Mesh(shape,paint(color));m.position.set(x||0,y||0,z||0);m.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);m.rotation.set(rx||0,ry||0,rz||0);g.add(m);return m;}
    function box(g,c,x,y,z,w,h,d,rx,ry,rz){return part(g,geometry('box',function(){return new T.BoxGeometry(1,1,1);}),c,x,y,z,w,h,d,rx,ry,rz);}
    function ball(g,c,x,y,z,w,h,d){return part(g,geometry('ball',function(){return new T.SphereGeometry(1,7,5);}),c,x,y,z,w,h,d);}
    function cyl(g,c,x,y,z,rt,rb,h,n,rx,ry,rz){return part(g,geometry(['c',rt,rb,h,n||8].join('/'),function(){return new T.CylinderGeometry(rt,rb,h,n||8);}),c,x,y,z,1,1,1,rx,ry,rz);}
    function roof(g,c,y,w,d){box(g,c,-w*.24,y,0,w*.59,.16,d,0,0,.53);box(g,c,w*.24,y,0,w*.59,.16,d,0,0,-.53);}
    function compile(source,name,placeId){
      source.updateMatrixWorld(true);var p=[],n=[],c=[],uv=[],idx=[],v=new T.Vector3(),normal=new T.Vector3(),nm=new T.Matrix3();
      source.traverse(function(o){if(!o.isMesh)return;var a=o.geometry.attributes.position,na=o.geometry.attributes.normal,ca=o.geometry.attributes.color,co=o.material.color,offset=p.length/3;nm.getNormalMatrix(o.matrixWorld);
        for(var i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);normal.fromBufferAttribute(na,i).applyMatrix3(nm).normalize();p.push(v.x,v.y,v.z);n.push(normal.x,normal.y,normal.z);c.push(co.r*(ca?ca.getX(i):1),co.g*(ca?ca.getY(i):1),co.b*(ca?ca.getZ(i):1));var ua=o.geometry.attributes.uv;uv.push(ua?ua.getX(i):0,ua?ua.getY(i):0);}
        var index=o.geometry.index;if(index){for(var j=0;j<index.count;j++)idx.push(offset+index.getX(j));}else for(var j=0;j<a.count;j++)idx.push(offset+j);
      });
      var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(n,3));g.setAttribute('color',new T.Uint16BufferAttribute(c.map(function(v){return Math.round(Math.max(0,Math.min(1,v))*65535);}),3,true));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeBoundingBox();g.computeBoundingSphere();var mesh=new T.Mesh(g,material);mesh.name=name;if(placeId)mesh.userData.placeId=placeId;mesh.userData.demoOnly=true;return mesh;
    }
    var roads=(geo.routeDefinitions||[]).map(function(r){var curve=new T.CatmullRomCurve3(r.controls.map(function(p){return new T.Vector3(p[0],0,p[1]);}));return curve.getPoints(Math.max(100,Math.ceil(curve.getLength()*5)));});
    roads.push([new T.Vector3(0,0,-10.5),new T.Vector3(0,0,-2.5)]);
    // Bucket segments once; clearance tests only need distances within eight units.
    var roadCells=new Map(),cellSize=8;
    roads.forEach(function(points){for(var i=1;i<points.length;i++){var a=points[i-1],b=points[i],s={x:a.x,z:a.z,dx:b.x-a.x,dz:b.z-a.z};s.length2=s.dx*s.dx+s.dz*s.dz||1;
      for(var cx=Math.floor((Math.min(a.x,b.x)-8)/cellSize);cx<=Math.floor((Math.max(a.x,b.x)+8)/cellSize);cx++)for(var cz=Math.floor((Math.min(a.z,b.z)-8)/cellSize);cz<=Math.floor((Math.max(a.z,b.z)+8)/cellSize);cz++){var key=cx+','+cz;if(!roadCells.has(key))roadCells.set(key,[]);roadCells.get(key).push(s);}
    }});
    function roadDistance(x,z){var best=64,segments=roadCells.get(Math.floor(x/cellSize)+','+Math.floor(z/cellSize))||[];for(var i=0;i<segments.length;i++){var s=segments[i],t=Math.max(0,Math.min(1,((x-s.x)*s.dx+(z-s.z)*s.dz)/s.length2)),dx=x-s.x-t*s.dx,dz=z-s.z-t*s.dz;best=Math.min(best,dx*dx+dz*dz);}return Math.sqrt(best);}
    var exclusions=RESERVED.slice();ENRICHMENT.forEach(function(p){exclusions.push([p[0],p[1],5.7]);});
    (Array.isArray(opts.places)?opts.places:[]).forEach(function(p){var v=p.position||p;if(Number.isFinite(v.x)&&Number.isFinite(v.z))exclusions.push([v.x,v.z,p.radius||2.3]);if(p.front)exclusions.push([p.front.x,p.front.z,1.5]);});
    function safe(x,z,r){
      if(x-r<geo.bounds.minX||x+r>geo.bounds.maxX||z-r<geo.bounds.minZ||z+r>geo.bounds.maxZ)return null;
      if(roadDistance(x,z)<r+1.1||exclusions.some(function(p){return Math.hypot(x-p[0],z-p[1])<r+p[2];})||sites.some(function(p){return Math.hypot(x-p.x,z-p.z)<r+p.radius+.4;}))return null;
      var low=Infinity,high=-Infinity;for(var i=0;i<=16;i++){var a=i*Math.PI/8,rr=i===16?0:r,px=x+Math.cos(a)*rr,pz=z+Math.sin(a)*rr,h=heightAt(px,pz);if(!Number.isFinite(h)||h<Math.max(1.05,geo.seaLevel+.35)||geo.riverDistance(px,pz)<3.8||geo.coastField(px,pz)<.19)return null;low=Math.min(low,h);high=Math.max(high,h);}
      if(high-low>4.2)return null;return{x:x,z:z,y:high+.045,low:low,radius:r,roadDistance:roadDistance(x,z)};
    }
    function findSite(seed,plan){var best=null;for(var ring=0;ring<=16;ring++){var count=ring?ring*10:1;for(var j=0;j<count;j++){var angle=j/count*Math.PI*2,x=seed[0]+Math.cos(angle)*ring*.85,z=seed[1]+Math.sin(angle)*ring*.85;if(Math.hypot(x-plan.center[0],z-plan.center[1])>20)continue;var s=safe(x,z,2.9);if(!s)continue;var score=ring*.85+(s.y-s.low)*1.4;if(!best||score<best.score){s.score=score;best=s;}}if(best&&ring*.85>best.score+1)break;}return best;}
    function orient(object,x,z,y,yaw){var q=new T.Quaternion().setFromAxisAngle(up,yaw);if(kind==='globe'){var d=geo.mapToDirection(x,z),normal=new T.Vector3(d.x,d.y,d.z);object.position.copy(normal).multiplyScalar(geo.terrainRadiusAt(x,z)+(y-heightAt(x,z))*.012+.001);object.quaternion.setFromUnitVectors(up,normal).multiply(q);object.scale.setScalar(scale);}else{object.position.set(x,y,z);object.quaternion.copy(q);object.scale.setScalar(1);}return object;}
    function flowerbox(g,x,z){props++;box(g,C.wood,x,.32,z,.64,.24,.33);box(g,C.dark,x,.45,z,.53,.025,.25);for(var k=0;k<3;k++){var px=x+(k-1)*.19;box(g,C.green,px,.59,z,.035,.27,.035);for(var j=0;j<4;j++){var a=j*Math.PI/2;ball(g,[C.pink,C.gold,C.blue][k],px+Math.cos(a)*.065,.74,z+Math.sin(a)*.065,.08,.055,.08);}ball(g,C.gold,px,.77,z,.04,.04,.04);}}
    function awning(g,color){for(var i=0;i<6;i++)box(g,i%2?C.white:color,-1.05+i*.42,1.77,1.17,.42,.10,.86,-.16);[-1.19,1.19].forEach(function(x){box(g,C.wood,x,.88,1.48,.07,1.76,.07);});}
    function cart(g){props++;box(g,C.wood,1.47,.43,.38,.55,.13,.8);[-1,1].forEach(function(s){cyl(g,C.dark,1.47+s*.32,.27,.38,.25,.25,.08,8,0,0,Math.PI/2);box(g,C.wood,1.47+s*.23,.68,.38,.055,.42,.82);box(g,C.wood,1.47+s*.23,.55,.98,.06,.06,.55);});box(g,C.gold,1.47,.65,.38,.4,.28,.45);}
    function lamp(g){props++;cyl(g,C.dark,-1.58,1.03,.88,.045,.065,2.06,6);box(g,C.gold,-1.58,2.12,.88,.26,.34,.26);roof(g,C.dark,2.34,.42,.42);}
    function well(g){props++;cyl(g,C.stone,1.44,.32,.44,.35,.39,.55,8);cyl(g,C.dark,1.44,.61,.44,.27,.27,.035,8);[-1,1].forEach(function(s){box(g,C.wood,1.44+s*.33,.95,.44,.06,.9,.06);});roof(g,C.pink,1.48,.91,.8);}
    function farm(g){props++;box(g,0x795c42,1.47,.08,.35,.7,.12,1.15);for(var k=0;k<4;k++){box(g,C.green,1.47,.24,-.06+k*.28,.56,.19,.09);box(g,C.gold,1.47,.37,-.06+k*.28,.07,.12,.07);}}
    function house(type,index){
      var g=new T.Group(),snow=/snow|alpine|woodcutter/.test(type),desert=/caravan|spice|oasis/.test(type),industrial=/repair|foundry|depot/.test(type),roofColor=snow?C.blue:industrial?C.dark:index%2?C.blue:C.pink;
      if(type==='lighthouse'){
        for(var i=0;i<5;i++)cyl(g,i%2?C.blue:C.white,0,.36+i*.57,0,.65-i*.055,.69-i*.055,.57,10);
        cyl(g,C.dark,0,3.03,0,.64,.64,.12,10);cyl(g,C.gold,0,3.28,0,.38,.38,.43,8);for(var j=0;j<4;j++){var a=j*Math.PI/2;box(g,C.white,Math.sin(a)*.39,3.28,Math.cos(a)*.39,.055,.45,.055);}part(g,geometry('beacon-roof',function(){return new T.ConeGeometry(.66,.38,8);}),C.blue,0,3.7,0);box(g,C.wood,0,.45,.69,.34,.7,.06);
      }else if(type==='water-tower'){
        [-.69,.69].forEach(function(x){[-.55,.55].forEach(function(z){box(g,C.wood,x,1.15,z,.13,2.3,.13);});});for(var j=0;j<2;j++)box(g,C.wood,0,1.03,j?-.55:.55,1.72,.10,.10,0,0,j?.65:-.65);cyl(g,C.blue,0,2.31,0,.83,.83,1.0,10);[1.88,2.73].forEach(function(y){cyl(g,C.dark,0,y,0,.85,.85,.08,10);});part(g,geometry('tank-roof',function(){return new T.ConeGeometry(.94,.4,10);}),C.pink,0,3.01,0);box(g,C.wood,-.78,1.4,.65,.065,2.8,.065);for(var k=0;k<9;k++)box(g,C.wood,-.59,.2+k*.29,.65,.4,.055,.055);
      }else{
        var market=/market/.test(type);box(g,desert?0xe6c18a:snow?C.wood:C.cream,0,.91,0,2.15,1.74,1.62);box(g,C.stone,0,.13,0,2.28,.26,1.75);
        if(desert){box(g,C.cream,0,1.87,0,2.42,.21,1.9);[-1,1].forEach(function(s){box(g,C.cream,s*1.08,2.05,0,.17,.3,1.85);});box(g,C.blue,0,1.91,0,1.8,.035,1.37);}else{roof(g,roofColor,2.08,2.72,2.04);if(snow){roof(g,C.white,2.18,2.78,2.11);box(g,C.stone,.65,2.27,-.4,.24,.89,.26);}else box(g,C.wood,.67,2.16,-.37,.23,.7,.25);}
        box(g,C.dark,0,.62,.834,.47,1.02,.06);box(g,C.wood,0,.59,.875,.36,.94,.045);ball(g,C.gold,.12,.59,.91,.032,.032,.025);
        [-.72,.72].forEach(function(x){box(g,C.white,x,1.06,.84,.48,.57,.055);box(g,C.blue,x,1.06,.879,.37,.44,.026);box(g,C.wood,x,1.06,.902,.035,.46,.026);box(g,C.wood,x,1.06,.902,.38,.035,.026);});box(g,C.wood,0,1.63,.85,2.17,.09,.08);
        if(type==='bakery'){awning(g,C.pink);box(g,C.wood,0,1.49,.95,.88,.39,.08);for(var j=0;j<5;j++){var a=(j/4)*Math.PI;ball(g,C.gold,Math.cos(a)*.25,1.49+Math.sin(a)*.14,1.03,.115-j%2*.02,.09,.07);}box(g,C.white,-.5,.82,.94,.34,.04,.08);}
        else if(type==='florist'){awning(g,C.green);flowerbox(g,-.71,1.12);flowerbox(g,.71,1.12);}
        else if(market){awning(g,desert?C.gold:C.blue);box(g,C.wood,0,.58,1.24,2.02,.15,.62);for(var j=0;j<3;j++){box(g,C.wood,-.65+j*.65,.72,1.22,.57,.18,.46);for(var k=0;k<3;k++)ball(g,[C.red,C.gold,C.green][j],-.82+j*.65+k*.16,.86,1.22,.09,.085,.1);}}
        else if(type==='mill'){cyl(g,C.cream,0,1.57,0,.62,.93,2.8,8);part(g,geometry('mill-roof',function(){return new T.ConeGeometry(.93,.82,8);}),C.pink,0,3.36,0);cyl(g,C.wood,0,2.44,1.0,.16,.16,.28,8,Math.PI/2);for(var j=0;j<4;j++){var a=j*Math.PI/2+.35;box(g,C.wood,Math.sin(a)*.8,2.44+Math.cos(a)*.8,1.11,.13,1.69,.085,0,0,-a);box(g,C.white,Math.sin(a)*1.04+Math.cos(a)*.15,2.44+Math.cos(a)*1.04-Math.sin(a)*.15,1.14,.37,.91,.06,0,0,-a);}}
        else if(type==='fishing-hut'){box(g,C.blue,-.88,1.35,.92,.15,.84,.1,0,0,-.24);for(var j=0;j<4;j++)box(g,C.wood,.54+j*.12,1.09,.96,.024,.61,.025,0,0,-.3);cyl(g,C.gold,.7,.51,1.03,.23,.23,.06,10,Math.PI/2);}
        else if(industrial){box(g,C.dark,.57,.66,.91,.78,.9,.065);box(g,C.blue,.57,.69,.96,.63,.68,.035);for(var j=0;j<3;j++)box(g,C.wood,.57,.48+j*.2,.99,.65,.035,.03);box(g,C.gold,-.6,1.13,.96,.1,.56,.06,0,0,.65);cyl(g,C.gold,-.43,1.33,.96,.16,.16,.06,6,Math.PI/2);}
        else if(snow){box(g,C.wood,0,1.58,.96,2.38,.12,.22);[-1,1].forEach(function(s){box(g,C.wood,s*.97,.86,1.02,.1,1.43,.1);});}
        else flowerbox(g,-.73,1.06);
      }
      // Construction follows each silhouette, within the original site footprint.
      if(type==='water-tower'){
        [-1,1].forEach(function(s){box(g,C.dark,s*.69,1.18,0,.07,.08,1.5,.66);box(g,C.cream,s*.69,2.3,.51,.07,.67,.05);});
        cyl(g,C.dark,.91,1.19,0,.055,.055,2.22,6);box(g,C.gold,.91,.17,.12,.12,.10,.26);
      }else if(type==='lighthouse'){
        cyl(g,C.white,0,3.08,0,.76,.76,.045,10);
        for(var k=0;k<8;k++){var a=k*Math.PI/4;box(g,C.dark,Math.sin(a)*.70,3.22,Math.cos(a)*.70,.035,.3,.035);}
        box(g,C.gold,0,2.05,.55,.19,.28,.06);box(g,C.stone,0,.08,.79,.60,.12,.35);
      }else{
        [-1,1].forEach(function(side){
          box(g,C.wood,side*1.055,.95,.79,.08,1.48,.08);
          box(g,C.wood,side*.72,.73,.92,.62,.07,.15);
          box(g,C.wood,side*.99,1.06,.91,.08,.55,.055);
          box(g,C.white,side*1.09,1.14,-.20,.055,.62,.54);
          box(g,C.blue,side*1.124,1.14,-.20,.025,.48,.40);
          box(g,C.wood,side*1.143,1.14,-.20,.025,.48,.032);
          box(g,C.wood,side*1.143,1.14,-.20,.025,.032,.42);
        });
        box(g,C.stone,0,.07,1.0,.70,.12,.40);
        box(g,C.wood,0,1.20,.91,.59,.065,.12);
        [0,.24].forEach(function(y){box(g,C.dark,-.13,.43+y,.905,.12,.022,.018);});
        if(!desert){
          box(g,C.wood,0,2.45,0,.11,.10,2.05);
          [-1,1].forEach(function(side){box(g,C.wood,side*1.27,1.77,0,.10,.10,2.07);box(g,C.cream,side*.55,2.10,1.035,1.25,.055,.065,0,0,-side*.53);});
          for(var k=0;k<3;k++){var z=-.65+k*.65;[-1,1].forEach(function(side){box(g,roofColor,side*.65,2.15,z,1.40,.045,.045,0,0,-side*.53);});}
        }else{
          box(g,C.wood,0,1.55,.9,.68,.12,.23);box(g,C.cream,0,2.06,-.88,2.2,.24,.14);
          [-.58,.58].forEach(function(x){box(g,C.red,x,1.86,.97,.14,.18,.045);});
        }
        if(type==='mill'){for(var k=0;k<4;k++){var a=k*Math.PI/2+.35;for(var r=0;r<3;r++)box(g,C.wood,Math.sin(a)*(.73+r*.27)+Math.cos(a)*.15,2.44+Math.cos(a)*(.73+r*.27)-Math.sin(a)*.15,1.19,.39,.025,.025,0,0,-a);}}
        if(industrial){box(g,C.stone,.67,2.53,-.37,.34,.11,.35);for(var k=0;k<3;k++)box(g,C.gold,-.6+k*.13,1.13,.998,.055,.055,.025);}
        if(snow){[-.72,0,.72].forEach(function(x){box(g,C.dark,x,.88,-.83,.10,1.4,.06);});}
      }
      if(index%4===0)cart(g);else if(index%4===1)lamp(g);else if(index%4===2)well(g);else farm(g);
      return g;
    }
    PLANS.forEach(function(plan,regionIndex){var batch=new T.Group();plan.types.forEach(function(type,j){var site=findSite(plan.seeds[j],plan);if(!site)return;var yaw=Math.atan2(plan.center[0]-site.x,plan.center[1]-site.z),model=house(type,regionIndex*3+j);var depth=site.y-site.low+.16;
      box(model,C.stone,0,-depth*.5,0,4.05,depth,3.9);props++;orient(model,site.x,site.z,site.y,yaw);batch.add(model);site.id='village-'+type;site.placeId=plan.id;site.region=plan.region;site.type=type;site.width=4.05;site.depth=3.9;site.yaw=yaw;site.foundationBottom=site.low-.16;site.position=model.position.clone();sites.push(site);
    });if(batch.children.length){var mesh=compile(batch,'village-architecture-'+plan.id,plan.id);group.add(mesh);pickTargets.push(mesh);}batch.clear();});
    function npc(type){var g=new T.Group(),shirt=[C.white,C.green,C.blue,0xd78b59,C.pink,0xc4b361][type],skin=type%2?0xdca87e:C.skin;
      box(g,shirt,0,.65,0,.33,.39,.24);box(g,C.wood,0,.46,0,.35,.07,.26);[-1,1].forEach(function(s){box(g,type===2?C.white:C.dark,s*.092,.27,0,.12,.32,.14);box(g,C.dark,s*.092,.09,.045,.15,.13,.26);box(g,shirt,s*.228,.65,0,.12,.35,.14,0,0,s*.2);ball(g,skin,s*.26,.45,.01,.065,.07,.065);});
      ball(g,skin,0,1.01,0,.19,.2,.17);ball(g,C.wood,0,1.13,-.025,.19,.11,.16);[-1,1].forEach(function(s){box(g,C.white,s*.067,1.035,.154,.065,.08,.027);box(g,C.dark,s*.063,1.03,.173,.026,.045,.014);});ball(g,skin,0,.995,.181,.035,.04,.037);box(g,C.red,0,.935,.16,.065,.014,.018);
      if(type===0){cyl(g,C.white,0,1.22,0,.17,.18,.16,8);[-.12,0,.12].forEach(function(x){ball(g,C.white,x,1.34,0,.11,.11,.12);});box(g,C.wood,.35,.62,.1,.06,.64,.05);ball(g,C.gold,.35,.99,.1,.11,.16,.035);box(g,C.cream,0,.62,.137,.24,.31,.025);}
      else if(type===1){cyl(g,C.gold,0,1.18,0,.27,.27,.055,10);cyl(g,C.gold,0,1.24,0,.16,.18,.12,8);box(g,C.wood,.34,.51,.02,.04,.96,.04);box(g,C.stone,.34,.11,.02,.19,.24,.055);}
      else if(type===2){cyl(g,C.white,0,1.22,0,.19,.19,.11,8);box(g,C.blue,0,.85,.15,.31,.1,.045);cyl(g,C.gold,.29,.44,.07,.12,.16,.2,8);}
      else if(type===3){cyl(g,C.gold,0,1.22,0,.2,.2,.13,8);box(g,C.wood,.32,.63,.04,.05,.47,.05);box(g,C.stone,.32,.89,.04,.24,.12,.12);box(g,C.wood,0,.57,.15,.28,.25,.03);}
      else if(type===4){cyl(g,C.blue,0,1.23,0,.18,.19,.16,8);ball(g,C.white,0,1.36,0,.07,.07,.07);box(g,C.gold,0,.85,.02,.42,.09,.31);box(g,C.gold,.17,.68,.14,.09,.32,.04);box(g,C.wood,.34,.5,.04,.045,.98,.045);}
      else {cyl(g,C.green,0,1.21,0,.24,.25,.045,9);cyl(g,C.green,0,1.27,0,.15,.18,.12,8);box(g,C.red,0,.68,-.18,.38,.45,.22);box(g,C.cream,0,.68,-.304,.27,.25,.035);[-1,1].forEach(function(s){box(g,C.gold,s*.12,.65,.14,.035,.35,.025);});box(g,C.wood,.33,.5,0,.04,1,.04);}
      // Six occupational outfits share the same hand/face/boot construction.
      [-1,1].forEach(function(s){
        part(g,geometry('ear',function(){return new T.IcosahedronGeometry(1,0);}),skin,s*.19,1.005,0,.035,.052,.035);
        box(g,C.wood,s*.145,1.095,.08,.055,.11,.06,0,0,s*.2);
        box(g,C.wood,s*.064,1.093,.171,.055,.014,.018,0,0,s*(type===3?.17:-.10));
        box(g,C.white,s*.062,1.044,.184,.012,.014,.008);
        box(g,C.cream,s*.075,.81,.137,.10,.09,.025,0,0,s*.35);
        box(g,C.dark,s*.092,.025,.06,.16,.025,.27);
        box(g,skin,s*.287,.47,.043,.035,.05,.04);
      });
      box(g,C.gold,0,.46,.14,.065,.045,.02);
      box(g,type===0?C.dark:C.gold,0,.71,.15,.025,.025,.02);
      if(type===0){box(g,C.wood,0,.57,.16,.15,.025,.02);box(g,C.white,-.1,.63,.16,.045,.08,.025);}
      else if(type===1){box(g,C.wood,0,.61,.15,.20,.16,.035);box(g,C.gold,0,.69,.17,.05,.025,.02);}
      else if(type===2){box(g,C.red,0,.79,.18,.09,.11,.025);box(g,C.white,.29,.53,.08,.08,.025,.08);}
      else if(type===3){[-.07,.07].forEach(function(x){box(g,C.dark,x,1.04,.184,.09,.07,.025);box(g,C.blue,x,1.04,.20,.063,.042,.01);});box(g,C.dark,0,1.04,.19,.04,.015,.02);}
      else if(type===4){box(g,C.cream,0,.95,.171,.10,.025,.018);box(g,C.gold,0,.80,-.21,.28,.09,.02);}
      else{box(g,C.wood,0,.51,-.30,.3,.065,.06);box(g,C.gold,0,.69,-.33,.06,.055,.02);}
      return g;
    }

    var town={sites:[],street:[],residents:[],length:0,width:4},townBatch=new T.Group();
    function townPoint(x,z,margin){
      if(x-margin<geo.bounds.minX||x+margin>geo.bounds.maxX||z-margin<geo.bounds.minZ||z+margin>geo.bounds.maxZ)return false;
      return heightAt(x,z)>1.05&&geo.riverDistance(x,z)>=4.2&&roadDistance(x,z)>=1.74&&
        !sites.some(function(s){return Math.hypot(x-s.x,z-s.z)<s.radius+.35;})&&
        !exclusions.some(function(p){return Math.hypot(x-p[0],z-p[1])<p[2]+.35;});
    }
    function townCircle(x,z,r,definitions){
      if(!townPoint(x,z,r)||town.sites.some(function(s){return Math.hypot(x-s.x,z-s.z)<r+s.radius+.45;})||definitions.some(function(d){return Math.hypot(x-d.x,z-d.z)<r+.65;}))return false;
      for(var k=0;k<16;k++){var a=k*Math.PI/8;if(!townPoint(x+Math.cos(a)*r,z+Math.sin(a)*r,0))return false;}
      return true;
    }
    function buildTown(definitions){
      var candidates=[];
      roads.slice(0,2).forEach(function(points,routeIndex){for(var i=3;i<points.length-3;i++){
        var p=points[i],before=points[i-1],after=points[i+1],dx=after.x-before.x,dz=after.z-before.z,len=Math.hypot(dx,dz),nx=dz/len,nz=-dx/len;
        if(candidates.length&&Math.hypot(p.x-candidates[candidates.length-1].roadX,p.z-candidates[candidates.length-1].roadZ)<.95)continue;
        candidates.push({routeIndex:routeIndex,roadX:p.x,roadZ:p.z,nx:nx,nz:nz,yaw:Math.atan2(dx,dz)});
      }});
      // Keep one consistent side of the existing road, omitting obstructed footprints.
      var best=[];
      [0,1].forEach(function(routeIndex){var routeBest=[];
        [-1,1].forEach(function(side){var tiles=[];candidates.filter(function(c){return c.routeIndex===routeIndex;}).forEach(function(c){
          var x=c.roadX+c.nx*5.2*side,z=c.roadZ+c.nz*5.2*side,valid=true;
          for(var u=-2;u<=2;u+=1)for(var v=-.5;v<=.5;v+=.5){var px=x+c.nx*u+c.nz*v,pz=z+c.nz*u-c.nx*v;if(!townPoint(px,pz,0))valid=false;}
          if(valid)tiles.push({x:x,z:z,yaw:c.yaw,nx:c.nx,nz:c.nz});
        });if(tiles.length>routeBest.length)routeBest=tiles;});
        best=best.concat(routeBest);
      });
      best.slice(0,56).forEach(function(p,i){
        var model=new T.Group();
        for(var col=0;col<4;col++)box(model,(i+col)%3?C.stone:C.cream,-1.5+col,.035,0,.97,.07,.94);
        orient(model,p.x,p.z,heightAt(p.x,p.z)+.025,p.yaw);townBatch.add(model);town.street.push({x:p.x,z:p.z,yaw:p.yaw,width:4,length:.98});
      });town.length=town.street.length*.98;
      function locate(kind,index,r){
        var seeds=best.map(function(p,i){var side=(index%2?1:-1),d=4.2;return{x:p.x+p.nx*d*side,z:p.z+p.nz*d*side,yaw:p.yaw+(side>0?-Math.PI/2:Math.PI/2),score:Math.abs(i-(index+1)*best.length/8)};});
        seeds.sort(function(a,b){return a.score-b.score;});
        for(var k=0;k<seeds.length;k++)if(townCircle(seeds[k].x,seeds[k].z,r,definitions))return seeds[k];
        for(var ring=0;ring<14;ring++)for(var k=0;k<64;k++){var a=k*Math.PI/32,x=-12+Math.cos(a)*(3+ring),z=6+Math.sin(a)*(3+ring);if(townCircle(x,z,r,definitions))return{x:x,z:z,yaw:Math.atan2(-12-x,6-z)};}
        throw new Error('No safe town site for '+kind);
      }
      function register(kind,index,r,model){var p=locate(kind,index,r),y=heightAt(p.x,p.z),low=y,high=y;
        for(var k=0;k<16;k++){var a=k*Math.PI/8,h=heightAt(p.x+Math.cos(a)*r,p.z+Math.sin(a)*r);low=Math.min(low,h);high=Math.max(high,h);}
        var depth=high-low+.12;box(model,C.stone,0,-depth*.5,0,r*1.5,depth,r*1.5);orient(model,p.x,p.z,high+.03,p.yaw);townBatch.add(model);
        var record={id:'town-'+kind+'-'+index,type:kind,x:p.x,z:p.z,y:high+.03,radius:r,yaw:p.yaw,placeId:['project-hall','automation-post','data-observatory'][index%3],region:['collaboration','automation','connection'][index%3]};town.sites.push(record);return record;
      }
      for(var i=0;i<6;i++){
        var g=new T.Group(),color=[C.cream,0xeab99c,0xe9d4aa][i%3];box(g,color,0,1.56,0,2.3,3.05,1.9);box(g,C.wood,0,1.55,0,2.36,.10,1.94);roof(g,i%2?C.blue:C.pink,3.42,2.68,2.22);
        box(g,C.wood,.69,3.53,-.38,.22,.78,.25);box(g,C.stone,.69,3.92,-.38,.30,.10,.33);box(g,C.wood,0,.55,.98,.40,1.03,.07);box(g,C.gold,.12,.55,1.03,.035,.04,.025);
        for(var floor=0;floor<2;floor++)[-.75,.75].forEach(function(x){box(g,C.white,x,1.0+floor*1.4,.98,.48,.65,.07);box(g,C.blue,x,1.0+floor*1.4,1.025,.35,.50,.025);box(g,C.wood,x,1.0+floor*1.4,1.045,.035,.50,.02);box(g,C.wood,x,.65+floor*1.4,1.03,.56,.07,.16);});
        [-1,1].forEach(function(side){box(g,C.wood,side*1.22,3.12,0,.09,.09,2.22);});register('rowhouse',i,1.9,g);
      }
      for(var i=0;i<3;i++){var g=new T.Group();[-1,1].forEach(function(side){box(g,C.wood,side*.83,1.0,0,.07,2,.07);});box(g,C.wood,0,.85,0,1.9,.16,1.0);for(var k=0;k<4;k++)box(g,k%2?C.white:[C.pink,C.blue,C.gold][i],-.72+k*.48,2.04,0,.48,.10,1.55,.1);for(var k=0;k<3;k++)box(g,[C.red,C.gold,C.green][k],-.6+k*.6,1.03,0,.42,.24,.60);register('stall',i+6,1.35,g);}
      var plaza=new T.Group();cyl(plaza,C.cream,0,.035,0,2.25,2.25,.07,24);cyl(plaza,C.stone,0,.1,0,.64,.72,.20,12);cyl(plaza,C.blue,0,.22,0,.55,.55,.035,12);[-1,1].forEach(function(side){box(plaza,C.wood,side*1.46,.42,0,.42,.12,1.45);box(plaza,C.wood,side*1.67,.67,0,.08,.48,1.45);[-.48,.48].forEach(function(z){box(plaza,C.dark,side*1.46,.22,z,.28,.40,.09);});});register('plaza',9,2.3,plaza);
      var mesh=compile(townBatch,'village-town-main-street','project-hall');group.add(mesh);pickTargets.push(mesh);townBatch.clear();
      for(var i=0;i<8;i++){
        var anchor=town.sites[i%6],found=null;
        for(var k=0;k<96;k++){var a=k*Math.PI/48,r=3.1+Math.floor(k/32)*.5,x=anchor.x+Math.sin(a)*r,z=anchor.z+Math.cos(a)*r;
          if(townPoint(x,z,0)&&!town.sites.some(function(s){return Math.hypot(x-s.x,z-s.z)<s.radius+.5;})&&!definitions.some(function(d){return Math.hypot(x-d.x,z-d.z)<.75;})){found={x:x,z:z,placeId:anchor.placeId,id:'town-resident-'+i,type:i%6,yaw:anchor.yaw};break;}
        }
        if(!found)throw new Error('No safe town resident origin '+i);definitions.push(found);town.residents.push(found.id);
      }
    }
    // Four residents per business, six distinct reusable prototypes, never original NPC IDs.
    var definitions=[];PLANS.forEach(function(plan,r){var local=sites.filter(function(s){return s.placeId===plan.id;});if(!local.length)return;for(var i=0;i<4;i++){var site=local[i%local.length],found=null;for(var k=0;k<24;k++){var a=(i*.9+k*.38),rr=3.2+Math.floor(k/12)*.45,x=site.x+Math.sin(a)*rr,z=site.z+Math.cos(a)*rr;if(heightAt(x,z)>1.05&&geo.riverDistance(x,z)>4.05&&roadDistance(x,z)>1.15&&!exclusions.some(function(p){return Math.hypot(x-p[0],z-p[1])<p[2]+.35;})&&!sites.some(function(p){return Math.hypot(x-p.x,z-p.z)<p.radius+.25;})&&!definitions.some(function(p){return Math.hypot(x-p.x,z-p.z)<.55;})){found={x:x,z:z,placeId:plan.id,id:'village-resident-'+r+'-'+i,type:(r+i)%6,yaw:site.yaw};break;}}if(found)definitions.push(found);}});

    buildTown(definitions);
    var obstacles=sites.concat(town.sites).map(function(s){return{x:s.x,z:s.z,radius:s.radius};});
    RESERVED.forEach(function(p){obstacles.push({x:p[0],z:p[1],radius:p[2]});});
    ENRICHMENT.forEach(function(p){obstacles.push({x:p[0],z:p[1],radius:4.8});});
    (opts.places||[]).forEach(function(b){var p=b.position||b;obstacles.push({x:p.x,z:p.z,radius:b.radius||2.3});});
    (opts.buildings||[]).forEach(function(b){var p=b.position||b;obstacles.push({x:p.x,z:p.z,radius:b.radius||2.3});});
    var reduced=!!opts.reducedMotion,motion=root.MarioResidentMotion(T,{material:material,heightAt:heightAt,reducedMotion:reduced,
      safe:function(x,z,ignore){
        return x>geo.bounds.minX+.4&&x<geo.bounds.maxX-.4&&z>geo.bounds.minZ+.4&&z<geo.bounds.maxZ-.4&&heightAt(x,z)>1.05&&geo.riverDistance(x,z)>=4.2&&roadDistance(x,z)>1.15&&
          !obstacles.some(function(s){return Math.hypot(x-s.x,z-s.z)<s.radius+.35;})&&
          !definitions.some(function(d){return d!==ignore&&Math.min(Math.hypot(x-(d.home?d.home.x:d.x),z-(d.home?d.home.z:d.z)),Math.hypot(x-d.x,z-d.z))<.65;});
      },orient:function(dummy,x,z,y,yaw){orient(dummy,x,z,y,yaw);dummy.scale.multiplyScalar(1.13);}});
    definitions.forEach(function(d,i){motion.prepare(d,i);});
    for(var type=0;type<6;type++){var selected=definitions.filter(function(d){return d.type===type;});if(!selected.length)continue;var source=npc(type),prototype=compile(source,'village-resident-prototype-'+type),mesh=new T.InstancedMesh(prototype.geometry,material,selected.length);source.clear();mesh.name='village-residents-'+type;mesh.userData.instancePlaces=[];mesh.userData.instanceNpcs=[];mesh.frustumCulled=false;var dummy=new T.Object3D();selected.forEach(function(d,i){orient(dummy,d.x,d.z,heightAt(d.x,d.z)+.02,d.yaw);dummy.scale.multiplyScalar(1.13);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.userData.instancePlaces.push(d.placeId);mesh.userData.instanceNpcs.push(d.id);residents.push(d);});motion.add(mesh,selected);mesh.instanceMatrix.needsUpdate=true;group.add(mesh);pickTargets.push(mesh);}
    pool.forEach(function(g){g.dispose();});pool.clear();paints.forEach(function(m){m.dispose();});paints.clear();
    var stats={buildings:sites.length+6,townBuildings:6,stalls:3,plazas:1,streetLength:town.length,residents:residents.length,props:props,triangles:0,drawCalls:0,geometryBytes:0},unique=new Set();group.traverse(function(o){if(!o.isMesh)return;stats.drawCalls++;var g=o.geometry;stats.triangles+=(g.index?g.index.count:g.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);if(!unique.has(g)){unique.add(g);Object.keys(g.attributes).forEach(function(k){stats.geometryBytes+=g.attributes[k].array.byteLength;});if(g.index)stats.geometryBytes+=g.index.array.byteLength;}if(o.instanceMatrix)stats.geometryBytes+=o.instanceMatrix.array.byteLength;});
    group.userData.villageLife={kind:kind,stats:stats};parent.add(group);group.updateMatrixWorld(true);var disposed=false;
    return{group:group,pickTargets:pickTargets,stats:stats,sites:sites,town:town,residents:residents,update:motion.update,dispose:function(){if(disposed)return;disposed=true;motion.dispose();unique.forEach(function(g){g.dispose();});group.traverse(function(o){if(o.isInstancedMesh&&o.dispose)o.dispose();});material.dispose();if(group.parent)group.parent.remove(group);}};
  }
  root.MarioVillageLife={build:build};
})(window);
