/* Local scene controls. Weather is simulated; no location, network or storage. */
(function(root){
  'use strict';
  function create(options){
    var opts=options||{},state={timeOfDay:14,weather:'clear',animate:!opts.reducedMotion,cycle:false},names={clear:'晴朗',cloudy:'多云',rain:'雨天',snow:'飘雪'};
    var panel=document.createElement('details');panel.id='environment-controls';panel.className='world-environment-controls';
    panel.innerHTML='<summary><span>光照与天气</span><small id="environment-summary">晴朗</small></summary><fieldset><legend class="sr-only">场景环境</legend><div class="environment-time"><label for="environment-time">时间</label><output id="environment-clock" for="environment-time">14:00</output></div><input id="environment-time" type="range" min="0" max="23.75" step="0.25" value="14" aria-label="场景时间"><label class="environment-weather" for="environment-weather">天气<select id="environment-weather"><option value="clear">晴朗</option><option value="cloudy">多云</option><option value="rain">雨天</option><option value="snow">飘雪</option></select></label><label class="environment-check"><input id="environment-animate" type="checkbox" checked><span>动态海面与天气</span></label><label class="environment-check"><input id="environment-cycle" type="checkbox"><span>时间自动推进</span></label><button type="button" class="environment-coast" id="environment-coast">前往海岸</button><p class="environment-note" id="environment-note">本地模拟，可随时切换。</p></fieldset>';
    opts.parent.appendChild(panel);
    function el(id){return panel.querySelector('#'+id);}
    function clock(hour){var minutes=Math.round((((hour%24)+24)%24)*60)%1440;return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');}
    function setState(value){
      if(value)Object.assign(state,value);
      el('environment-time').value=state.timeOfDay;el('environment-clock').value=clock(state.timeOfDay);el('environment-time').setAttribute('aria-valuetext',clock(state.timeOfDay));
      el('environment-weather').value=state.weather;el('environment-summary').textContent=names[state.weather]||'晴朗';el('environment-animate').checked=state.animate;el('environment-cycle').checked=state.cycle;
      el('environment-animate').disabled=!!opts.reducedMotion;el('environment-cycle').disabled=!!opts.reducedMotion||!state.animate;
      el('environment-note').textContent=opts.reducedMotion?'已跟随减少动态设置，保留静态光照与天气。':state.animate&&state.quality==='smooth'?'流畅模式保留静态环境。':'本地模拟，可随时切换。';
    }
    function change(patch){Object.assign(state,patch);if(opts.onChange)opts.onChange(patch);setState();}
    el('environment-time').addEventListener('input',function(){change({timeOfDay:Number(this.value)});});
    el('environment-time').addEventListener('change',function(){if(opts.onAnnounce)opts.onAnnounce('场景时间 '+clock(state.timeOfDay)+'。');});
    el('environment-weather').addEventListener('change',function(){change({weather:this.value});if(opts.onAnnounce)opts.onAnnounce('天气已切换为'+names[state.weather]+'。');});
    el('environment-animate').addEventListener('change',function(){change({animate:this.checked,cycle:this.checked&&state.cycle});});
    el('environment-cycle').addEventListener('change',function(){change({cycle:this.checked});});
    el('environment-coast').addEventListener('click',function(){panel.open=false;if(opts.onCoast)opts.onCoast();});
    panel.addEventListener('keydown',function(e){if(e.key==='Escape'&&panel.open){e.preventDefault();e.stopPropagation();panel.open=false;panel.querySelector('summary').focus();}});
    function outside(e){if(panel.open&&!panel.contains(e.target))panel.open=false;}
    document.addEventListener('pointerdown',outside);
    setState();
    return{setState:setState,setBusy:function(value){panel.querySelector('fieldset').disabled=value;if(value)panel.open=false;},setUnavailable:function(value){panel.hidden=!!value;},destroy:function(){document.removeEventListener('pointerdown',outside);panel.remove();}};
  }
  root.MarioEnvironmentUI={create:create};
})(window);
