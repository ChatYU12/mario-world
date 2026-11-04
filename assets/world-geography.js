/* Shared continuous mainland, projection, coast and biomes. No Three.js dependency. */
(function (root) {
  'use strict';
  var bounds={minX:-68,maxX:68,minZ:-58,maxZ:58},seaLevel=.48,oceanRadius=.998;
  var projection={lat:12,lon:90,scale:65,centerX:-2,centerZ:-1};
  var rad=Math.PI/180,a=projection.lat*rad,b=projection.lon*rad;
  var center={x:Math.cos(a)*Math.cos(b),y:Math.sin(a),z:Math.cos(a)*Math.sin(b)};
  var east={x:Math.sin(b),y:0,z:-Math.cos(b)};
  var north={x:-Math.sin(a)*Math.cos(b),y:Math.cos(a),z:-Math.sin(a)*Math.sin(b)};
  function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
  function smooth(lo,hi,x){var t=clamp((x-lo)/(hi-lo),0,1);return t*t*(3-2*t);}
  function gaussian(x,z,cx,cz,sx,sz){var dx=(x-cx)/sx,dz=(z-cz)/sz;return Math.exp(-(dx*dx+dz*dz));}
  function mapToDirection(x,z){var u=(x-projection.centerX)/projection.scale,v=-(z-projection.centerZ)/projection.scale,px=center.x+east.x*u+north.x*v,py=center.y+east.y*u+north.y*v,pz=center.z+east.z*u+north.z*v,length=Math.hypot(px,py,pz);return{x:px/length,y:py/length,z:pz/length};}
  function directionToMap(d){
    var dot=d.x*center.x+d.y*center.y+d.z*center.z;
    if(!(dot>1e-7))return{x:0,z:0,inside:false,front:false};
    var x=projection.centerX+projection.scale*(d.x*east.x+d.y*east.y+d.z*east.z)/dot;
    var z=projection.centerZ-projection.scale*(d.x*north.x+d.y*north.y+d.z*north.z)/dot;
    return{x:x,z:z,inside:x>=bounds.minX&&x<=bounds.maxX&&z>=bounds.minZ&&z<=bounds.maxZ,front:true};
  }
  function baseCoastField(x,z){var ax=(x+2)/65.5,az=(z+1)/52.5;return 1-ax*ax-az*az+.035*Math.sin(x*.18+z*.1)+.02*Math.cos(z*.25-x*.09);}
  function coastField(x,z){
    var field=baseCoastField(x,z);
    if(field>.45||field<-.65)return field;
    var edge=1-smooth(.08,.45,field);
    var bays=-.15*gaussian(x,z,-56,-7,9,13)-.14*gaussian(x,z,12,43,15,10)-.12*gaussian(x,z,52,15,10,14);
    var headlands=.07*gaussian(x,z,15,-43,16,9)+.07*gaussian(x,z,-40,33,15,9);
    var coves=.019*Math.sin(x*.46+z*.37)+.014*Math.cos(z*.61-x*.23);
    return field+edge*(bays+headlands+coves);
  }
  function riverX(z){return -7+.28*(z+14)+5*Math.sin((z+14)/20);}
  var branch=[[riverX(17),17],[17,30],[27,43],[29,55]];
  function lineDistance(x,z,p,q){var dx=q[0]-p[0],dz=q[1]-p[1],t=clamp(((x-p[0])*dx+(z-p[1])*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(x-p[0]-t*dx,z-p[1]-t*dz);}
  function riverDistance(x,z){var distance=Math.abs(x-riverX(z))/Math.sqrt(1+.4*.4);for(var i=0;i<branch.length-1;i++)distance=Math.min(distance,lineDistance(x,z,branch[i],branch[i+1]));return distance;}
  function flatten(h,x,z,cx,cz,radius,level){return level+(h-level)*smooth(radius*.65,radius,Math.hypot(x-cx,z-cz));}
  function heightAt(x,z){
    var coast=coastField(x,z),hills=.52*Math.sin(x*.078+.3)*Math.cos(z*.092)+.25*Math.sin(z*.17+x*.07),base=2.5+hills;
    base+=gaussian(x,z,-36,-34,17,18)*(7+3.6*Math.pow(Math.sin(x*.20+z*.15),2));
    base+=gaussian(x,z,38,-30,17,17)*(5.3+2.5*Math.pow(Math.sin(x*.17-z*.11),2));
    base+=gaussian(x,z,-49,26,19,20)*(.7+.6*Math.sin(x*.15+z*.12));
    base=flatten(base,x,z,0,-14,8.7,3.15);base=flatten(base,x,z,-26,12,6.1,2.65);base=flatten(base,x,z,18,26,3.2,2.45);
    // Interior values are byte-for-byte the previous formula. Only the sea shelf changes.
    var land=coast>=.18?base:(-.65-2.2*(1-smooth(-.35,-.025,coast)));
    if(coast<.18)land+=(base-land)*smooth(-.05,.16,coast);
    var d=riverDistance(x,z),carved=.12+(land-.12)*smooth(1.32,3.65,d);
    land+=(carved-land)*smooth(-.02,.08,coast);
    return land;
  }
  function biomeAt(x,z){var h=heightAt(x,z);return{height:h,depth:Math.max(0,seaLevel-h),forest:clamp(.24+.18*Math.sin(x*.09)*Math.cos(z*.13),0,1),sand:smooth(.12,.72,gaussian(x,z,-49,27,24,25)),rock:smooth(.22,.85,gaussian(x,z,40,-31,19,20)),snow:smooth(.12,.65,gaussian(x,z,-36,-35,20,21)*smooth(4.5,10.5,h)),shore:1-smooth(.48,1.8,h),coast:coastField(x,z),river:1-smooth(1.3,4.3,riverDistance(x,z))};}
  function terrainRadiusAt(x,z){return oceanRadius+(heightAt(x,z)-seaLevel)*.012;}
  function globeRadiusAt(d){var p=directionToMap(d);return p.front&&p.inside?Math.max(oceanRadius,terrainRadiusAt(p.x,p.z)):oceanRadius;}
  // Periodic neutral surface grain; pure pixel data shared by both view materials.
  function surfaceTexturePixels(size){
    size=size||256;var pixels=new Uint8Array(size*size*4);
    function hash(x,y,cells){x=(x%cells+cells)%cells;y=(y%cells+cells)%cells;var n=(Math.imul(x,374761393)+Math.imul(y,668265263))|0;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
    function noise(u,v,cells){var x=u*cells,y=v*cells,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);var a=hash(ix,iy,cells)*(1-fx)+hash(ix+1,iy,cells)*fx,b=hash(ix,iy+1,cells)*(1-fx)+hash(ix+1,iy+1,cells)*fx;return a*(1-fy)+b*fy;}
    for(var y=0;y<size;y++)for(var x=0;x<size;x++){var u=x/size,v=y/size,value=Math.round(249+(noise(u,v,4)-.5)*6+(noise(u,v,16)-.5)*4+(noise(u,v,64)-.5)*2+(hash(x,y,size)-.5)*3),i=(y*size+x)*4;value=clamp(value,238,255);pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;}
    return pixels;
  }
  var definitions=[
    ['collaboration','智能协作 · 城堡与村落',0,-14,'mushroom-kingdom','从主城堡出发，探索人与智能体如何围绕共同任务协作。'],
    ['automation','业务自动化 · 工坊与道路',-26,12,'automation-workshop','沿着运输道路来到工坊，了解业务步骤如何连接并持续执行。'],
    ['connection','数据连接 · 港口与水路',18,26,'connection-harbor','水路与管网在港口汇合，让信息流向需要它的地方。'],
    ['snow','雪山与山麓',-32,-28,'snow-peaks','草地沿山路逐渐过渡成针叶林、冰岩与积雪山脊。'],
    ['desert','沙漠与绿洲',-48,22,'desert','从工坊向西，沿路经过草地边缘、沙丘与棕榈绿洲。'],
    ['lava','火山与熔岩峡谷',34,-24,'lava-kingdom','向东越过岩地，探索生长在大陆上的火山与熔岩地貌。']
  ];
  var regions=definitions.map(function(r){var d=mapToDirection(r[2],r[3]);return{id:r[0],name:r[1],x:r[2],z:r[3],lat:Math.asin(d.y)/rad,lon:Math.atan2(d.z,d.x)/rad,legacyName:r[4],description:r[5]};});
  var routeDefinitions=[
    {from:'collaboration',to:'automation',controls:[[0,-14],[0,-9],[-7,-6],[-16,0],[-22,6],[-26,10],[-26,12]]},
    {from:'automation',to:'connection',controls:[[-26,12],[-24,14],[-16,19],[-4,20],[7,24],[15,26],[18,26]]},
    {from:'collaboration',to:'snow',controls:[[0,-14],[-3,-17],[-12,-20],[-21,-21],[-27,-26],[-32,-28]]},
    {from:'automation',to:'desert',controls:[[-26,12],[-29,13],[-35,15],[-41,19],[-48,22]]},
    {from:'collaboration',to:'lava',controls:[[0,-14],[4,-15],[13,-17],[21,-18],[27,-22],[34,-24]]}
  ];
  root.MarioWorldGeography={version:'continuous-mainland-1',regions:regions,bounds:bounds,seaLevel:seaLevel,oceanRadius:oceanRadius,projection:projection,heightAt:heightAt,coastField:coastField,biomeAt:biomeAt,surfaceTexturePixels:surfaceTexturePixels,mapToDirection:mapToDirection,directionToMap:directionToMap,globeRadiusAt:globeRadiusAt,terrainRadiusAt:terrainRadiusAt,routeDefinitions:routeDefinitions,riverX:riverX,riverDistance:riverDistance,gaussian:gaussian,smooth:smooth};
})(window);
