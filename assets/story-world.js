/* Continuous spherical mainland. Shared coast, roads and regions with the explorable map. */
(function(root){
  'use strict';
  var surfaceTextures=new WeakMap();
  function surfaceTexture(T){
    if(surfaceTextures.has(T))return surfaceTextures.get(T);
    if(typeof document==='undefined'||!root.MarioWorldGeography)return null;
    var canvas=document.createElement('canvas');canvas.width=canvas.height=256;var context=canvas.getContext('2d');if(!context||!context.createImageData)return null;
    var image=context.createImageData(256,256);image.data.set(root.MarioWorldGeography.surfaceTexturePixels(256));context.putImageData(image,0,0);
    var texture=new T.CanvasTexture(canvas);texture.name='shared-mainland-micrograin-256';texture.encoding=T.sRGBEncoding;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(28,24);texture.anisotropy=4;surfaceTextures.set(T,texture);return texture;
  }
  root.MarioStoryWorld={build:build,surfaceTexture:surfaceTexture};
  function runtimeWorld(ocean,pickTargets,focusPoints,geo,uniforms){
    return{ocean:ocean,pickTargets:pickTargets,focusPoints:focusPoints,height:geo.globeRadiusAt,tick:function(t){uniforms.uTime.value=t;},geoRegions:geo.regions,geography:geo,bounds:geo.bounds,seaLevel:geo.seaLevel,coastField:geo.coastField,directionToMap:geo.directionToMap,mapToDirection:geo.mapToDirection};
  }
  function build(T,world,options){
    var opts=options||{},geo=root.MarioWorldGeography;
    if(!geo)throw new Error('Shared world-geography.js must load before story-world.js');
    var kit=root.MarioWorldModels.create(T),source=new T.Group(),pickTargets=[],focusPoints={},modelCount=0,seed=1729;
    source.name='continuous-world-construction';world.add(source);
    function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
    function material(color,extra){return new T.MeshStandardMaterial(Object.assign({color:color,roughness:.79},extra||{}));}
    var M={earth:material(0xffffff,{vertexColors:true,map:surfaceTexture(T)}),path:material(0xe6cfab,{side:T.DoubleSide}),wood:material(0x9a7857,{side:T.DoubleSide}),snow:material(0xe7f2ef),stone:material(0xa9a89b),lava:material(0xd98957,{emissive:0x9a431b,emissiveIntensity:.28}),flowerPink:material(0xdb9da9),flowerGold:material(0xe6ca7d),flowerWhite:material(0xf2efdb)};
    var sphere=new T.SphereGeometry(1,8,6),box=new T.BoxGeometry(1,1,1);
    function mesh(g,m,parent,x,y,z){var o=new T.Mesh(g,m);if(x!==undefined)o.position.set(x,y,z);(parent||source).add(o);return o;}
    function pointAt(x,z,lift){var d=geo.mapToDirection(x,z),r=geo.terrainRadiusAt(x,z)+(lift||0);return new T.Vector3(d.x*r,d.y*r,d.z*r);}
    function frameAt(x,z){
      var d=geo.mapToDirection(x,z),up=new T.Vector3(d.x,d.y,d.z),a=geo.mapToDirection(x+.05,z),b=geo.mapToDirection(x-.05,z),east=new T.Vector3(a.x-b.x,a.y-b.y,a.z-b.z).normalize(),south=new T.Vector3().crossVectors(east,up).normalize();east.crossVectors(up,south).normalize();
      return{point:pointAt(x,z,0),normal:up,quaternion:new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(east,up,south))};
    }
    function place(model,x,z,scale,yaw,lift,nodeId){
      var f=frameAt(x,z),g=new T.Group();g.position.copy(f.point).addScaledVector(f.normal,lift||.0005);g.quaternion.copy(f.quaternion);if(yaw)g.rotateY(yaw);g.scale.setScalar(scale);g.add(model);source.add(g);modelCount++;
      if(nodeId){g.userData.nodeId=nodeId;focusPoints[nodeId]=g.position.clone().addScaledVector(f.normal,.13);}
      return g;
    }
    var oceanUniforms = { uTime: { value: 0 } };
    var oceanMaterial = new T.ShaderMaterial({
      uniforms: oceanUniforms,
      vertexShader: 'varying vec3 p; varying vec3 wn; varying vec3 wp; void main(){p=position;wn=normalize(mat3(modelMatrix)*normal);wp=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: [
        'varying vec3 p; varying vec3 wn; varying vec3 wp; uniform float uTime;',
        'void main(){vec3 q=normalize(p);',

        'vec3 color=mix(vec3(.018,.21,.30),vec3(.045,.56,.62),.48+.30*sin(q.y*4.+q.x*3.));',
        'vec3 l=normalize(vec3(-.5,.8,1.));vec3 v=normalize(cameraPosition-wp);',
        'float spec=pow(max(0.,dot(normalize(wn),normalize(l+v))),95.);',
        'color+=spec*.45;',
        'gl_FragColor=vec4(color*(.70+.30*max(0.,dot(wn,l))),1.);',
        '#include <tonemapping_fragment>', '#include <encodings_fragment>', '}'
      ].join('\n')
    });
    var ocean = mesh(new T.SphereGeometry(.998, 112, 80), oceanMaterial, world);
    ocean.name = 'turquoise-ocean';


    // A single indexed curved grid replaces independent raised discs and side bands.
    var nx=144,nz=128,positions=[],colors=[],uvs=[],indices=[],color=new T.Color();
    var grass=new T.Color(0x6fa46c),forest=new T.Color(0x397953),sand=new T.Color(0xe4cda5),rock=new T.Color(0x67666d),snow=new T.Color(0xe6f1ee),shore=new T.Color(0xd8c8a7),riverBank=new T.Color(0x8f9d82),shoreTint=new T.Color(),underwater=new T.Color(0x477d89);
    for(var iz=0;iz<=nz;iz++){
      var z=geo.bounds.minZ+iz/nz*(geo.bounds.maxZ-geo.bounds.minZ);
      for(var ix=0;ix<=nx;ix++){
        var x=geo.bounds.minX+ix/nx*(geo.bounds.maxX-geo.bounds.minX),biome=geo.biomeAt(x,z),p=pointAt(x,z,0);
        positions.push(p.x,p.y,p.z);uvs.push(ix/nx,iz/nz);
        color.copy(grass).lerp(forest,biome.forest).lerp(sand,biome.sand).lerp(rock,biome.rock).lerp(snow,biome.snow);
        if(biome.height<1.8){shoreTint.copy(shore).lerp(riverBank,biome.river*.86);color.lerp(shoreTint,biome.shore*.72);}
        if(biome.height<geo.seaLevel)color.lerp(underwater,.42+.48*geo.smooth(0,2.8,biome.depth));
        color.multiplyScalar(.98+.025*Math.sin(x*.6+z*.3));colors.push(color.r,color.g,color.b);
      }
    }
    for(var iz=0;iz<nz;iz++)for(var ix=0;ix<nx;ix++){var a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1;indices.push(a,c,b,b,c,d);}
    var terrain=new T.BufferGeometry();terrain.setAttribute('position',new T.Float32BufferAttribute(positions,3));terrain.setAttribute('color',new T.Float32BufferAttribute(colors,3));terrain.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));terrain.setIndex(indices);terrain.computeVertexNormals();mesh(terrain,M.earth).name='continuous-spherical-mainland';

    function roadStrip(points,width,mat){
      var pp=[],uu=[];
      for(var i=0;i<points.length-1;i++){
        var p=points[i],q=points[i+1],dx=q.x-p.x,dz=q.z-p.z,length=Math.hypot(dx,dz)||1,sx=-dz/length*width*.5,sz=dx/length*width*.5;
        [[p.x+sx,p.z+sz],[p.x-sx,p.z-sz],[q.x+sx,q.z+sz],[p.x-sx,p.z-sz],[q.x-sx,q.z-sz],[q.x+sx,q.z+sz]].forEach(function(c,j){var h=Math.max(geo.heightAt(c[0],c[1]),geo.seaLevel+.14),dir=geo.mapToDirection(c[0],c[1]),r=geo.oceanRadius+(h-geo.seaLevel)*.012+.001;pp.push(dir.x*r,dir.y*r,dir.z*r);uu.push(j%2,i*.1);});
      }
      var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pp,3));g.setAttribute('uv',new T.Float32BufferAttribute(uu,2));g.computeVertexNormals();return mesh(g,mat);
    }
    var overviewRoutes=[];
    geo.routeDefinitions.forEach(function(def){
      var curve=new T.CatmullRomCurve3(def.controls.map(function(p){return new T.Vector3(p[0],0,p[1]);})),points=curve.getPoints(Math.max(60,Math.ceil(curve.getLength()*2)));
      roadStrip(points,1.6,M.path).name='overview-route-'+def.from+'-'+def.to;overviewRoutes.push({from:def.from,to:def.to,samples:points.length});
    });
    roadStrip([new T.Vector3(0,0,-12),new T.Vector3(0,0,-9),new T.Vector3(0,0,-6)],2.0,M.path);
    // Landmarks retain the original authored geometry and exact semantic ownership.
    var exaggeration=1.8/geo.projection.scale;
    place(kit.castle(false),0,-14,16*exaggeration,0,0,'collaboration');
    place(kit.workshop(),-26,12,22*exaggeration,-.12,0,'automation');
    place(kit.harbor(),18,26,24*exaggeration,0,0,'connection');
    [[-7,-10,10],[7,-10,10],[-6,-3,9],[6,-3,9],[-10,-17,8],[10,-17,8]].forEach(function(p,i){place(kit.mushroomHouse(),p[0],p[1],p[2]*exaggeration,i%2?-.12:.12);});
    [[-11,-7,9],[11,-7,9],[-30,16,10],[22,25,9],[-24,7,9]].forEach(function(p){place(kit.pipe(),p[0],p[1],p[2]*exaggeration,0);});
    place(kit.pyramid(),-49,22,23*1.45/geo.projection.scale,.16);place(kit.pyramid(),-42,28,12*1.45/geo.projection.scale,-.2);
    place(kit.castle(true),36,-25,15*1.65/geo.projection.scale,-.25);
    function nearRoad(x,z){return geo.routeDefinitions.some(function(r){for(var i=0;i<r.controls.length-1;i++){var a=r.controls[i],b=r.controls[i+1],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));if(Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<2.4)return true;}return false;});}
    function treeAt(x,z,snowy,scale){if(geo.coastField(x,z)<.17||geo.riverDistance(x,z)<4.2||nearRoad(x,z)||Math.hypot(x,z+14)<7||Math.hypot(x+26,z-12)<3.7||Math.hypot(x-18,z-26)<4.2)return;place(kit.tree(snowy),x,z,(scale||10)*1.4/geo.projection.scale,random()*Math.PI*2);}
    for(var i=0;i<16;i++){var a=i/16*Math.PI*2;treeAt(Math.cos(a)*14,-13+Math.sin(a)*12,false,8+random()*3);}
    [[-20,7],[-32,8],[-31,18],[-22,18],[-37,2],[-39,-10],[-23,-10],[-18,-26],[13,-21],[16,-10],[26,20],[23,32],[12,32],[30,-7],[36,2],[43,9],[6,37],[-21,34],[-33,32]].forEach(function(p){treeAt(p[0],p[1],false,10+random()*3);});
    [[-13,-19],[13,-18],[-14,-2],[14,-2],[-34,6],[-22,22],[26,20],[12,35],[-38,-4],[25,5]].forEach(function(c){for(var j=0;j<5;j++){var a=j*2.399,r=1.5+Math.sqrt(j)*1.1;treeAt(c[0]+Math.cos(a)*r,c[1]+Math.sin(a)*r,false,7+random()*3);}});
    for(var i=0;i<12;i++)treeAt(-43+random()*24,-40+random()*22,true,10+random()*3);
    [[-57,19],[-51,31],[-40,24],[-46,10],[-37,29],[-55,8],[22,30],[16,32]].forEach(function(p){if(geo.heightAt(p[0],p[1])>1&&geo.riverDistance(p[0],p[1])>3.5)place(kit.palm(),p[0],p[1],11*1.5/geo.projection.scale,0);});
    // A few familiar game motifs stay close to roads rather than orbiting the planet.
    [[-18,3],[-30,18],[12,-17],[10,25]].forEach(function(p,i){place(kit.question(),p[0],p[1],.19,i*.6,.018);});
    [[-4,-5],[-3,-4],[-2,-3],[6,23],[8,24],[10,25]].forEach(function(p,i){place(kit.coin(),p[0],p[1],.14,i*.35,.012);});
    for(var i=0;i<26;i++){var x=-10+random()*20,z=-21+random()*20;if(geo.riverDistance(x,z)<3.8||Math.hypot(x,z+14)<5)continue;var g=new T.Group();for(var j=0;j<4;j++){var p=j/4*Math.PI*2,o=mesh(sphere,i%2?M.flowerPink:M.flowerGold,g,Math.cos(p)*.003,.003,Math.sin(p)*.003);o.scale.set(.0025,.0011,.0025);}place(g,x,z,1,0,.0015);}
    // Snow and lava remain continuous ridges from the same height field, with sparse rocks.
    [[-35,-32],[-39,-29],[-29,-35],[30,-30],[41,-24],[38,-34]].forEach(function(p,i){var g=new T.Group(),o=mesh(sphere,i<3?M.snow:M.stone,g);o.scale.set(.012,.009,.016);place(g,p[0],p[1],1,i*.7,0);});
    source.updateMatrixWorld(true);
    var bins=new Map(),worldInverse=world.matrixWorld.clone().invert();
    source.traverse(function(obj){
      if(!obj.isMesh || !obj.geometry || Array.isArray(obj.material))return;
      var role='',parent=obj;
      while(parent && parent!==source){if(parent.userData.nodeId){role=parent.userData.nodeId;break;}parent=parent.parent;}
      var localMatrix=new T.Matrix4().multiplyMatrices(worldInverse,obj.matrixWorld);
      if(!obj.geometry.boundingSphere)obj.geometry.computeBoundingSphere();var partRadius=obj.geometry.boundingSphere.radius*localMatrix.getMaxScaleOnAxis(),tiny=!role&&partRadius<.006;
      var key=obj.material.uuid+'/'+role+'/'+(tiny?'tiny':'main'),bin=bins.get(key);
      if(!bin){bin={mat:obj.material,role:role,p:[],n:[],uv:[],color:[],indices:[],tiny:tiny,maxRadius:0,hasColor:!!obj.geometry.attributes.color};bins.set(key,bin);}
      bin.maxRadius=Math.max(bin.maxRadius,partRadius);
      var geo=obj.geometry,offset=bin.p.length/3;
      var a=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv,c=geo.attributes.color;
      var nm=new T.Matrix3().getNormalMatrix(localMatrix);
      var v=new T.Vector3(),normal=new T.Vector3();
      for(var i=0;i<a.count;i++){
        v.fromBufferAttribute(a,i).applyMatrix4(localMatrix);
        normal.fromBufferAttribute(n,i).applyMatrix3(nm).normalize();
        bin.p.push(v.x,v.y,v.z);bin.n.push(normal.x,normal.y,normal.z);
        bin.uv.push(uv?uv.getX(i):0,uv?uv.getY(i):0);
        if(bin.hasColor)bin.color.push(c?c.getX(i):1,c?c.getY(i):1,c?c.getZ(i):1);
      }
      if(geo.index){for(var j=0;j<geo.index.count;j++)bin.indices.push(offset+geo.index.getX(j));}
      else{for(var j=0;j<a.count;j++)bin.indices.push(offset+j);}
    });
    world.remove(source);
    bins.forEach(function(bin){
      var g=new T.BufferGeometry();
      g.setAttribute('position',new T.Float32BufferAttribute(bin.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(bin.n,3));g.setAttribute('uv',new T.Float32BufferAttribute(bin.uv,2));
      if(bin.hasColor)g.setAttribute('color',new T.Float32BufferAttribute(bin.color,3));
      g.setIndex(bin.indices);
      g.computeBoundingSphere();g.computeBoundingBox();
      var compiled=mesh(g,bin.mat,world);
      compiled.name=bin.role?'building-'+bin.role:'compiled-story-world';compiled.userData.smallDetail=bin.tiny;compiled.userData.partRadius=bin.maxRadius;
      compiled.castShadow=!bin.mat.transparent;compiled.receiveShadow=true;
      if(bin.role){compiled.userData.nodeId=bin.role;pickTargets.push(compiled);}
    });
    world.userData.story={
      regions:geo.regions.map(function(r){var d=geo.mapToDirection(r.x,r.z);return{id:r.id,name:r.legacyName,radius:geo.globeRadiusAt(d),latDir:[d.x,d.y,d.z],x:r.x,z:r.z,lat:r.lat,lon:r.lon};}),
      modelCount:modelCount,materialBatches:bins.size,waterfalls:0,rainbowBands:0,
      sample:'主城堡与周边精细样板',authorship:'全部主体建筑与连续地形由本项目自行生成',
      terrainContinuity:'One continuous curved mainland sampled from the same map height/coast field. No raised discs or stacked island side bands.',
      geoVersion:geo.version,projection:geo.projection,routes:overviewRoutes,bounds:geo.bounds,buildingIds:['collaboration','automation','connection']
    };
    var unused=new Set();source.traverse(function(o){if(o.geometry)unused.add(o.geometry);});unused.forEach(function(g){g.dispose();});
    source.clear();source=null;bins.clear();bins=null;kit=null;
    return runtimeWorld(ocean,pickTargets,focusPoints,geo,oceanUniforms);
  }
})(window);
