/* Fictional town workbenches. All state lives in this page's memory. */
(function(root){
  'use strict';
  function create(options){
    var opts=options||{},host=opts.parent,manifest=root.MarioDemoBusinesses,active=null,generation=0,timer=0,lastResults=new Map(),completed=new Set();
    var shell=document.createElement('div');shell.className='town-interface';
    shell.innerHTML='<label class="world-quality">画面<select id="world-quality" aria-label="画面质量"><option value="auto">自动平衡</option><option value="detail">精细画面</option><option value="smooth">流畅优先</option></select></label><details class="town-directory" id="town-directory"><summary><span>小镇导览</span><small id="town-progress">六处体验</small></summary><nav aria-label="演示业务建筑" id="town-destinations"></nav></details><aside class="business-panel" id="business-panel" aria-labelledby="business-title" hidden><div class="business-heading"><span class="demo-tag">本地演示</span><button type="button" id="business-close" class="close-button" aria-label="关闭演示，继续探索">×</button></div><h2 id="business-title"></h2><p class="business-category" id="business-category"></p><div class="resident-speech"><span class="resident-avatar" aria-hidden="true">●</span><div><strong id="resident-name"></strong><p id="resident-greeting"></p></div></div><p id="business-summary"></p><ol class="business-steps" id="business-steps"></ol><div class="business-inputs" id="business-inputs"></div><button class="button business-run" type="button" id="business-run"></button><div class="business-result" id="business-result" role="status" aria-live="polite" hidden></div><button class="business-reset" type="button" id="business-reset">重置这次演示</button><p class="business-scope">虚构样例，仅在当前页面演示；不连接外部服务，也不发送或保存输入。</p></aside>';
    host.appendChild(shell);
    function el(id){return shell.querySelector('#'+id);}
    function node(tag,text,className){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
    var panel=el('business-panel'),inputs=el('business-inputs'),resultArea=el('business-result'),runButton=el('business-run'),directory=el('town-directory');
    manifest.items.forEach(function(item){var button=node('button');button.type='button';button.dataset.place=item.id;button.append(node('strong',item.title),node('span',item.npcName+' · '+item.categoryTitle));button.addEventListener('click',function(){directory.open=false;if(opts.onAnnounce)opts.onAnnounce('正在前往'+item.title+'。');requestAnimationFrame(function(){requestAnimationFrame(function(){if(opts.onOpenPlace)opts.onOpenPlace(item.id);});});});el('town-destinations').appendChild(button);});
    el('world-quality').addEventListener('change',function(){if(opts.onQuality)opts.onQuality(this.value);});
    el('business-close').addEventListener('click',function(){if(opts.onClosePlace)opts.onClosePlace();else close();});
    el('business-reset').addEventListener('click',function(){if(!active)return;lastResults.delete(active.id);open(active.id);});
    function table(rows,headers){var table=node('table');var thead=node('thead'),tr=node('tr');headers.forEach(function(h){tr.appendChild(node('th',h));});thead.appendChild(tr);table.appendChild(thead);var body=node('tbody');rows.forEach(function(row){var tr=node('tr');row.forEach(function(value){tr.appendChild(node('td',String(value)));});body.appendChild(tr);});table.appendChild(body);return table;}
    function steps(item,states){var list=el('business-steps');list.replaceChildren();item.steps.forEach(function(step,i){var li=node('li');li.dataset.status=states?states[i].status:'pending';li.append(node('span',String(i+1),'step-number'),node('span',step.title));list.appendChild(li);});}
    function label(text,control){var label=node('label',text);label.appendChild(control);inputs.appendChild(label);return control;}
    function select(id,choices){var control=node('select');control.id=id;choices.forEach(function(choice){var o=node('option',choice.label);o.value=choice.id;control.appendChild(o);});return control;}
    function controls(item){
      inputs.replaceChildren();
      if(item.id==='project-hall'){
        inputs.appendChild(node('p','示例项目：'+item.exampleData.project,'sample-caption'));
        item.exampleData.tasks.forEach(function(task,i){var row=node('label',undefined,'task-row'),box=node('input');box.type='checkbox';box.dataset.task=String(i);row.append(box,node('span',task.title+' · '+task.owner));inputs.appendChild(row);});
      }else if(item.id==='automation-post')label('申请资料',select('business-choice',item.action.choices));
      else if(item.id==='data-observatory'){
        inputs.append(node('strong','样表 A · 虚构客户'),table(item.exampleData.left.map(function(r){return[r.id,r.name];}),['编号','名称']),node('strong','样表 B · 虚构记录'),table(item.exampleData.right.map(function(r){return[r.customerId,r.status];}),['客户编号','状态']));
      }else if(item.id==='service-station')label('选择一条虚构咨询',select('business-choice',[{id:'data',label:'找不到昨日导入的样例记录'},{id:'access',label:'新同伴怎样加入示例项目'},{id:'process',label:'示例申请还缺什么资料'}]));
      else if(item.id==='knowledge-library'){
        var input=node('input');input.id='knowledge-query';input.type='search';input.placeholder='例如：角色、任务、来源';label('搜索内置示例短文',input);
        var docs=node('div',undefined,'sample-documents');docs.id='sample-documents';inputs.appendChild(docs);
        function filter(){var q=input.value.trim();docs.replaceChildren();item.exampleData.documents.filter(function(d){return !q||(d.title+d.excerpt).includes(q);}).forEach(function(d){var article=node('article');article.append(node('strong',d.title),node('p',d.excerpt));docs.appendChild(article);});if(!docs.childElementCount)docs.appendChild(node('p','没有匹配的示例片段，换个关键词试试。'));}
        input.addEventListener('input',filter);filter();
      }else if(item.id==='integration-garage'){
        inputs.appendChild(node('p','为虚构来源字段选择目标名称。','sample-caption'));
        item.exampleData.mapping.forEach(function(pair,i){var row=node('label',pair[0], 'mapping-row'),control=select('mapping-'+i,[{id:'',label:'选择目标字段'},{id:'id',label:'id · 编号'},{id:'name',label:'name · 名称'},{id:'status',label:'status · 状态'}]);row.appendChild(control);inputs.appendChild(row);});
      }
    }
    function line(label,value){var row=node('div',undefined,'result-row');row.append(node('strong',label),node('span',value));resultArea.appendChild(row);}
    function renderResult(item,result){
      resultArea.hidden=false;resultArea.replaceChildren();resultArea.dataset.status=result.status;resultArea.appendChild(node('h3',result.title));var output=result.output;
      if(item.id==='project-hall'){
        var done=inputs.querySelectorAll('[data-task]:checked').length;line('示例进度',done+' / 3 项已勾选');line('交付清单',output.deliverables.join('、'));
      }else if(item.id==='automation-post'){line('演示路线',output.route.join(' → '));resultArea.appendChild(node('p',output.message));}
      else if(item.id==='data-observatory'){resultArea.appendChild(table(output.matched.map(function(r){return[r.name,r.status,r.source];}),['示例名称','状态','来源']));output.unmatched.forEach(function(text){resultArea.appendChild(node('p',text,'unmatched-row'));});}
      else if(item.id==='service-station'){line('咨询分类',output.topic);line('示例负责角色',output.assignedTo);line('下一步',output.nextStep);}
      else if(item.id==='knowledge-library'){resultArea.appendChild(node('p',output.answer));var sources=node('ul',undefined,'source-citations');output.sources.forEach(function(text){sources.appendChild(node('li',text));});resultArea.appendChild(sources);}
      else if(item.id==='integration-garage'){if(result.status==='needs-example-input')resultArea.appendChild(node('p',output.message));else resultArea.appendChild(table([[output.id,output.name,output.status]],['编号','名称','状态']));}
      steps(item,result.steps);if(opts.onAnnounce)opts.onAnnounce(result.title);
    }
    function run(){
      if(!active)return;var item=active,token=++generation,choice=el('business-choice'),result=manifest.simulate(item.id,choice&&choice.value);
      if(item.id==='service-station'){
        var presets={data:['数据使用咨询','示例角色 · 数据向导','先确认日期范围，再查看样例导入记录'],access:['项目加入咨询','示例角色 · 协作向导','核对示例角色，再领取演示任务卡'],process:['申请资料咨询','示例角色 · 流程向导','核对用途和材料清单，再继续页面内演示']},p=presets[choice.value];result.output={topic:p[0],assignedTo:p[1],nextStep:p[2],ticketCreated:false};
      }
      if(item.id==='knowledge-library'){var q=el('knowledge-query').value.trim(),docs=item.exampleData.documents.filter(function(d){return !q||(d.title+d.excerpt).includes(q);});result.output={answer:docs.length?docs.map(function(d){return d.excerpt;}).join(' '):'没有找到匹配片段，请换个关键词再试。',sources:docs.map(function(d){return d.title+' · '+d.id;})};}
      if(item.id==='integration-garage'){var valid=item.exampleData.mapping.every(function(pair,i){return el('mapping-'+i).value===pair[1];});if(!valid){result.status='needs-example-input';result.title='示例映射尚未对齐';result.output={message:'请将 record_no 对应编号 id，display_name 对应名称 name，state_code 对应状态 status。'};result.steps[1].status='needs-input';result.steps[2].status='pending';}}
      runButton.disabled=true;runButton.textContent='正在运行页面内演示…';resultArea.hidden=true;
      el('business-steps').querySelectorAll('li').forEach(function(li,i){li.dataset.status=i===0?'running':'pending';});
      timer=setTimeout(function(){if(token!==generation||active!==item)return;runButton.disabled=false;runButton.textContent=item.action.label;lastResults.set(item.id,result);completed.add(item.id);el('town-progress').textContent='已体验 '+completed.size+' / 6';shell.querySelector('[data-place="'+item.id+'"]').classList.add('is-complete');renderResult(item,result);},opts.reducedMotion?0:700);
    }
    runButton.addEventListener('click',run);
    inputs.addEventListener('change',function(){if(active&&active.id==='project-hall'&&lastResults.has(active.id))renderResult(active,lastResults.get(active.id));});
    function open(value,npcId){var item=manifest.get(typeof value==='string'?value:value&&value.id);if(!item)return;
      generation++;clearTimeout(timer);active=item;panel.hidden=false;host.classList.add('has-business');panel.dataset.business=item.id;
      el('business-title').textContent=item.title;el('business-category').textContent=item.categoryTitle+' · '+(npcId?'与居民交流':'小镇体验');el('resident-name').textContent=((typeof value==='object'&&value.npcName)||item.npcName)+' · '+item.npcRole;el('resident-greeting').textContent=item.greeting;el('business-summary').textContent=item.summary;steps(item);controls(item);runButton.disabled=false;runButton.textContent=item.action.label;resultArea.hidden=true;
      if(lastResults.has(item.id))renderResult(item,lastResults.get(item.id));
      if(opts.onAnnounce)opts.onAnnounce('已打开'+item.title+'，这是本地演示。');
    }
    function close(){generation++;clearTimeout(timer);active=null;panel.hidden=true;host.classList.remove('has-business');}
    return{open:open,close:close,getActiveId:function(){return active&&active.id;},setQuality:function(value){el('world-quality').value=value;},setBusy:function(on){panel.inert=!!on;directory.inert=!!on;},setMode:function(mode){shell.dataset.mode=mode;},element:shell};
  }
  root.MarioTownUI={create:create};
})(window);
