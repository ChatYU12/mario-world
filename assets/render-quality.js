/* Small rendering helpers: vertex lighting, cheaper background shading,
   grounded contact shadows, and offline imported town architecture. */
(function(root){
  'use strict';
  function optimize(T,group){
    var replacements=new Map(),originals=new Set();
    group.traverse(function(o){if(!o.isMesh||!o.material)return;
      function convert(m){if(!m.isMeshStandardMaterial)return m;if(replacements.has(m))return replacements.get(m);
        var lite=new T.MeshLambertMaterial({color:m.color,emissive:m.emissive,emissiveIntensity:m.emissiveIntensity,vertexColors:m.vertexColors,map:m.map,transparent:m.transparent,opacity:m.opacity,side:m.side,depthWrite:m.depthWrite,alphaTest:m.alphaTest,flatShading:m.flatShading});
        lite.name=(m.name||'world')+'-light';replacements.set(m,lite);originals.add(m);return lite;}
      o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);
    });
    var stillUsed=new Set();group.traverse(function(o){if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(function(m){stillUsed.add(m);});});
    originals.forEach(function(m){if(!stillUsed.has(m))m.dispose();});
    return replacements.size;
  }
  function shadowTexture(T){
    if(typeof document==='undefined')return null;var c=document.createElement('canvas');c.width=c.height=128;var x=c.getContext('2d');if(!x||!x.createRadialGradient)return null;
    var g=x.createRadialGradient(64,64,12,64,64,62);g.addColorStop(0,'rgba(22,44,29,.25)');g.addColorStop(.55,'rgba(22,44,29,.15)');g.addColorStop(1,'rgba(22,44,29,0)');x.fillStyle=g;x.fillRect(0,0,128,128);return new T.CanvasTexture(c);
  }
  function groundShadows(T,parent,heightAt){
    var texture=shadowTexture(T);if(!texture)return;
    var positions=[],uv=[],indices=[],spots=[[0,-14,7.8,6.3],[-26,12,7,5.5],[18,26,7.2,6.2]];
    spots.forEach(function(s){var offset=positions.length/3,n=8;for(var j=0;j<=n;j++)for(var i=0;i<=n;i++){var x=s[0]+(i/n-.5)*s[2]*2,z=s[1]+(j/n-.5)*s[3]*2;positions.push(x,heightAt(x,z)+.045,z);uv.push(i/n,1-j/n);}for(var j=0;j<n;j++)for(var i=0;i<n;i++){var a=offset+j*(n+1)+i;indices.push(a,a+n+1,a+1,a+1,a+n+1,a+n+2);}});
    var geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
    var mesh=new T.Mesh(geo,new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,toneMapped:false}));mesh.name='soft-ground-contact';mesh.renderOrder=1;parent.add(mesh);
  }
  function overview(T,parent,story,regions,project){
    if(!root.MarioImportedModels)return {buildings:0};
    var kit=root.MarioImportedModels.create(T),source=new T.Group(),bins=new Map(),count=0;
    var choices=['houseA','houseB','tavern','blacksmith','watchtower','market'];
    regions.forEach(function(r,index){for(var i=0;i<3;i++){
      var name=choices[(index+i)%choices.length];if(!root.MarioImportedModels.names.includes(name))continue;
      var object=kit.build(name,{palette:'storybook'}),d=project(r.lat+(i-1)*4,r.lon+(i===1?8:-7),1).normalize();
      object.scale.setScalar(.042);object.position.copy(d).multiplyScalar(story.height(d)+.003);object.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d);object.rotateY(i*.8);object.userData.regionId=r.id;source.add(object);count++;
    }});
    source.updateMatrixWorld(true);
    source.traverse(function(o){if(!o.isMesh||Array.isArray(o.material))return;var p=o,role='';while(p&&p!==source){if(p.userData.regionId){role=p.userData.regionId;break;}p=p.parent;}
      var key=o.material.uuid+'/'+role,b=bins.get(key);if(!b){b={material:o.material,role:role,p:[],n:[],c:[],index:[]};bins.set(key,b);}var g=o.geometry,offset=b.p.length/3,v=new T.Vector3(),n=new T.Vector3(),nm=new T.Matrix3().getNormalMatrix(o.matrixWorld),pos=g.attributes.position,norm=g.attributes.normal,col=g.attributes.color;
      for(var i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);n.fromBufferAttribute(norm,i).applyMatrix3(nm).normalize();b.p.push(v.x,v.y,v.z);b.n.push(n.x,n.y,n.z);b.c.push(col?col.getX(i):1,col?col.getY(i):1,col?col.getZ(i):1);}
      if(g.index)for(var i=0;i<g.index.count;i++)b.index.push(offset+g.index.getX(i));else for(var i=0;i<pos.count;i++)b.index.push(offset+i);
    });
    bins.forEach(function(b){var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(b.n,3));g.setAttribute('color',new T.Float32BufferAttribute(b.c,3));g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(b.p.length/3*2),2));g.setIndex(b.index);g.computeBoundingSphere();var m=new T.Mesh(g,b.material);m.userData.regionId=b.role;m.name='imported-overview-town-'+b.role;parent.add(m);});
    var old=new Set();source.traverse(function(o){if(o.geometry)old.add(o.geometry);});old.forEach(function(g){g.dispose();});source.clear();bins.clear();
    return{buildings:count};
  }
  function fastWater(T,mesh,isGlobe){
    if(!mesh||typeof document==='undefined')return;var canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;var context=canvas.getContext('2d');if(!context||!context.createImageData)return;
    var image=context.createImageData(512,256),pixels=image.data;
    for(var y=0;y<256;y++)for(var x=0;x<512;x++){var u=x/512,v=y/256,qx=isGlobe?-Math.cos(u*Math.PI*2)*Math.sin(v*Math.PI):u,qy=isGlobe?Math.cos(v*Math.PI):v,qz=isGlobe?Math.sin(u*Math.PI*2)*Math.sin(v*Math.PI):v;
      var flow=isGlobe?qx*64+qz*25+Math.sin(qy*44)*1.8:(u*8+v*3)*Math.PI*2+Math.sin(v*Math.PI*4)*1.8;
      var foam=Math.pow(1-Math.abs(Math.sin(flow)),25)*.24,wave=Math.sin(isGlobe?qy*4+qx*3:(v*2+u)*Math.PI*2),i=(y*512+x)*4;
      pixels[i]=Math.round((.03+foam*.12)*255);pixels[i+1]=Math.round((.39+.13*wave+foam*.22)*255);pixels[i+2]=Math.round((.48+.12*wave+foam*.20)*255);pixels[i+3]=255;}
    context.putImageData(image,0,0);var texture=new T.CanvasTexture(canvas);texture.wrapS=texture.wrapT=T.RepeatWrapping;
    var material=new T.ShaderMaterial({uniforms:{uWater:{value:texture}},vertexShader:'varying vec2 vUv; varying float light; varying float shine; void main(){vUv=uv*'+(isGlobe?'1.0':'80.0')+'; vec3 n=normalize(mat3(modelMatrix)*normal); vec3 wp=(modelMatrix*vec4(position,1.)).xyz; vec3 l=normalize(vec3(-.5,.8,1.)); vec3 v=normalize(cameraPosition-wp); light=.70+.30*max(0.,dot(n,l)); shine=pow(max(0.,dot(n,normalize(l+v))),40.);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform sampler2D uWater; varying vec2 vUv; varying float light; varying float shine; void main(){vec3 c=texture2D(uWater,vUv).rgb;gl_FragColor=vec4(c*light+shine*.22,1.);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}'});
    mesh.material.dispose();mesh.material=material;
  }
  root.MarioRenderQuality={optimize:optimize,groundShadows:groundShadows,overview:overview,fastWater:fastWater};
})(window);
