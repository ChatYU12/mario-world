/* Authored landscape vignettes shared by the expanded globe and mainland. */
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
        '#include <begin_vertex>\nfloat gait=uResidentTime*7.5+residentMotion.x;\nfloat walking=residentMotion.y;\ntransformed.x+=sin(gait)*0.025*max(position.y,0.0)*walking;\ntransformed.y+=abs(sin(gait))*0.035*walking;');
    };
    material.customProgramCacheKey=function(){return 'resident-patrol-v1';};
    material.userData.residentTime=uniform;
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
      record.speed=Math.min(.85,.55+(index%7)*.05);record.pause=1.2+(index%5)*.3;record.current={x:start.x,z:start.z,y:cfg.heightAt(start.x,start.z)+.02};
      return record;
    }
    function add(mesh,records){
      var values=new Float32Array(records.length*2);mesh.geometry.setAttribute('residentMotion',new T.InstancedBufferAttribute(values,2));mesh.material=material;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      records.forEach(function(record,index){var actor={mesh:mesh,index:index,record:record,segment:0,distance:0,phase:actors.length*.93,order:actors.length};actors.push(actor);values[index*2]=actor.phase;cfg.orient(dummy,record.x,record.z,cfg.heightAt(record.x,record.z)+.02,record.yaw);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);});
      mesh.instanceMatrix.needsUpdate=true;
    }
    function update(time,viewer){
      viewer=viewer||{};
      if(disposed||!viewer.animate||cfg.reducedMotion||viewer.reducedMotion||(typeof root.matchMedia==='function'&&root.matchMedia('(prefers-reduced-motion: reduce)').matches)){lastTime=Number.isFinite(time)?time:null;return false;}
      time=Number.isFinite(time)?time:0;var delta=lastTime===null?.1:Math.max(0,Math.min(.25,time-lastTime));lastTime=time;clock+=delta;uniform.value=clock;
      actors.forEach(function(actor){
        var r=actor.record,remaining=delta,walking=false,saved={segment:actor.segment,distance:actor.distance,x:r.x,z:r.z,yaw:r.yaw,progress:r.progress,direction:r.direction,wait:r.wait};
        while(remaining>1e-8){
          if(r.wait>0){var rest=Math.min(r.wait,remaining);r.wait-=rest;remaining-=rest;continue;}
          var a=r.path[actor.segment],b=r.path[actor.segment+r.direction],length=Math.hypot(b.x-a.x,b.z-a.z),needed=(length-actor.distance)/r.speed,used=Math.min(remaining,needed);
          actor.distance+=used*r.speed;remaining-=used;walking=used>0;
          var t=Math.min(1,actor.distance/length);r.x=a.x+(b.x-a.x)*t;r.z=a.z+(b.z-a.z)*t;r.yaw=Math.atan2(b.x-a.x,b.z-a.z);r.progress=actor.segment+r.direction*t;
          if(actor.distance>=length-1e-7){actor.segment+=r.direction;actor.distance=0;if(actor.segment===0||actor.segment===r.path.length-1){r.direction*=-1;r.wait=r.pause;walking=false;}}
        }
        var blocker=actors.find(function(other){return other!==actor&&Math.hypot(r.x-other.record.x,r.z-other.record.z)<.60;});
        if(blocker){
          actor.segment=saved.segment;actor.distance=saved.distance;r.x=saved.x;r.z=saved.z;r.yaw=saved.yaw;r.progress=saved.progress;r.direction=saved.direction;r.wait=saved.wait;walking=false;
          // The later actor yields by retracing its own safe segment; no sideways teleport.
          if(actor.order>blocker.order&&r.wait<=0&&actor.distance>.05){var from=r.path[actor.segment],to=r.path[actor.segment+r.direction];actor.distance=Math.hypot(to.x-from.x,to.z-from.z)-actor.distance;actor.segment+=r.direction;r.direction*=-1;r.wait=.35;}
        }
        r.current.x=r.x;r.current.z=r.z;r.current.y=cfg.heightAt(r.x,r.z)+.02;
        cfg.orient(dummy,r.x,r.z,r.current.y,r.yaw);dummy.updateMatrix();actor.mesh.setMatrixAt(actor.index,dummy.matrix);
        var attr=actor.mesh.geometry.attributes.residentMotion;attr.setY(actor.index,walking&&r.wait<=0?1:0);
      });
      var touched=new Set();actors.forEach(function(a){touched.add(a.mesh);});touched.forEach(function(mesh){mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.residentMotion.needsUpdate=true;});
      return true;
    }
    return{material:material,uniform:uniform,prepare:prepare,add:add,update:update,dispose:function(){if(disposed)return;disposed=true;actors.length=0;material.dispose();}};
  };
var REGIONS=['forest','gardens','canyon','lake'];
var C={wood:0x916646,dark:0x493b36,cream:0xffedce,pink:0xe9879e,blue:0x72bac9,white:0xfff8e8,green:0x579358,leaf:0x7fb56a,gold:0xf1c765,red:0xc57155,stone:0xad7861,skin:0xf6cba0};
function build(T,parent,options){
 var opts=options||{},geo=root.MarioWorldGeography,heightAt=typeof opts.heightAt==='function'?opts.heightAt:geo.heightAt,globe=opts.kind==='globe',group=new T.Group();group.name='frontier-landscapes';
 var material=new T.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:T.DoubleSide}),geometries=new Map(),paints=new Map(),sites=[],targets=[],structures=0,residents=0,definitions=[];
 function cached(key,make){if(!geometries.has(key))geometries.set(key,make());return geometries.get(key);}
 function paint(color){if(!paints.has(color))paints.set(color,new T.MeshBasicMaterial({color:color}));return paints.get(color);}
 function part(g,shape,color,x,y,z,sx,sy,sz,rx,ry,rz){var m=new T.Mesh(shape,paint(color));m.position.set(x||0,y||0,z||0);m.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);m.rotation.set(rx||0,ry||0,rz||0);g.add(m);return m;}
 function box(g,c,x,y,z,w,h,d,rx,ry,rz){return part(g,cached('box',function(){return new T.BoxGeometry(1,1,1);}),c,x,y,z,w,h,d,rx,ry,rz);}
 function ball(g,c,x,y,z,w,h,d){return part(g,cached('ball',function(){return new T.SphereGeometry(1,8,5);}),c,x,y,z,w,h,d);}
 function cyl(g,c,x,y,z,rt,rb,h,n,rx,ry,rz){return part(g,cached(['c',rt,rb,h,n||8].join('/'),function(){return new T.CylinderGeometry(rt,rb,h,n||8);}),c,x,y,z,1,1,1,rx,ry,rz);}
 function cone(g,c,x,y,z,r,h,n){return part(g,cached(['cone',r,h,n||8].join('/'),function(){return new T.ConeGeometry(r,h,n||8);}),c,x,y,z);}
 function roof(g,c,y,w,d){box(g,c,-w*.24,y,0,w*.58,.22,d,0,0,.56);box(g,c,w*.24,y,0,w*.58,.22,d,0,0,-.56);}
 function hut(color){var g=new T.Group();box(g,C.cream,0,1.3,0,3,2.6,2.5);box(g,C.wood,0,.14,0,3.3,.28,2.8);roof(g,color,3.0,3.8,3.15);box(g,C.wood,0,.86,1.3,.65,1.65,.12);[-.95,.95].forEach(function(x){box(g,C.white,x,1.52,1.3,.6,.75,.12);box(g,C.blue,x,1.52,1.38,.43,.56,.05);box(g,C.wood,x,1.52,1.42,.04,.56,.03);});box(g,C.stone,1,3.25,-.65,.37,1.05,.4);
  box(g,C.wood,0,3.49,0,.13,.12,3.18);box(g,C.stone,1,3.79,-.65,.48,.12,.51);box(g,C.dark,1,3.86,-.65,.30,.025,.31);
  [-1,1].forEach(function(s){box(g,C.wood,s*1.44,1.35,1.27,.12,2.45,.12);box(g,C.wood,s*1.72,2.53,0,.12,.14,3.19);box(g,C.wood,s*.95,1.07,1.43,.76,.09,.23);box(g,C.wood,s*.95,1.52,1.43,.48,.04,.04);box(g,C.wood,s*1.3,1.52,1.39,.12,.76,.07);box(g,C.white,s*1.52,1.55,-.25,.055,.78,.68);box(g,C.blue,s*1.556,1.55,-.25,.025,.60,.50);box(g,C.wood,s*1.57,1.55,-.25,.025,.60,.04);});
  box(g,C.stone,0,.10,1.52,1.05,.18,.5);box(g,C.gold,.2,.85,1.38,.06,.07,.04);box(g,C.wood,0,1.78,1.38,.85,.09,.16);
  return g;}
 function tent(color){var g=new T.Group();roof(g,color,1.1,3.5,3.3);box(g,C.cream,0,.08,0,3.2,.12,3.1);box(g,C.dark,0,.65,1.5,.055,1.3,.07);
  box(g,C.wood,0,1.63,0,.08,.08,3.38);
  [-1,1].forEach(function(s){box(g,C.cream,s*.75,.84,1.53,.10,1.82,.055,0,0,-s*.53);box(g,C.wood,s*1.68,.10,s*1.62,.10,.26,.10);box(g,C.cream,s*1.54,.26,1.63,.025,.68,.025,0,0,s*.72);box(g,C.dark,s*.48,.52,1.49,.09,.91,.04,0,0,s*.25);box(g,color,s*.65,.52,1.54,.30,.94,.055,0,0,-s*.18);});
  box(g,C.wood,0,.16,1.58,1.4,.06,.30);return g;}
 function person(type){var g=new T.Group(),color=[C.green,C.gold,C.red,C.blue][type];box(g,color,0,.86,0,.53,.7,.34);[-1,1].forEach(function(s){box(g,C.dark,s*.15,.33,0,.18,.6,.22);box(g,C.dark,s*.15,.08,.09,.23,.15,.4);box(g,color,s*.37,.84,0,.17,.6,.22,0,0,s*.18);ball(g,C.skin,s*.42,.51,.01,.10,.1,.09);});ball(g,C.skin,0,1.47,0,.29,.3,.25);ball(g,C.wood,0,1.64,-.03,.29,.14,.24);cyl(g,color,0,1.76,0,.3,.31,.18,8);cyl(g,type===1?C.gold:color,0,1.68,.02,.4,.4,.05,10);if(type===2){box(g,C.wood,.53,.99,.02,.06,1,.06);box(g,C.stone,.53,1.52,.02,.56,.13,.14);}else if(type===3){box(g,C.pink,0,.93,-.27,.53,.65,.27);box(g,C.wood,.54,.75,.02,.05,1.45,.05);}detailPerson(g,type);return g;}
 function detailPerson(g,type){
  [-1,1].forEach(function(s){
   part(g,cached('face-detail',function(){return new T.IcosahedronGeometry(1,0);}),C.skin,s*.28,1.46,0,.045,.075,.045);
   box(g,C.white,s*.1,1.51,.24,.085,.09,.025);box(g,C.dark,s*.095,1.50,.259,.032,.055,.018);
   box(g,C.white,s*.09,1.52,.271,.014,.018,.008);box(g,C.wood,s*.10,1.58,.24,.09,.02,.02,0,0,s*(type===2?.18:-.1));
   box(g,C.wood,s*.23,1.60,.08,.065,.16,.10,0,0,s*.2);box(g,C.pink,s*.19,1.43,.22,.06,.025,.012);
   box(g,C.cream,s*.11,1.15,.18,.15,.12,.04,0,0,s*.35);
   box(g,C.wood,s*.15,.025,.10,.24,.035,.41);box(g,C.gold,s*.15,.17,.19,.13,.025,.025);
  });
  part(g,cached('face-detail',function(){return new T.IcosahedronGeometry(1,0);}),C.skin,0,1.46,.27,.05,.06,.05);box(g,C.red,0,1.365,.239,.08,.02,.02);
  box(g,C.wood,0,.55,0,.55,.065,.37);box(g,C.gold,0,.55,.20,.09,.055,.025);
  if(type===0){box(g,C.wood,0,.92,.19,.31,.29,.05);box(g,C.cream,0,.94,.22,.22,.19,.02);box(g,C.gold,.16,1.73,.29,.07,.07,.025);}
  else if(type===1){box(g,C.cream,0,.80,.20,.38,.43,.04);box(g,C.green,.44,.66,.08,.09,.25,.05);box(g,C.pink,.44,.82,.08,.15,.10,.09);}
  else if(type===2){box(g,C.dark,0,1.76,.29,.16,.12,.06);box(g,C.gold,0,1.76,.33,.10,.07,.02);[-.11,.11].forEach(function(x){box(g,C.dark,x,1.1,.19,.055,.28,.025);});}
  else{box(g,C.cream,0,.96,-.42,.36,.20,.035);box(g,C.gold,0,.82,-.43,.09,.065,.025);box(g,C.blue,0,1.18,.21,.29,.07,.04);}
 }
 function frame(x,z){var d=geo.mapToDirection(x,z),up=new T.Vector3(d.x,d.y,d.z),a=geo.mapToDirection(x+.05,z),b=geo.mapToDirection(x-.05,z),east=new T.Vector3(a.x-b.x,a.y-b.y,a.z-b.z).normalize(),south=new T.Vector3().crossVectors(east,up).normalize();east.crossVectors(up,south).normalize();return{up:up,q:new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(east,up,south))};}
 function place(batch,model,x,z,id,kind,yaw,water){
  var y=water?geo.seaLevel+.025:geo.heightAt(x,z);if(!water&&y<1)return false;
  if(!water&&kind==='building'){var low=y,high=y;for(var i=0;i<8;i++){var a=i*Math.PI/4,h=geo.heightAt(x+Math.cos(a)*2.3,z+Math.sin(a)*2.3);low=Math.min(low,h);high=Math.max(high,h);}y=high+.02;box(model,C.stone,0,-(high-low+.18)*.5,0,3.6,high-low+.18,3.1);}
  if(globe){var f=frame(x,z),r=geo.oceanRadius+(y-geo.seaLevel)*.012;model.position.copy(f.up).multiplyScalar(r+.0005);model.quaternion.copy(f.q);model.scale.setScalar(.012);if(yaw)model.rotateY(yaw);}else{model.position.set(x,y,z);model.rotation.y=yaw||0;}
  batch.add(model);sites.push({id:id,region:batch.userData.regionId,x:x,z:z,kind:kind});if(kind==='building'||kind==='landmark')structures++;return true;
 }
 function tree(size,hollow){var g=new T.Group();cyl(g,C.wood,0,size*.3,0,hollow?1.45:.45,hollow?1.7:.68,size*.6,9);for(var i=0;i<5;i++){var a=i*2.4;ball(g,i%2?C.leaf:C.green,Math.cos(a)*size*.15,size*.67+(i%2)*size*.12,Math.sin(a)*size*.15,size*.27,size*.25,size*.25);}for(var k=0;k<4;k++){var a=k*Math.PI/2+.3,root=new T.Group();root.rotation.y=a;box(root,C.wood,0,size*.06,size*.065,size*.10,size*.12,size*.26,.22);g.add(root);}
  [-1,1].forEach(function(side){box(g,C.wood,side*size*.11,size*.45,0,size*.055,size*.34,size*.065,0,0,-side*.55);});
  if(size<=6){for(var k=0;k<3;k++)cone(g,k%2?C.green:C.leaf,0,size*(.47+k*.17),0,size*(.33-k*.065),size*.4,8);}
  if(hollow){box(g,C.dark,0,1.45,1.45,1.05,2.8,.12);box(g,C.gold,0,2.3,1.55,.65,.12,.08);box(g,C.wood,-1.65,.7,1.9,2,.18,.55);[-2.35,-.95].forEach(function(x){box(g,C.wood,x,.33,1.9,.12,.65,.5);});}return g;}
 function mushroom(color,size){var g=new T.Group();cyl(g,C.cream,0,size*.28,0,size*.19,size*.25,size*.56,8);ball(g,color,0,size*.68,0,size*.58,size*.29,size*.58);cyl(g,C.cream,0,size*.51,0,size*.47,size*.25,size*.08,10);for(var k=0;k<5;k++){var a=k*Math.PI*2/5;box(g,C.gold,Math.sin(a)*size*.28,size*.473,Math.cos(a)*size*.28,size*.025,size*.018,size*.28,0,a);}for(var i=0;i<5;i++){var a=i*2.4;ball(g,C.white,Math.cos(a)*size*.32,size*.86,Math.sin(a)*size*.32,size*.09,size*.035,size*.09);}return g;}
 function mill(){var g=new T.Group();cyl(g,C.cream,0,2.3,0,1.1,1.6,4.6,10);cone(g,C.pink,0,5.1,0,1.6,1.35,10);box(g,C.wood,0,1,1.5,.8,1.9,.1);cyl(g,C.wood,0,3.4,1.4,.24,.24,.55,8,Math.PI/2);for(var i=0;i<4;i++){var a=i*Math.PI/2+.5;box(g,C.wood,Math.sin(a)*1.4,3.4+Math.cos(a)*1.4,1.75,.16,3.2,.12,0,0,-a);box(g,C.white,Math.sin(a)*1.8+Math.cos(a)*.3,3.4+Math.cos(a)*1.8-Math.sin(a)*.3,1.82,.7,1.7,.07,0,0,-a);}for(var i=0;i<4;i++){var a=i*Math.PI/2+.5;for(var k=0;k<4;k++)box(g,C.wood,Math.sin(a)*(1.05+k*.4)+Math.cos(a)*.3,3.4+Math.cos(a)*(1.05+k*.4)-Math.sin(a)*.3,1.88,.73,.045,.04,0,0,-a);}
  cyl(g,C.gold,0,3.4,1.77,.13,.13,.18,8,Math.PI/2);box(g,C.wood,0,2.0,1.27,.62,.09,.15);box(g,C.blue,0,2.35,1.18,.36,.42,.06);return g;}
 function compile(batch,id,prototype){
  batch.updateMatrixWorld(true);var pp=[],nn=[],cc=[],uv=[],indices=[],v=new T.Vector3(),n=new T.Vector3(),nm=new T.Matrix3();
  batch.traverse(function(o){if(!o.isMesh)return;var g=o.geometry,p=g.attributes.position,normal=g.attributes.normal,ca=g.attributes.color,ua=g.attributes.uv,offset=pp.length/3,color=o.material.color;nm.getNormalMatrix(o.matrixWorld);
   for(var i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);n.fromBufferAttribute(normal,i).applyMatrix3(nm).normalize();pp.push(v.x,v.y,v.z);nn.push(n.x,n.y,n.z);cc.push(color.r*(ca?ca.getX(i):1),color.g*(ca?ca.getY(i):1),color.b*(ca?ca.getZ(i):1));uv.push(ua?ua.getX(i):0,ua?ua.getY(i):0);}
   if(g.index){for(var j=0;j<g.index.count;j++)indices.push(offset+g.index.getX(j));}else for(var j=0;j<p.count;j++)indices.push(offset+j);
  });
  var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pp,3));g.setAttribute('normal',new T.Float32BufferAttribute(nn,3));g.setAttribute('color',new T.Uint16BufferAttribute(cc.map(function(c){return Math.round(Math.max(0,Math.min(1,c))*65535);}),3,true));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();var mesh=new T.Mesh(g,material);mesh.name='frontier-'+id;mesh.userData.regionId=id;if(!prototype){group.add(mesh);targets.push(mesh);}batch.clear();return mesh;
 }
 REGIONS.forEach(function(id,regionIndex){var b=new T.Group();b.userData.regionId=id;
  if(id==='forest'){
   [[-75,-20,12],[-61,-22,10],[-79,-9,11],[-59,-4,9],[-72,0,10],[-78,-28,8],[-59,-30,8]].forEach(function(p,i){place(b,tree(p[2],i===0),p[0],p[1],'giant-tree-'+i,'landmark');});
   [[-66,-21,3],[-73,-5,2.8],[-64,-3,2.3],[-80,-17,3.2],[-58,-16,2.5],[-68,-29,2.8]].forEach(function(p,i){place(b,mushroom([C.pink,C.blue,C.gold][i%3],p[2]),p[0],p[1],'forest-mushroom-'+i,'landmark');});
   place(b,hut(C.green),-63,-13,'ranger-cabin','building',-.4);place(b,tent(C.gold),-73,-12,'forest-tent','building');
   for(var i=0;i<20;i++){var g=new T.Group();box(g,C.wood,0,.12,0,2.1,.18,.5);place(b,g,-68+Math.sin(i*.17)*1.2,-12-i*.5,'forest-boardwalk-'+i,'path');}
  }else if(id==='gardens'){
   place(b,mill(),-24,64,'garden-windmill','landmark');place(b,hut(C.pink),-11,56,'garden-farmhouse','building');place(b,hut(C.blue),-29,57,'garden-store','building');
   for(var row=0;row<6;row++)for(var col=0;col<13;col++){var g=new T.Group(),color=[C.pink,C.gold,C.white,C.blue,C.pink,C.gold][row];box(g,C.green,0,.32,0,.06,.6,.06);for(var k=0;k<4;k++){var a=k*Math.PI/2;ball(g,color,Math.cos(a)*.14,.68,Math.sin(a)*.14,.17,.085,.17);}ball(g,C.gold,0,.73,0,.07,.05,.07);[-1,1].forEach(function(side){box(g,C.leaf,side*.10,.34,0,.23,.035,.10,0,0,side*.5);});place(b,g,-19+col*.62,65+row*.82,'garden-flower-'+row+'-'+col,'garden');}
   for(var i=0;i<14;i++){var g=new T.Group();ball(g,0xdb9549,0,.3,0,.35,.3,.33);box(g,C.green,0,.65,0,.08,.2,.08);place(b,g,-26+(i%7)*.85,52+Math.floor(i/7)*.9,'garden-pumpkin-'+i,'garden');}
   for(var i=0;i<12;i++){var g=new T.Group();box(g,C.white,0,.5,0,.12,1,.12);box(g,C.white,.42,.55,0,.85,.09,.08);place(b,g,-22+i*.85,70,'garden-fence-'+i,'prop');}
  }else if(id==='canyon'){
   [[64,-6,7,2.3],[79,-8,10,2.1],[83,2,8,2.5],[80,12,6,2.7],[61,10,6,2.1]].forEach(function(p,i){var g=new T.Group();cyl(g,i%2?C.red:C.stone,0,p[2]*.5,0,p[3]*.8,p[3],p[2],7);for(var j=0;j<3;j++)cyl(g,0xd69b75,0,p[2]*(.22+j*.22),0,p[3]*(.98-j*.04),p[3]*(.98-j*.04),.18,7);cyl(g,C.red,.12,p[2]-.10,-.08,p[3]*.68,p[3]*.81,.28,7);[-1,1].forEach(function(side){box(g,C.dark,side*p[3]*.33,p[2]*.6,p[3]*.83,.045,p[2]*.24,.035,0,0,side*.15);});place(b,g,p[0],p[1],'canyon-mesa-'+i,'landmark');});
   var arch=new T.Group();[-3.1,3.1].forEach(function(x){cyl(arch,C.red,x,2.6,0,1.2,1.65,5.2,7);});box(arch,C.stone,0,5.25,0,7.8,1.7,2.5,0,0,.07);for(var k=0;k<5;k++)box(arch,k%2?C.red:C.stone,-2.8+k*1.4,5.20,1.27,.07,1.35,.05,0,0,-.25+k*.12);place(b,arch,71,-9,'canyon-stone-arch','landmark');
   var mine=new T.Group();box(mine,C.dark,0,1.4,0,3.5,2.8,.4);[-1.8,1.8].forEach(function(x){box(mine,C.wood,x,1.6,.25,.35,3.2,.5);});box(mine,C.wood,0,3.1,.25,4.1,.4,.5);box(mine,C.gold,0,2.5,.45,.55,.22,.1);[-1,1].forEach(function(side){box(mine,C.wood,side*1.44,2.63,.54,.16,1.16,.12,0,0,side*.7);box(mine,C.gold,side*1.8,1.9,.53,.13,.13,.03);});box(mine,C.dark,0,3.33,.25,3.8,.09,.53);place(b,mine,78,6,'canyon-mine','building');
   for(var i=0;i<15;i++){var g=new T.Group();[-.48,.48].forEach(function(x){box(g,C.dark,x,.12,0,.06,.1,.85);});box(g,C.wood,0,.06,0,1.25,.1,.18);place(b,g,78,5-i*.6,'mine-track-'+i,'path');}
   var cart=new T.Group();box(cart,C.dark,0,.4,0,1.1,.6,1.35);box(cart,C.stone,0,.8,0,.92,.25,1.1);[-1,1].forEach(function(s){cyl(cart,C.gold,s*.58,.17,0,.22,.22,.1,8,0,0,Math.PI/2);});[-1,1].forEach(function(side){box(cart,C.gold,side*.57,.47,0,.06,.08,1.35);box(cart,C.dark,side*.57,.47,0,.06,.65,.07);cyl(cart,C.dark,side*.61,.17,0,.10,.10,.12,8,0,0,Math.PI/2);});
   for(var k=0;k<3;k++)box(cart,k%2?C.gold:C.red,-.27+k*.27,.96,0,.30,.30,.42,0,k*.5,.3);place(b,cart,78,1,'canyon-mine-cart','landmark');
   place(b,hut(C.red),65,5,'canyon-watch-house','building');
  }else{
   place(b,hut(C.blue),-7,-67,'lake-chalet','building',.4);place(b,tent(C.gold),-9,-58,'lake-tent-gold','building',-.4);place(b,tent(C.pink),-1,-54,'lake-tent-pink','building',.2);
   var telescope=new T.Group();[-1,0,1].forEach(function(s){box(telescope,C.wood,s*.34,.7,s===0?-.38:.3,.09,1.6,.09,0,0,-s*.25);});cyl(telescope,C.blue,0,1.65,0,.27,.35,1.55,10,.8);cyl(telescope,C.gold,0,2.17,.55,.3,.3,.1,10,.8);place(b,telescope,-2,-66,'lake-telescope','landmark');
   for(var i=0;i<11;i++){var g=new T.Group();box(g,C.wood,0,.08,0,.56,.16,2.15);if(i%3===0)[-1,1].forEach(function(s){box(g,C.wood,0,-.25,s*.95,.14,.8,.14);});box(g,C.dark,.17,.17,.83,.045,.025,.045);if(i%3===0){[-1,1].forEach(function(side){box(g,C.wood,0,.48,side*.95,.10,.9,.10);box(g,C.cream,.48,.73,side*.95,1.06,.045,.045);});}place(b,g,.8+i*.5,-63,'lake-jetty-'+i,'path',0,true);}
   var boat=new T.Group();cyl(boat,C.wood,0,.12,0,.7,.45,.45,8);box(boat,C.cream,0,.34,0,.75,.12,1);box(boat,C.wood,0,1.2,0,.065,1.9,.065);var sail=new T.BufferGeometry();sail.setAttribute('position',new T.Float32BufferAttribute([0,.5,0,0,2.1,0,1.05,.55,0],3));sail.computeVertexNormals();part(boat,sail,C.white,0,0,0);geometries.set('sail',sail);[-1,1].forEach(function(side){box(boat,C.wood,side*.48,.37,0,.09,.12,1.05);box(boat,C.blue,side*.40,.26,.36,.07,.06,.47);});box(boat,C.wood,.53,.46,0,1.35,.045,.065,0,.45);box(boat,C.gold,.50,.46,0,.10,.10,.10);place(b,boat,8,-62,'lake-sailboat','landmark',.4,true);
   [[-12,-71],[-11,-52],[1,-72],[3,-53]].forEach(function(p,i){place(b,tree(5+i%2,false),p[0],p[1],'lake-pine-'+i,'landmark');});
  }
  var region=geo.regions.find(function(r){return r.id===id;});[[-3,3],[3,2],[-4,-3],[4,-3]].forEach(function(p,i){var x=region.x+p[0],z=region.z+p[1];if(heightAt(x,z)>=1){var npcId=id+'-resident-'+i;sites.push({id:npcId,region:id,x:x,z:z,kind:'resident'});definitions.push({id:npcId,x:x,z:z,placeId:id,region:id,type:regionIndex,yaw:i*.6});residents++;}});compile(b,id);
 });

 var roadPoints=(geo.routeDefinitions||[]).map(function(r){var curve=new T.CatmullRomCurve3(r.controls.map(function(p){return new T.Vector3(p[0],0,p[1]);}));return curve.getPoints(Math.ceil(curve.getLength()*3));});
 var obstacles=sites.filter(function(s){return s.kind==='building'||s.kind==='landmark';}).map(function(s){return{x:s.x,z:s.z,radius:s.kind==='building'?2.45:/giant-tree/.test(s.id)?2.0:/mesa|arch/.test(s.id)?2.1:1.2};});
 function clearRoad(x,z){for(var k=0;k<roadPoints.length;k++){var pts=roadPoints[k];for(var i=1;i<pts.length;i++){var a=pts[i-1],b=pts[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(x-a.x-dx*t,z-a.z-dz*t)<1.15)return false;}}return true;}
 var motion=root.MarioResidentMotion(T,{material:material,heightAt:heightAt,reducedMotion:!!opts.reducedMotion,
  safe:function(x,z,ignore){return x>geo.bounds.minX+.4&&x<geo.bounds.maxX-.4&&z>geo.bounds.minZ+.4&&z<geo.bounds.maxZ-.4&&heightAt(x,z)>1.05&&geo.riverDistance(x,z)>=4.2&&clearRoad(x,z)&&
   !obstacles.some(function(s){return Math.hypot(x-s.x,z-s.z)<s.radius+.35;})&&
   !definitions.some(function(d){return d!==ignore&&Math.min(Math.hypot(x-(d.home?d.home.x:d.x),z-(d.home?d.home.z:d.z)),Math.hypot(x-d.x,z-d.z))<.65;});},
  orient:function(dummy,x,z,y,yaw){dummy.scale.setScalar(globe?.012:1);if(globe){var f=frame(x,z);dummy.position.copy(f.up).multiplyScalar(geo.oceanRadius+(y-geo.seaLevel)*.012+.0005);dummy.quaternion.copy(f.q);dummy.rotateY(yaw);}else{dummy.position.set(x,y,z);dummy.rotation.set(0,yaw,0);}}});
 definitions.forEach(function(d,i){motion.prepare(d,i);});
 for(var type=0;type<4;type++){
  var source=person(type),model=compile(source,REGIONS[type],true),selected=definitions.filter(function(d){return d.type===type;}),mesh=new T.InstancedMesh(model.geometry,motion.material,selected.length);
  mesh.name='frontier-residents-'+REGIONS[type];mesh.userData.regionId=REGIONS[type];mesh.userData.instancePlaces=selected.map(function(d){return d.placeId;});mesh.userData.instanceNpcs=selected.map(function(d){return d.id;});mesh.frustumCulled=false;
  motion.add(mesh,selected);group.add(mesh);targets.push(mesh);
 }
 geometries.forEach(function(g){g.dispose();});paints.forEach(function(m){m.dispose();});geometries.clear();paints.clear();
 var stats={regions:4,structures:structures,residents:residents,triangles:0,drawCalls:targets.length,geometryBytes:0};targets.forEach(function(m){var g=m.geometry;stats.triangles+=g.index.count/3*(m.isInstancedMesh?m.count:1);Object.keys(g.attributes).forEach(function(k){stats.geometryBytes+=g.attributes[k].array.byteLength;});stats.geometryBytes+=g.index.array.byteLength;if(m.instanceMatrix)stats.geometryBytes+=m.instanceMatrix.array.byteLength;});
 group.userData.frontier={stats:stats,sites:sites};parent.add(group);var disposed=false;return{group:group,stats:stats,sites:sites,residents:definitions,obstacles:obstacles,pickTargets:targets,update:motion.update,dispose:function(){if(disposed)return;disposed=true;motion.dispose();targets.forEach(function(m){m.geometry.dispose();if(m.isInstancedMesh&&m.dispose)m.dispose();});material.dispose();group.removeFromParent();}};
}
root.MarioFrontierWorld={build:build};
})(window);
