/* Fictional, local-only experiences. This module never sends or persists data. */
(function (root) {
  'use strict';
  var disclaimer = '以下为虚构示例与本地交互演示，不代表已上线服务；不会发送请求或保存数据。';
  var items = [
    {
      id:'project-hall',title:'项目协作馆',category:'collaboration',categoryTitle:'智能协作',region:'collaboration',
      summary:'把一份示例提案拆成可共同推进的任务，观察角色如何接棒。',npcName:'栗栗',npcRole:'提案协调员',
      greeting:'欢迎来到协作馆。一起把「月光集市提案」分成三步吧。',
      steps:[{title:'读懂目标',detail:'从虚构需求中提取提案主题、交付物和待确认问题。'},{title:'分配角色',detail:'把资料、初稿和复核分别交给示例角色。'},{title:'汇总进度',detail:'将完成项和待确认项汇成一张任务卡。'}],
      exampleData:{project:'月光集市提案',roles:['资料员小栗','编辑小芽','复核员阿桃'],tasks:[{title:'整理背景',owner:'资料员小栗'},{title:'形成初稿',owner:'编辑小芽'},{title:'复核交付',owner:'复核员阿桃'}]},
      action:{id:'assemble-plan',type:'local-simulation',label:'生成演示任务卡',durationMs:900,resultTitle:'示例协作计划已就绪'},
      exampleOutput:{title:'月光集市提案 · 演示任务卡',status:'待示例角色协作',deliverables:['背景资料清单','提案初稿','复核问题清单']}
    },
    {
      id:'automation-post',title:'自动化邮局',category:'automation',categoryTitle:'业务自动化',region:'automation',
      summary:'让一张虚构申请依次经过校验、分流和通知，体验规则串联。',npcName:'豆豆',npcRole:'流程邮差',
      greeting:'这里的邮包装着示例流程。选好路线，就能看到每一步怎样接上。',
      steps:[{title:'检查资料',detail:'核对演示申请的必填项；示例缺项会停在补充资料节点。'},{title:'按规则分流',detail:'根据示例类型将申请送到对应处理队列。'},{title:'展示结果',detail:'仅在页面生成完成回执，不向任何人发送消息。'}],
      exampleData:{request:'春日展台物料申请',type:'标准申请',fields:{申请人:'示例用户小芽',用途:'虚构集市布展',材料:'彩旗与纸板'},routes:['标准申请','需要补充资料']},
      action:{id:'run-route',type:'local-simulation',label:'运行演示流程',durationMs:1100,resultTitle:'本地演示流程已走完',choices:[{id:'standard',label:'资料齐全'},{id:'missing',label:'试试缺少资料'}]},
      exampleOutput:{request:'春日展台物料申请',route:['资料校验','标准队列','页面回执'],message:'这是页面内的示例回执，没有发出通知。'}
    },
    {
      id:'data-observatory',title:'数据观测台',category:'connection',categoryTitle:'数据连接',region:'connection',
      summary:'把两份虚构表格按示例编号对齐，看到字段如何连接。',npcName:'澄澄',npcRole:'数据观测员',
      greeting:'望远镜发现了两张示例表！我们用同一个编号把它们对齐。',
      steps:[{title:'选择样表',detail:'读取模块内置的虚构客户表和服务记录表。'},{title:'对齐字段',detail:'按客户编号匹配记录，并明确展示无法匹配的一项。'},{title:'查看合并结果',detail:'生成本地示例视图，保留来源信息。'}],
      exampleData:{left:[{id:'DEMO-01',name:'青苔小店'},{id:'DEMO-02',name:'纸风车工坊'}],right:[{customerId:'DEMO-01',status:'示例待跟进'},{customerId:'DEMO-03',status:'示例未匹配'}],key:'id ↔ customerId'},
      action:{id:'join-samples',type:'local-simulation',label:'连接两张示例表',durationMs:900,resultTitle:'示例数据视图已生成'},
      exampleOutput:{matched:[{id:'DEMO-01',name:'青苔小店',status:'示例待跟进',source:'样表 A + 样表 B'}],unmatched:['DEMO-02：没有服务记录','DEMO-03：没有对应客户']}
    },
    {
      id:'service-station',title:'客户服务站',category:'automation',categoryTitle:'业务自动化',region:'desert',
      summary:'将虚构咨询分类、整理上下文，再展示转交给示例角色的过程。',npcName:'阿杏',npcRole:'咨询引导员',
      greeting:'旅途中有疑问吗？用一条虚构咨询试试分类与转交。',
      steps:[{title:'识别咨询',detail:'从内置样例中识别咨询主题和相关背景。'},{title:'整理上下文',detail:'将问题、已知条件和缺少的信息放在同一张演示卡里。'},{title:'演示转交',detail:'展示负责角色与下一步，不创建真实工单。'}],
      exampleData:{question:'示例连接器昨天导入的记录，今天在哪里查看？',topic:'数据使用咨询',known:['连接器名称：纸风车样例源','记录编号：DEMO-07'],missing:['希望查看的日期范围']},
      action:{id:'route-question',type:'local-simulation',label:'整理示例咨询',durationMs:950,resultTitle:'示例咨询卡已整理'},
      exampleOutput:{topic:'数据使用咨询',assignedTo:'示例角色 · 数据向导',nextStep:'先确认日期范围，再查看样例导入记录',ticketCreated:false}
    },
    {
      id:'knowledge-library',title:'知识图书馆',category:'collaboration',categoryTitle:'智能协作',region:'snow',
      summary:'从三篇内置短文中找到相关片段，组成带来源的示例答复。',npcName:'绵绵',npcRole:'图书管理员',
      greeting:'雪山图书馆只收示例故事。每个答案都会告诉你引用了哪一页。',
      steps:[{title:'提出样例问题',detail:'使用内置问题「新同伴如何加入示例项目」。'},{title:'查找片段',detail:'从三篇虚构短文中选择有关角色、资料和复核的内容。'},{title:'附上来源',detail:'把示例答复与短文标题一起呈现，方便核对。'}],
      exampleData:{question:'新同伴如何加入示例项目？',documents:[{id:'SAMPLE-1',title:'示例项目入门',excerpt:'先确认共同目标，再查看任务卡。'},{id:'SAMPLE-2',title:'示例角色手册',excerpt:'每项任务标注负责人和复核角色。'},{id:'SAMPLE-3',title:'示例交付清单',excerpt:'交付前检查资料来源与待确认问题。'}]},
      action:{id:'find-sources',type:'local-simulation',label:'查找示例资料',durationMs:1000,resultTitle:'带来源的示例答复已生成'},
      exampleOutput:{answer:'先阅读共同目标，再领取标注负责人和复核角色的示例任务；交付前核对来源与待确认问题。',sources:['示例项目入门 · SAMPLE-1','示例角色手册 · SAMPLE-2','示例交付清单 · SAMPLE-3']}
    },
    {
      id:'integration-garage',title:'集成维修铺',category:'connection',categoryTitle:'数据连接',region:'lava',
      summary:'检查一组虚构字段映射，让示例接口两侧使用相同的词汇。',npcName:'阿栓',npcRole:'连接维修员',
      greeting:'别怕熔岩，维修铺里只有示例数据。一起检查这条连接的字段吧。',
      steps:[{title:'检查字段',detail:'列出虚构来源与目标使用的字段名称。'},{title:'修正映射',detail:'将 record_no 映射到 id，将 display_name 映射到 name。'},{title:'预览样例',detail:'仅转换模块内置对象，不连接外部接口。'}],
      exampleData:{source:{record_no:'DEMO-42',display_name:'纸风车样例',state_code:'ready'},mapping:[['record_no','id'],['display_name','name'],['state_code','status']]},
      action:{id:'repair-mapping',type:'local-simulation',label:'检查示例字段映射',durationMs:850,resultTitle:'示例字段映射已通过'},
      exampleOutput:{id:'DEMO-42',name:'纸风车样例',status:'ready',externalConnection:false}
    }
  ];
  items.forEach(function(item){item.demoOnly=true;item.disclaimer=disclaimer;item.action.network=false;item.action.persistent=false;});
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function get(id){return items.find(function(item){return item.id===id;})||null;}
  function simulate(id,choice){
    var item=get(id);if(!item)return null;
    var result={businessId:id,demoOnly:true,status:'complete',title:item.action.resultTitle,steps:item.steps.map(function(step){return{title:step.title,detail:step.detail,status:'done'};}),output:clone(item.exampleOutput),message:disclaimer};
    if(id==='automation-post'&&choice==='missing'){result.status='needs-example-input';result.title='示例流程停在资料补充节点';result.steps[0].status='needs-input';result.steps.slice(1).forEach(function(step){step.status='pending';});result.output={request:'春日展台物料申请',route:['资料校验','等待补充示例用途'],message:'演示暂停在缺项检查，没有创建或发送申请。'};}
    return result;
  }
  root.MarioDemoBusinesses={items:items,disclaimer:disclaimer,get:get,byCategory:function(id){return items.filter(function(item){return item.category===id;});},simulate:simulate,run:simulate};
})(window);
