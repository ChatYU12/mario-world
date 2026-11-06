/* Authored landscape vignettes shared by the expanded globe and mainland. */
(function(root){
'use strict';
var REGIONS=['forest','gardens','canyon','lake'];
var C={wood:0x916646,dark:0x493b36,cream:0xffedce,pink:0xe9879e,blue:0x72bac9,white:0xfff8e8,green:0x579358,leaf:0x7fb56a,gold:0xf1c765,red:0xc57155,stone:0xad7861,skin:0xf6cba0};
function build(T,parent,options){
 var geo=root.MarioWorldGeography,globe=options&&options.kind==='globe',group=new T.Group();group.name='frontier-landscapes';
 var material=new T.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:T.DoubleSide}),geometries=new Map(),paints=new Map(),sites=[],targets=[],structures=0,residents=0;
 function cached(key,make){if(!geometries.has(key))geometries.set(key,make());return geometries.get(key);}
 function paint(color){if(!paints.has(color))paints.set(color,new T.MeshBasicMaterial({color:color}));return paints.get(color);}
 function part(g,shape,color,x,y,z,sx,sy,sz,rx,ry,rz){var m=new T.Mesh(shape,paint(color));m.position.set(x||0,y||0,z||0);m.scale.set(sx===undefined?1:sx,sy===undefined?1:sy,sz===undefined?1:sz);m.rotation.set(rx||0,ry||0,rz||0);g.add(m);return m;}
 function box(g,c,x,y,z,w,h,d,rx,ry,rz){return part(g,cached('box',function(){return new T.BoxGeometry(1,1,1);}),c,x,y,z,w,h,d,rx,ry,rz);}
 function ball(g,c,x,y,z,w,h,d){return part(g,cached('ball',function(){return new T.SphereGeometry(1,8,5);}),c,x,y,z,w,h,d);}
 function cyl(g,c,x,y,z,rt,rb,h,n,rx,ry,rz){return part(g,cached(['c',rt,rb,h,n||8].join('/'),function(){return new T.CylinderGeometry(rt,rb,h,n||8);}),c,x,y,z,1,1,1,rx,ry,rz);}
 function cone(g,c,x,y,z,r,h,n){return part(g,cached(['cone',r,h,n||8].join('/'),function(){return new T.ConeGeometry(r,h,n||8);}),c,x,y,z);}
 function roof(g,c,y,w,d){box(g,c,-w*.24,y,0,w*.58,.22,d,0,0,.56);box(g,c,w*.24,y,0,w*.58,.22,d,0,0,-.56);}
 function hut(color){var g=new T.Group();box(g,C.cream,0,1.3,0,3,2.6,2.5);box(g,C.wood,0,.14,0,3.3,.28,2.8);roof(g,color,3.0,3.8,3.15);box(g,C.wood,0,.86,1.3,.65,1.65,.12);[-.95,.95].forEach(function(x){box(g,C.white,x,1.52,1.3,.6,.75,.12);box(g,C.blue,x,1.52,1.38,.43,.56,.05);box(g,C.wood,x,1.52,1.42,.04,.56,.03);});box(g,C.stone,1,3.25,-.65,.37,1.05,.4);return g;}
 function tent(color){var g=new T.Group();roof(g,color,1.1,3.5,3.3);box(g,C.cream,0,.08,0,3.2,.12,3.1);box(g,C.dark,0,.65,1.5,.055,1.3,.07);return g;}
 function person(type){var g=new T.Group(),color=[C.green,C.gold,C.red,C.blue][type];box(g,color,0,.86,0,.53,.7,.34);[-1,1].forEach(function(s){box(g,C.dark,s*.15,.33,0,.18,.6,.22);box(g,C.dark,s*.15,.08,.09,.23,.15,.4);box(g,color,s*.37,.84,0,.17,.6,.22,0,0,s*.18);ball(g,C.skin,s*.42,.51,.01,.10,.1,.09);});ball(g,C.skin,0,1.47,0,.29,.3,.25);ball(g,C.wood,0,1.64,-.03,.29,.14,.24);[-1,1].forEach(function(s){box(g,C.dark,s*.1,1.49,.239,.045,.065,.024);});cyl(g,color,0,1.76,0,.3,.31,.18,8);cyl(g,type===1?C.gold:color,0,1.68,.02,.4,.4,.05,10);if(type===2){box(g,C.wood,.53,.99,.02,.06,1,.06);box(g,C.stone,.53,1.52,.02,.56,.13,.14);}else if(type===3){box(g,C.pink,0,.93,-.27,.53,.65,.27);box(g,C.wood,.54,.75,.02,.05,1.45,.05);}return g;}
 function frame(x,z){var d=geo.mapToDirection(x,z),up=new T.Vector3(d.x,d.y,d.z),a=geo.mapToDirection(x+.05,z),b=geo.mapToDirection(x-.05,z),east=new T.Vector3(a.x-b.x,a.y-b.y,a.z-b.z).normalize(),south=new T.Vector3().crossVectors(east,up).normalize();east.crossVectors(up,south).normalize();return{up:up,q:new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(east,up,south))};}
 function place(batch,model,x,z,id,kind,yaw,water){
  var y=water?geo.seaLevel+.025:geo.heightAt(x,z);if(!water&&y<1)return false;
  if(!water&&kind==='building'){var low=y,high=y;for(var i=0;i<8;i++){var a=i*Math.PI/4,h=geo.heightAt(x+Math.cos(a)*2.3,z+Math.sin(a)*2.3);low=Math.min(low,h);high=Math.max(high,h);}y=high+.02;box(model,C.stone,0,-(high-low+.18)*.5,0,3.6,high-low+.18,3.1);}
  if(globe){var f=frame(x,z),r=geo.oceanRadius+(y-geo.seaLevel)*.012;model.position.copy(f.up).multiplyScalar(r+.0005);model.quaternion.copy(f.q);model.scale.setScalar(.012);if(yaw)model.rotateY(yaw);}else{model.position.set(x,y,z);model.rotation.y=yaw||0;}
  batch.add(model);sites.push({id:id,region:batch.userData.regionId,x:x,z:z,kind:kind});if(kind==='building'||kind==='landmark')structures++;return true;
 }
 function tree(size,hollow){var g=new T.Group();cyl(g,C.wood,0,size*.3,0,hollow?1.45:.45,hollow?1.7:.68,size*.6,9);for(var i=0;i<5;i++){var a=i*2.4;ball(g,i%2?C.leaf:C.green,Math.cos(a)*size*.15,size*.67+(i%2)*size*.12,Math.sin(a)*size*.15,size*.27,size*.25,size*.25);}if(hollow){box(g,C.dark,0,1.45,1.45,1.05,2.8,.12);box(g,C.gold,0,2.3,1.55,.65,.12,.08);box(g,C.wood,-1.65,.7,1.9,2,.18,.55);[-2.35,-.95].forEach(function(x){box(g,C.wood,x,.33,1.9,.12,.65,.5);});}return g;}
 function mushroom(color,size){var g=new T.Group();cyl(g,C.cream,0,size*.28,0,size*.19,size*.25,size*.56,8);ball(g,color,0,size*.68,0,size*.58,size*.29,size*.58);for(var i=0;i<5;i++){var a=i*2.4;ball(g,C.white,Math.cos(a)*size*.32,size*.86,Math.sin(a)*size*.32,size*.09,size*.035,size*.09);}return g;}
 function mill(){var g=new T.Group();cyl(g,C.cream,0,2.3,0,1.1,1.6,4.6,10);cone(g,C.pink,0,5.1,0,1.6,1.35,10);box(g,C.wood,0,1,1.5,.8,1.9,.1);cyl(g,C.wood,0,3.4,1.4,.24,.24,.55,8,Math.PI/2);for(var i=0;i<4;i++){var a=i*Math.PI/2+.5;box(g,C.wood,Math.sin(a)*1.4,3.4+Math.cos(a)*1.4,1.75,.16,3.2,.12,0,0,-a);box(g,C.white,Math.sin(a)*1.8+Math.cos(a)*.3,3.4+Math.cos(a)*1.8-Math.sin(a)*.3,1.82,.7,1.7,.07,0,0,-a);}return g;}
 function compile(batch,id){batch.updateMatrixWorld(true);var pp=[],nn=[],cc=[],indices=[],v=new T.Vector3(),n=new T.Vector3(),nm=new T.Matrix3();batch.traverse(function(o){if(!o.isMesh)return;var g=o.geometry,p=g.attributes.position,normal=g.attributes.normal,offset=pp.length/3,color=o.material.color;nm.getNormalMatrix(o.matrixWorld);for(var i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);n.fromBufferAttribute(normal,i).applyMatrix3(nm).normalize();pp.push(v.x,v.y,v.z);nn.push(n.x,n.y,n.z);cc.push(color.r,color.g,color.b);}if(g.index){for(var j=0;j<g.index.count;j++)indices.push(offset+g.index.getX(j));}else for(var j=0;j<p.count;j++)indices.push(offset+j);});var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pp,3));g.setAttribute('normal',new T.Float32BufferAttribute(nn,3));g.setAttribute('color',new T.Float32BufferAttribute(cc,3));g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(pp.length/3*2),2));g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();var mesh=new T.Mesh(g,material);mesh.name='frontier-'+id;mesh.userData.regionId=id;group.add(mesh);targets.push(mesh);batch.clear();}
 REGIONS.forEach(function(id,regionIndex){var b=new T.Group();b.userData.regionId=id;
  if(id==='forest'){
   [[-75,-20,12],[-61,-22,10],[-79,-9,11],[-59,-4,9],[-72,0,10],[-78,-28,8],[-59,-30,8]].forEach(function(p,i){place(b,tree(p[2],i===0),p[0],p[1],'giant-tree-'+i,'landmark');});
   [[-66,-21,3],[-73,-5,2.8],[-64,-3,2.3],[-80,-17,3.2],[-58,-16,2.5],[-68,-29,2.8]].forEach(function(p,i){place(b,mushroom([C.pink,C.blue,C.gold][i%3],p[2]),p[0],p[1],'forest-mushroom-'+i,'landmark');});
   place(b,hut(C.green),-63,-13,'ranger-cabin','building',-.4);place(b,tent(C.gold),-73,-12,'forest-tent','building');
   for(var i=0;i<20;i++){var g=new T.Group();box(g,C.wood,0,.12,0,2.1,.18,.5);place(b,g,-68+Math.sin(i*.17)*1.2,-12-i*.5,'forest-boardwalk-'+i,'path');}
  }else if(id==='gardens'){
   place(b,mill(),-24,64,'garden-windmill','landmark');place(b,hut(C.pink),-11,56,'garden-farmhouse','building');place(b,hut(C.blue),-29,57,'garden-store','building');
   for(var row=0;row<6;row++)for(var col=0;col<13;col++){var g=new T.Group(),color=[C.pink,C.gold,C.white,C.blue,C.pink,C.gold][row];box(g,C.green,0,.32,0,.06,.6,.06);for(var k=0;k<4;k++){var a=k*Math.PI/2;ball(g,color,Math.cos(a)*.14,.68,Math.sin(a)*.14,.17,.085,.17);}ball(g,C.gold,0,.73,0,.07,.05,.07);place(b,g,-19+col*.62,65+row*.82,'garden-flower-'+row+'-'+col,'garden');}
   for(var i=0;i<14;i++){var g=new T.Group();ball(g,0xdb9549,0,.3,0,.35,.3,.33);box(g,C.green,0,.65,0,.08,.2,.08);place(b,g,-26+(i%7)*.85,52+Math.floor(i/7)*.9,'garden-pumpkin-'+i,'garden');}
   for(var i=0;i<12;i++){var g=new T.Group();box(g,C.white,0,.5,0,.12,1,.12);box(g,C.white,.42,.55,0,.85,.09,.08);place(b,g,-22+i*.85,70,'garden-fence-'+i,'prop');}
  }else if(id==='canyon'){
   [[64,-6,7,2.3],[79,-8,10,2.1],[83,2,8,2.5],[80,12,6,2.7],[61,10,6,2.1]].forEach(function(p,i){var g=new T.Group();cyl(g,i%2?C.red:C.stone,0,p[2]*.5,0,p[3]*.8,p[3],p[2],7);for(var j=0;j<3;j++)cyl(g,0xd69b75,0,p[2]*(.22+j*.22),0,p[3]*(.98-j*.04),p[3]*(.98-j*.04),.18,7);place(b,g,p[0],p[1],'canyon-mesa-'+i,'landmark');});
   var arch=new T.Group();[-3.1,3.1].forEach(function(x){cyl(arch,C.red,x,2.6,0,1.2,1.65,5.2,7);});box(arch,C.stone,0,5.25,0,7.8,1.7,2.5,0,0,.07);place(b,arch,71,-9,'canyon-stone-arch','landmark');
   var mine=new T.Group();box(mine,C.dark,0,1.4,0,3.5,2.8,.4);[-1.8,1.8].forEach(function(x){box(mine,C.wood,x,1.6,.25,.35,3.2,.5);});box(mine,C.wood,0,3.1,.25,4.1,.4,.5);box(mine,C.gold,0,2.5,.45,.55,.22,.1);place(b,mine,78,6,'canyon-mine','building');
   for(var i=0;i<15;i++){var g=new T.Group();[-.48,.48].forEach(function(x){box(g,C.dark,x,.12,0,.06,.1,.85);});box(g,C.wood,0,.06,0,1.25,.1,.18);place(b,g,78,5-i*.6,'mine-track-'+i,'path');}
   var cart=new T.Group();box(cart,C.dark,0,.4,0,1.1,.6,1.35);box(cart,C.stone,0,.8,0,.92,.25,1.1);[-1,1].forEach(function(s){cyl(cart,C.gold,s*.58,.17,0,.22,.22,.1,8,0,0,Math.PI/2);});place(b,cart,78,1,'canyon-mine-cart','landmark');
   place(b,hut(C.red),65,5,'canyon-watch-house','building');
  }else{
   place(b,hut(C.blue),-7,-67,'lake-chalet','building',.4);place(b,tent(C.gold),-9,-58,'lake-tent-gold','building',-.4);place(b,tent(C.pink),-1,-54,'lake-tent-pink','building',.2);
   var telescope=new T.Group();[-1,0,1].forEach(function(s){box(telescope,C.wood,s*.34,.7,s===0?-.38:.3,.09,1.6,.09,0,0,-s*.25);});cyl(telescope,C.blue,0,1.65,0,.27,.35,1.55,10,.8);cyl(telescope,C.gold,0,2.17,.55,.3,.3,.1,10,.8);place(b,telescope,-2,-66,'lake-telescope','landmark');
   for(var i=0;i<11;i++){var g=new T.Group();box(g,C.wood,0,.08,0,.56,.16,2.15);if(i%3===0)[-1,1].forEach(function(s){box(g,C.wood,0,-.25,s*.95,.14,.8,.14);});place(b,g,.8+i*.5,-63,'lake-jetty-'+i,'path',0,true);}
   var boat=new T.Group();cyl(boat,C.wood,0,.12,0,.7,.45,.45,8);box(boat,C.cream,0,.34,0,.75,.12,1);box(boat,C.wood,0,1.2,0,.065,1.9,.065);var sail=new T.BufferGeometry();sail.setAttribute('position',new T.Float32BufferAttribute([0,.5,0,0,2.1,0,1.05,.55,0],3));sail.computeVertexNormals();part(boat,sail,C.white,0,0,0);geometries.set('sail',sail);place(b,boat,8,-62,'lake-sailboat','landmark',.4,true);
   [[-12,-71],[-11,-52],[1,-72],[3,-53]].forEach(function(p,i){place(b,tree(5+i%2,false),p[0],p[1],'lake-pine-'+i,'landmark');});
  }
  var region=geo.regions.find(function(r){return r.id===id;});[[-3,3],[3,2],[-4,-3],[4,-3]].forEach(function(p,i){var x=region.x+p[0],z=region.z+p[1];if(place(b,person(regionIndex),x,z,id+'-resident-'+i,'resident',i*.6))residents++;});compile(b,id);
 });
 geometries.forEach(function(g){g.dispose();});paints.forEach(function(m){m.dispose();});geometries.clear();paints.clear();
 var stats={regions:4,structures:structures,residents:residents,triangles:0,drawCalls:targets.length,geometryBytes:0};targets.forEach(function(m){var g=m.geometry;stats.triangles+=g.index.count/3;Object.keys(g.attributes).forEach(function(k){stats.geometryBytes+=g.attributes[k].array.byteLength;});stats.geometryBytes+=g.index.array.byteLength;});
 group.userData.frontier={stats:stats,sites:sites};parent.add(group);var disposed=false;return{group:group,stats:stats,sites:sites,pickTargets:targets,dispose:function(){if(disposed)return;disposed=true;targets.forEach(function(m){m.geometry.dispose();});material.dispose();group.removeFromParent();}};
}
root.MarioFrontierWorld={build:build};
})(window);
