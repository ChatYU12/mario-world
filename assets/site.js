/* Local exhibition interactions. Explicit diagnostic links report startup metadata to the local preview only. */
(function () {
  'use strict';
  function reportStartup(diagnostic) {
    if(location.protocol!=='http:' || !['127.0.0.1','localhost'].includes(location.hostname) || new URLSearchParams(location.search).get('diagnostic')!=='1')return;
    var payload=Object.assign({},diagnostic,{source:'mario-world-browser',browser:navigator.userAgent,page:location.pathname,modules:['THREE','MarioWorldModels','MarioStoryWorld','MarioConnectedMap','MarioPlanet'].reduce(function(result,name){result[name]=!!window[name];return result;},{})});
    fetch('/__world_diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(function(){});
  }
  window.addEventListener('error',function(event){if(event.error)reportStartup({state:'failed',kind:'uncaught',name:event.error.name,code:'UNCAUGHT',message:event.message});});
  window.addEventListener('unhandledrejection',function(event){reportStartup({state:'failed',kind:'promise',code:'UNHANDLED_REJECTION',message:String(event.reason)});});
  var nodes = window.MARIO_NODES || [];
  var isExplore = document.documentElement.dataset.page === 'explore';
  var canvas = document.getElementById(isExplore ? 'stage' : 'hero-globe');
  var detail = document.getElementById('detail');
  var planet = null, selected = null, hintDismissed = false, openWorldWhenLanded = false;
  var regionNames = { collaboration:'城堡与村落', automation:'工坊与道路', connection:'港口与水路', snow:'雪山山麓', desert:'沙漠边境', lava:'熔岩山口', forest:'巨木蘑菇林', gardens:'花田风车谷', canyon:'红岩矿谷', lake:'高山湖营地' };
  var toolbar = document.createElement('section');
  toolbar.id='map-toolbar'; toolbar.className='map-toolbar'; toolbar.hidden=true; toolbar.setAttribute('aria-label','地图导览');
  toolbar.innerHTML='<div class="map-toolbar-top"><div><span class="map-eyebrow">连续大陆</span><strong id="map-location">城堡与村落</strong></div><div class="map-toolbar-actions"><button type="button" id="map-view">俯瞰视角</button><button type="button" id="map-extent">地图全貌</button><button type="button" id="map-exit">返回星球</button></div></div><nav class="map-regions" aria-label="跨区导航"></nav><p class="map-instructions">十片地域，自由探索 · 拖动平移 · 滚轮 / 双指缩放</p>';
  canvas.parentElement.appendChild(toolbar);
  Object.keys(regionNames).forEach(function(id){var b=document.createElement('button');b.type='button';b.dataset.region=id;b.textContent=regionNames[id];b.addEventListener('click',function(){if(planet)planet.enterRegion(id);});toolbar.querySelector('nav').appendChild(b);});
  byId('map-exit').addEventListener('click',function(){if(planet)planet.overview();});
  byId('map-extent').addEventListener('click',function(){if(planet)planet.mapOverview();});
  byId('map-view').addEventListener('click',function(){if(planet)planet.setMapView(planet.getMapView()==='immersive'?'overview':'immersive');});
  var preferredMapView='immersive';
  function mapViewChanged(value){preferredMapView=value;byId('map-view').textContent=value==='immersive'?'俯瞰视角':'沉浸视角';byId('map-view').setAttribute('aria-label','切换为'+(value==='immersive'?'俯瞰':'沉浸')+'视角');}
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var preferredQuality=new URLSearchParams(location.search).get('quality')||(new URLSearchParams(location.search).get('compat')==='1'?'smooth':'auto');
  var townUI=window.MarioTownUI?window.MarioTownUI.create({parent:canvas.parentElement,reducedMotion:reduce,onOpenPlace:function(id){if(planet)planet.openPlace(id);else townUI.open(id);},onClosePlace:function(){if(planet)planet.closePlace();else townUI.close();},onQuality:function(value){preferredQuality=value;if(planet)planet.setQuality(value);},onAnnounce:live}):null;
  var preferredEnvironment={timeOfDay:14,weather:'clear',animate:!reduce,cycle:false};
  var environmentUI=window.MarioEnvironmentUI?window.MarioEnvironmentUI.create({parent:canvas.parentElement,reducedMotion:reduce,onCoast:function(){if(planet)planet.openCoast();},onChange:function(value){Object.assign(preferredEnvironment,value);if(planet)planet.setEnvironment(value);},onAnnounce:live}):null;
  function environmentChanged(value){if(!value)return;['timeOfDay','weather','animate','cycle'].forEach(function(key){preferredEnvironment[key]=value[key];});if(environmentUI)environmentUI.setState(value);}
  function placeChanged(place,npcId){if(!townUI)return;if(place){townUI.open(place,npcId);updateHash('place-'+place.id);dismissHint();}else townUI.close();}

  function byId(id) { return document.getElementById(id); }
  function text(id, value) { var el = byId(id); if (el) el.textContent = value || ''; }
  function find(id) { return nodes.find(function (n) { return n.id === id; }); }
  function live(message) { text('live', message); }
  function dismissHint() {
    if (hintDismissed) return;
    hintDismissed = true;
    var hint = byId('globe-hint');
    if (hint) hint.hidden = true;
  }
  function show(node) {
    if(node&&townUI)townUI.close();
    selected = node ? node.id : null;
    detail.hidden = !node;
    document.querySelectorAll('[data-capability]').forEach(function (button) {
      var id=node?node.id:planet&&planet.getMapState().region;
      button.setAttribute('aria-pressed', String(button.dataset.capability === id));
    });
    var exploreMain = byId('explore-main');
    if (exploreMain) exploreMain.classList.toggle('has-selection', !!node);
    var exhibit = byId('hero-exhibit');
    if (exhibit) exhibit.classList.toggle('has-selection', !!node);
    if (node) {
      text('detail-title', node.name); text('detail-scene', node.lv); text('detail-lede', node.lede);
      text('detail-problem', node.problem); text('detail-process', node.process); text('detail-value', node.value);
      var contact = byId('detail-contact');
      contact.href = isExplore ? 'index.html?interest=' + encodeURIComponent(node.id) + '#contact' : '#contact';
      var explore = byId('detail-explore');
      if (explore) explore.href = 'planet.html#' + node.id;
      dismissHint();
      live('已打开' + node.name + '应用示意。');
    } else {
      live(planet && ['map','focus'].includes(planet.getMode()) ? '已关闭能力介绍，可继续探索地图。' : '已返回星球总览。');
    }
  }
  function updateHash(id) {
    if(!isExplore)return;
    var hash=id?'#'+id:'';
    if(location.hash!==hash){try{history.replaceState(null,'',location.pathname+location.search+hash);}catch(_) {}}
  }
  function regionChanged(region) {
    if(!region)return;
    text('map-location',regionNames[region.id] || region.name);
    toolbar.querySelectorAll('[data-region]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.region===region.id));});
    document.querySelectorAll('[data-capability]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.capability===region.id));});
    updateHash(region.id);live('已进入'+(regionNames[region.id]||region.name)+'，可拖动平移、缩放并跨区探索。');
  }
  function modeChanged(mode) {
    document.documentElement.dataset.worldMode=mode;if(townUI)townUI.setMode(mode);
    var isMap=mode==='map'||mode==='focus';
    toolbar.hidden=!isMap;
    canvas.parentElement.classList.toggle('is-map',isMap);
    var main=byId('explore-main');if(main){main.classList.toggle('is-map',isMap);main.classList.toggle('is-descending',mode==='descending');}
    var loading=byId('world-loading');loading.textContent=mode==='descending'?'正在进入连续地图…':'正在搭建星球…';loading.hidden=mode!=='descending';
    var hint=byId('globe-hint');if(hint)hint.hidden=isMap||hintDismissed;
    if(rotate)rotate.hidden=isMap;
    if(mode==='overview'){updateHash(null);canvas.setAttribute('aria-label','星球总览：拖动旋转，点击地域埋点进入连续地图');}
    if(isMap)canvas.setAttribute('aria-label','连续世界地图：拖动平移，滚轮或双指缩放，方向键移动，点击建筑查看能力');
    if(isMap&&openWorldWhenLanded){openWorldWhenLanded=false;requestAnimationFrame(function(){planet.mapOverview();});}
  }

  function choose(id) {
    var node = find(id);
    if (!node) return;
    if (planet) { planet.enterRegion(id); if(!isExplore)canvas.parentElement.scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'}); } else show(node);
  }
  function clear() { if (planet) planet.clear(); else show(null); }
  document.querySelectorAll('[data-capability]').forEach(function (button) {
    button.addEventListener('click', function () {
      choose(button.dataset.capability);
      if (button.hasAttribute('data-scroll-world') && canvas) {
        canvas.parentElement.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      }
    });
  });
  byId('detail-close').addEventListener('click', clear);
  var overview = byId('overview-button');
  if (overview) overview.addEventListener('click', function(){if(planet)planet.overview();else clear();});
  document.addEventListener('keydown', function (event) { if(event.key!=='Escape')return;if(townUI&&townUI.getActiveId()){if(planet)planet.closePlace();else townUI.close();return;}if(selected)clear();else if(planet&&planet.getMode()!=='overview')planet.overview(); });
  byId('detail-contact').addEventListener('click', function () {
    var form = byId('demo-form');
    if (form && selected) {
      var checkbox = form.querySelector('input[name="interest"][value="' + selected + '"]');
      if (checkbox) checkbox.checked = true;
      clear();
    }
  });
  var rotate = byId('rotate-button');
  if (rotate) rotate.addEventListener('click', function () {
    if (!planet) return;
    var on = !planet.isAutoRotating();
    planet.setAutoRotate(on);
    rotate.setAttribute('aria-pressed', String(on));
    rotate.textContent = on ? '暂停旋转' : '自动旋转';
  });
  var initializationAttempt=0,automaticRecoveries=0,recoveringView=null;
  function contextState(status,view){
    Object.assign(window.__marioWorldDiagnostics||{},{state:status==='lost'?'recovering':'ready'});
    if(townUI)townUI.setBusy(status==='lost');if(environmentUI)environmentUI.setBusy(status==='lost');
    if(status==='lost'){canvas.setAttribute('aria-busy','true');recoveringView=view;document.documentElement.dataset.webgl='recovering';byId('world-loading').textContent='3D 画面暂时中断，正在恢复…';byId('world-loading').hidden=false;toolbar.inert=true;detail.inert=true;live('3D 画面正在恢复，当前地图位置已保留。');reportStartup({state:'context-lost',kind:'webgl',code:'WEBGL_CONTEXT_LOST',message:'Rendering paused for context recovery.'});}
    else{canvas.setAttribute('aria-busy','false');recoveringView=null;document.documentElement.dataset.webgl='ready';byId('world-loading').hidden=true;toolbar.inert=false;detail.inert=false;live('3D 画面已恢复，可继续探索。');}
  }
  function rebuildWorld(view){
    if(planet){planet.destroy();planet=null;}window.__planet=null;
    var replacement=canvas.cloneNode(false);canvas.replaceWith(replacement);canvas=replacement;canvas.hidden=false;canvas.style.opacity='1';
    byId(isExplore?'pins':'hero-pins').replaceChildren();toolbar.inert=false;detail.inert=false;recoveringView=view||null;
    requestAnimationFrame(function(){requestAnimationFrame(function(){start(true,view);});});
  }
  function recoverContext(view){
    if(automaticRecoveries++<1){byId('world-loading').textContent='正在以较低负载恢复地图…';rebuildWorld(view);}
    else{var e=new Error('浏览器未能恢复图形上下文。请关闭其他 3D 页面后，点击重试继续。');e.code='WEBGL_CONTEXT_RECOVERY_FAILED';fallback(e);}
  }
  var fallbackPanel=byId('world-fallback');
  var failureDetails=document.createElement('details');failureDetails.className='world-failure-details';
  var failureSummary=document.createElement('summary');failureSummary.textContent='查看错误说明';
  var failureMessage=document.createElement('pre');failureMessage.id='world-failure-message';
  failureDetails.appendChild(failureSummary);failureDetails.appendChild(failureMessage);
  var retryButton=document.createElement('button');retryButton.type='button';retryButton.className='button';retryButton.id='world-retry';retryButton.textContent='以兼容模式重试';
  fallbackPanel.appendChild(retryButton);fallbackPanel.appendChild(failureDetails);
  retryButton.addEventListener('click',function(){automaticRecoveries=0;rebuildWorld(recoveringView);});
  function fallback(error) {
    if(planet){planet.destroy();planet=null;window.__planet=null;}
    if(townUI){townUI.setBusy(false);townUI.close();}if(environmentUI)environmentUI.setUnavailable(true);
    toolbar.inert=false;detail.inert=false;show(null);modeChanged('overview');
    byId('world-loading').hidden = true;fallbackPanel.hidden=false;canvas.hidden=true;byId('globe-hint').hidden=true;
    byId(isExplore?'pins':'hero-pins').hidden=true;
    if(rotate)rotate.disabled=true;
    toolbar.hidden=true;
    var kind=error.code==='WORLD_ASSET_MISSING'?'assets':(error.code==='WEBGL_CREATION_FAILED'||error.code==='WEBGL_CONTEXT_RECOVERY_FAILED')?'webgl':'scene';
    var title=kind==='assets'?'3D 资源未完整加载':kind==='webgl'?'浏览器未能创建 3D 画布':'3D 场景启动失败';
    var help=kind==='assets'?'请重新加载页面以获取完整资源。三个文字入口仍可阅读能力介绍。':kind==='webgl'?'可以先尝试兼容模式；如果仍失败，请检查浏览器的图形加速设置，或使用独立浏览器打开。':'场景初始化时发生错误。可以重试，或通过三个文字入口阅读能力介绍。';
    var disabledGraphics=kind==='webgl'&&/GL_VENDOR = Disabled|GL_RENDERER = Disabled/.test((window.__marioWorldDiagnostics||{}).creationMessage||'');
    if(disabledGraphics){title='浏览器的 3D 图形后端已禁用';help='请完整退出并重新打开'+(/Edg\//.test(navigator.userAgent)?' Edge':'浏览器')+'，让图形进程重新启动；如果仍失败，请检查图形加速设置，或使用 Chrome 打开。';}
    retryButton.hidden=disabledGraphics;
    fallbackPanel.querySelector('strong').textContent=title;fallbackPanel.querySelector('p').textContent=help;
    document.documentElement.dataset.webgl='unavailable';
    var diagnostic=window.__marioWorldDiagnostics||{};
    Object.assign(diagnostic,{state:'failed',kind:kind,name:error.name,code:error.code||'SCENE_INITIALIZATION_FAILED',message:error.message,attempt:initializationAttempt});
    window.__marioWorldDiagnostics=diagnostic;reportStartup(diagnostic);
    failureMessage.textContent=error.name+': '+error.message+(diagnostic.creationMessage?'\n'+diagnostic.creationMessage:'');
    live(title+'。'+help);console.warn('Mario World: 3D fallback.',diagnostic);
  }
  function start(compatibility,restoreSnapshot) {
    compatibility=compatibility===true||new URLSearchParams(location.search).get('compat')==='1';initializationAttempt++;
    fallbackPanel.hidden=true;canvas.hidden=false;
    byId(isExplore?'pins':'hero-pins').hidden=false;
    byId('world-loading').hidden=false;byId('world-loading').textContent='正在启动 3D 场景…';
    window.__marioWorldDiagnostics={state:'starting',profile:compatibility?'compatible':'standard',attempt:initializationAttempt};
    canvas.addEventListener('webglcontextcreationerror',function(event){window.__marioWorldDiagnostics.creationMessage=event.statusMessage||'WebGL context creation failed.';});
    try {
      var missing=['THREE','MarioWorldModels','MarioStoryWorld','MarioConnectedMap','MarioPlanet','MarioImportedModels','MarioWorldEnrichment','MarioDemoBusinesses','MarioTownUI','MarioRenderQuality','MarioVillageLife','MarioFrontierWorld','MarioMapWeather'].filter(function(name){return !window[name];});
      if(missing.length){var resourceError=new Error('缺少本地场景资源：'+missing.join(', '));resourceError.code='WORLD_ASSET_MISSING';throw resourceError;}
      planet = window.MarioPlanet.create(canvas, {
        compatibility:compatibility,quality:restoreSnapshot?'smooth':preferredQuality,environment:preferredEnvironment,onEnvironmentChange:environmentChanged,mapView:preferredMapView,onMapViewChange:mapViewChanged,nodes:nodes, pinHost: byId(isExplore ? 'pins' : 'hero-pins'),
        startDistance: isExplore ? 4.6 : 4.8, focusDistance: 3.25,
        initialPitch: .16, stars: false, orbits: false, autoRotate: false,
        maxPixelRatio: window.innerWidth <= 680 ? 1.25 : 1.6,
        minDistance: 2.8, maxDistance: 6.3, zoom: isExplore,
        pauseOffscreen: true, onSelect: show, onModeChange: modeChanged, onRegionChange: regionChanged, onContextState:contextState, onRecoverNeeded:recoverContext, onFatalError:fallback, onPlaceSelect:placeChanged, onQualityChange:function(value){preferredQuality=value;if(townUI)townUI.setQuality(value);}
      });
      window.__planet = planet;mapViewChanged(planet.getMapView());if(townUI)townUI.setQuality(planet.getQuality());if(environmentUI){environmentUI.setUnavailable(false);environmentUI.setBusy(false);environmentChanged(planet.getEnvironment());}
      byId('world-loading').hidden = true;
      document.documentElement.dataset.webgl = 'ready';
      if(rotate)rotate.disabled=false;
      Object.assign(window.__marioWorldDiagnostics,{state:'ready',three:THREE.REVISION,compatibility:planet.getRenderStatus().compatibility});
      reportStartup(window.__marioWorldDiagnostics);
      if(restoreSnapshot){planet.restoreView(restoreSnapshot);environmentChanged(planet.getEnvironment());recoveringView=null;}
    } catch (error) { fallback(error); }
    if (isExplore && planet && !restoreSnapshot) { var initial=location.hash.slice(1);if(initial.indexOf('place-')===0){planet.openPlace(initial.slice(6));}else if(initial==='world'){openWorldWhenLanded=true;planet.enterRegion('collaboration');}else if(regionNames[initial])planet.enterRegion(initial); }
  }
  if (canvas) {
    canvas.addEventListener('pointerdown', dismissHint, { once: true });
    requestAnimationFrame(function () { requestAnimationFrame(start); });
  }
  if (isExplore) window.addEventListener('hashchange', function () {
    var id=location.hash.slice(1);
    if(planet&&id.indexOf('place-')===0){planet.openPlace(id.slice(6));}else if(planet&&id==='world'){if(planet.getMode()==='overview'){openWorldWhenLanded=true;planet.enterRegion('collaboration');}else planet.mapOverview();}else if (planet && regionNames[id]) planet.enterRegion(id); else if(planet)planet.overview();
  });

  // Three illustrative stories share the same data as the 3D and text entrances.
  var exampleButtons = Array.from(document.querySelectorAll('[data-example]'));
  function example(id) {
    var node = find(id); if (!node) return;
    var titles = { collaboration: '一起完成一份客户提案', automation: '让审批后的工作继续向前', connection: '把分散的客户信息连接起来' };
    text('application-title', titles[id]); text('application-problem', node.problem);
    text('application-process', node.process); text('application-value', node.value);
    var panel = byId('application-panel'); if (panel) panel.setAttribute('aria-labelledby', 'tab-' + id);
    exampleButtons.forEach(function (b) { var active = b.dataset.example === id; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; });
  }
  exampleButtons.forEach(function (button, index) {
    button.addEventListener('click', function () { example(button.dataset.example); });
    button.addEventListener('keydown', function (event) {
      var next;
      if (event.key === 'ArrowRight') next = (index + 1) % exampleButtons.length;
      if (event.key === 'ArrowLeft') next = (index + exampleButtons.length - 1) % exampleButtons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = exampleButtons.length - 1;
      if (next !== undefined) { event.preventDefault(); example(exampleButtons[next].dataset.example); exampleButtons[next].focus(); }
    });
  });

  var form = byId('demo-form');
  if (form) {
    byId('demo-submit').disabled = false;
    var status = byId('form-status');
    ['contact-name','contact-method','contact-description'].forEach(function (id) {
      var input = byId(id);
      input.addEventListener('input', function () { input.setCustomValidity(''); status.hidden = true; });
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      ['contact-name','contact-method','contact-description'].forEach(function (id) {
        var input = byId(id);
        input.setCustomValidity(input.value.trim() ? '' : '请填写此项。');
      });
      if (!form.reportValidity()) return;
      status.textContent = '当前为演示，需求尚未发送';
      status.hidden = false;
      // Deliberately no fetch, beacon, localStorage, cookie or payload logging.
    });
    var interest = new URLSearchParams(location.search).get('interest');
    if (find(interest)) form.querySelector('input[name="interest"][value="' + interest + '"]').checked = true;
  }
})();
