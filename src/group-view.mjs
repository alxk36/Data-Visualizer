/** The nearest outer quarter selects an edge; the middle keeps the current group. */
export function getGroupDropDirection(rect,x,y){
  if(!rect||![rect.left,rect.top,rect.width,rect.height,x,y].every(Number.isFinite)||rect.width<=0||rect.height<=0)return null;
  const horizontal=(x-rect.left)/rect.width,vertical=(y-rect.top)/rect.height;
  if(horizontal<0||horizontal>1||vertical<0||vertical>1)return null;
  const edges=[['left',horizontal],['right',1-horizontal],['up',vertical],['down',1-vertical]];
  const [direction,distance]=edges.reduce((nearest,edge)=>edge[1]<nearest[1]?edge:nearest);
  return distance<.25?direction:null;
}

/** Keyed renderer for the independently split text and visualizer groups. */
export function createGroupView({hosts,getRoot,getActiveGroup,getDocument,icon,escape,onActivate,onEdit,onClose,onContext,onDrop,onResize,onCursor,onEditorFocus}) {
  const groups = new Map();
  const branches = new Map();
  let fontSize = 14;
  let wrap = false;
  let internalDrag = null;
  let renderQueued = false;
  const htmlEscape = escape || (value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character])));
  const renderIcon = name => typeof icon === 'function' ? icon(name) : '';
  const pinIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v7"/></svg>';
  const invoke = (callback, payload) => {
    if (typeof callback !== 'function') return;
    try {
      const result = callback(payload);
      if (result?.catch) result.catch(error => console.error('Workspace action failed:', error));
      return result;
    } catch (error) { console.error('Workspace action failed:', error); }
  };
  const element = (tag, className) => { const node=document.createElement(tag); if(className)node.className=className; return node; };
  const acceptsDrop=event=>Boolean(internalDrag)||[...(event.dataTransfer?.types||[])].some(type=>type==='application/x-dv-tab'||type==='Files');
  function dropDirection(group,event){
    if(event.target.closest('.group-tab-bar')||!group.node.tabs?.length)return null;
    if(internalDrag?.pane===group.pane&&internalDrag.groupId===group.id&&group.node.tabs.length===1&&!event.ctrlKey&&!event.metaKey)return null;
    return getGroupDropDirection(group.body.getBoundingClientRect(),event.clientX,event.clientY);
  }
  function clearGroupDrop(group){group.preview?.classList.add('hidden');group.section.classList.remove('group-drop-active');group.tabs.querySelectorAll('.drop-target').forEach(tab=>tab.classList.remove('drop-target'));}
  function showDropPreview(group,event){
    for(const other of groups.values())if(other!==group)clearGroupDrop(other);
    clearGroupDrop(group);
    if(event.target.closest('.group-tab-bar')){event.target.closest('.tab[data-group-id]')?.classList.add('drop-target');return;}
    if(!group.preview){group.preview=element('div','group-drop-preview hidden');group.preview.setAttribute('aria-hidden','true');group.preview.append(element('span','group-drop-label'));}
    if(group.preview.parentNode!==group.body)group.body.append(group.preview);
    const direction=dropDirection(group,event);
    group.preview.dataset.direction=direction||'center';
    group.preview.firstChild.textContent=direction?`Split ${{left:'left',right:'right',up:'above',down:'below'}[direction]}`:internalDrag?(event.ctrlKey||event.metaKey?'Copy view here':'Move here'):'Open here';
    group.preview.classList.remove('hidden');
  }
  const replaceOnlyIfNeeded = (parent, children) => {
    if (parent.childNodes.length === children.length && children.every((child,index)=>parent.childNodes[index]===child)) return;
    for(let index=0;index<children.length;index++) if(parent.childNodes[index]!==children[index])parent.insertBefore(children[index],parent.childNodes[index]||null);
    while(parent.childNodes.length>children.length)parent.lastChild.remove();
  };

  function rememberEditor(record) {
    if (!record?.editor) return;
    record.position={start:record.editor.selectionStart,end:record.editor.selectionEnd,top:record.editor.scrollTop,left:record.editor.scrollLeft};
  }
  function restoreEditor(record) {
    if(!record.position)return;
    const {start,end,top,left}=record.position;
    record.editor.setSelectionRange(Math.min(start,record.editor.value.length),Math.min(end,record.editor.value.length));
    record.editor.scrollTop=top;
    record.editor.scrollLeft=left;
  }
  function scheduleGutter(record) {
    if(record.gutterQueued)return;
    record.gutterQueued=true;
    requestAnimationFrame(()=>{record.gutterQueued=false;drawGutter(record);});
  }
  function drawGutter(record) {
    if(!record || record.surface.classList.contains('hidden') || !record.editor.clientHeight)return;
    const {editor,gutter}=record;
    if(record.lineContent!==editor.value){record.lineContent=editor.value;record.lines=editor.value.split('\n');record.wrapKey=null;}
    const lines=record.lines||[''];
    const line=editor.value.slice(0,editor.selectionStart).split('\n').length;
    const leading=23;
    if(!wrap){
      const first=Math.max(0,Math.floor(editor.scrollTop/leading)-3);
      const last=Math.min(lines.length,first+Math.ceil(editor.clientHeight/leading)+8);
      gutter.innerHTML=`<div style="height:${first*leading}px"></div>`+Array.from({length:Math.max(0,last-first)},(_,index)=>{const number=first+index+1;return `<div data-line="${number}"${number===line?' class="current"':''}>${number}</div>`;}).join('')+`<div style="height:${Math.max(36,(lines.length-last)*leading+36)}px"></div>`;
    }else{
      const width=Math.max(20,editor.clientWidth-22);
      const key=`${width}:${fontSize}`;
      if(record.wrapKey!==key){
        const mirror=element('div','group-line-measure');
        mirror.style.cssText=`position:fixed;visibility:hidden;pointer-events:none;left:-100000px;top:0;width:${width}px;font:${fontSize}px/23px Consolas,"Cascadia Code",monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;tab-size:2;`;
        const fragment=document.createDocumentFragment();
        const nodes=lines.map(text=>{const node=element('div');node.textContent=text||'\u200b';fragment.append(node);return node;});
        mirror.append(fragment);document.body.append(mirror);
        record.lineHeights=nodes.map(node=>Math.max(leading,node.getBoundingClientRect().height));
        mirror.remove();record.wrapKey=key;
      }
      const heights=record.lineHeights;
      let top=0,first=0;
      while(first<heights.length && top+heights[first]<editor.scrollTop-leading*3){top+=heights[first];first++;}
      let last=first,visibleHeight=0;
      while(last<heights.length && visibleHeight<editor.clientHeight+leading*8){visibleHeight+=heights[last];last++;}
      const tail=heights.slice(last).reduce((sum,height)=>sum+height,0)+36;
      gutter.innerHTML=`<div style="height:${top}px"></div>`+Array.from({length:last-first},(_,index)=>{const number=first+index+1;return `<div data-line="${number}" style="height:${heights[number-1]}px"${number===line?' class="current"':''}>${number}</div>`;}).join('')+`<div style="height:${tail}px"></div>`;
    }
    gutter.scrollTop=editor.scrollTop;
  }
  function editIndent(record,outdent){
    const editor=record.editor,start=editor.selectionStart,end=editor.selectionEnd;
    if(start===end&&!outdent){document.execCommand('insertText',false,'  ');return;}
    const startOfLine=editor.value.lastIndexOf('\n',start-1)+1;
    const selected=editor.value.slice(startOfLine,end);
    const replacement=selected.split('\n').map(line=>outdent?line.replace(/^( {1,2}|\t)/,''):`  ${line}`).join('\n');
    editor.setSelectionRange(startOfLine,end);
    document.execCommand('insertText',false,replacement);
    editor.setSelectionRange(startOfLine,startOfLine+replacement.length);
    scheduleGutter(record);invoke(onCursor,editor);
  }
  function makeEditor(group,docId){
    const surface=element('div','editor-surface group-editor-surface');
    surface.dataset.groupSurface=group.id;
    const gutter=element('div','line-gutter group-line-gutter');gutter.setAttribute('aria-hidden','true');
    const editor=element('textarea');
    editor.dataset.groupEditor=group.id;editor.dataset.docId=docId;
    editor.setAttribute('aria-label','Raw text editor');editor.spellcheck=false;
    editor.setAttribute('autocomplete','off');editor.setAttribute('autocapitalize','off');
    surface.append(gutter,editor);
    const record={surface,gutter,editor,docId,groupId:group.id,lineContent:null,lines:[''],wrapKey:null,position:null,gutterQueued:false};
    editor.addEventListener('input',event=>{
      event.stopPropagation();rememberEditor(record);record.wrapKey=null;scheduleGutter(record);
      invoke(onEdit,{groupId:group.id,docId,content:editor.value,editor});
      invoke(onCursor,editor);
    });
    editor.addEventListener('focus',()=>{invoke(onEditorFocus,{groupId:group.id,docId,editor});render();scheduleGutter(record);invoke(onCursor,editor);});
    editor.addEventListener('scroll',()=>{rememberEditor(record);scheduleGutter(record);});
    for(const name of ['click','keyup','select'])editor.addEventListener(name,()=>{rememberEditor(record);scheduleGutter(record);invoke(onCursor,editor);});
    editor.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();event.stopPropagation();editIndent(record,event.shiftKey);}});
    return record;
  }
  function makeGroup(node,pane){
    const section=element('section','editor-group');
    section.dataset.groupId=node.id;section.dataset.pane=pane;section.setAttribute('aria-label',`${pane==='text'?'Text':'Visualizer'} group`);
    const tabs=element('div','tab-bar group-tab-bar');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',pane==='text'?'Text files':'Visualizer files');tabs.dataset.groupId=node.id;tabs.dataset.pane=pane;
    const body=element('div','group-content');
    const empty=element('div','pane-empty group-empty');empty.innerHTML=`<span class="empty-symbol">${pane==='text'?'{ }':'DV'}</span><p>${pane==='text'?'Open a file to start editing':'Drop a tab here'}</p>`;
    if(pane==='text'){const open=element('button','quiet-button');open.dataset.action='open';open.innerHTML='Open file <span>Ctrl O</span>';empty.append(open);}
    section.append(tabs,body);
    const group={id:node.id,pane,section,tabs,body,empty,editors:new Map(),tabNodes:new Map(),activeId:null,node,observer:null,canvas:null};
    if(pane==='visualizer'){const canvas=element('div','visualizer-canvas group-visualizer-canvas');canvas.innerHTML='<div class="watermark" aria-label="Empty visualization canvas">D<span>V</span></div>';group.canvas=canvas;}
    group.observer=new ResizeObserver(()=>{const record=group.editors.get(group.activeId);if(record)scheduleGutter(record);});group.observer.observe(body);
    tabs.addEventListener('click',event=>{
      const close=event.target.closest('[data-close-tab]');
      const tab=event.target.closest('.tab[data-group-id]');
      if(!tab)return;
      event.stopPropagation();
      const payload={pane:group.pane,groupId:group.id,docId:tab.dataset.id};
      if(close)invoke(onClose,payload);else invoke(onActivate,payload);
    });
    tabs.addEventListener('contextmenu',event=>{
      const tab=event.target.closest('.tab[data-group-id]');if(!tab)return;
      event.preventDefault();event.stopPropagation();
      invoke(onContext,{pane:group.pane,groupId:group.id,docId:tab.dataset.id,x:event.clientX,y:event.clientY});
    });
    tabs.addEventListener('keydown',event=>{
      const tab=event.target.closest('.tab[data-group-id]');if(!tab)return;
      if(['Enter',' '].includes(event.key)&&event.target===tab){event.preventDefault();event.stopPropagation();invoke(onActivate,{pane:group.pane,groupId:group.id,docId:tab.dataset.id});}
      if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();const items=[...group.tabs.querySelectorAll('.tab')];const index=items.indexOf(tab);const next=items[(index+(event.key==='ArrowRight'?1:-1)+items.length)%items.length];if(next){invoke(onActivate,{pane:group.pane,groupId:group.id,docId:next.dataset.id});next.focus();}}
      if((event.shiftKey&&event.key==='F10')||event.key==='ContextMenu'){event.preventDefault();event.stopPropagation();const rect=tab.getBoundingClientRect();invoke(onContext,{pane:group.pane,groupId:group.id,docId:tab.dataset.id,x:rect.left+8,y:rect.bottom});}
    });
    tabs.addEventListener('dragstart',event=>{
      const tab=event.target.closest('.tab[data-group-id]');if(!tab||!event.dataTransfer)return;
      event.stopPropagation();internalDrag={id:tab.dataset.id,pane:group.pane,groupId:group.id};
      event.dataTransfer.setData('application/x-dv-tab',JSON.stringify(internalDrag));event.dataTransfer.effectAllowed='copyMove';tab.classList.add('dragging');
    });
    tabs.addEventListener('dragend',event=>{event.stopPropagation();internalDrag=null;clearDragStyles();});
    section.addEventListener('dragover',event=>{
      if(!acceptsDrop(event))return;
      event.preventDefault();event.stopPropagation();showDropPreview(group,event);
      if(event.dataTransfer)event.dataTransfer.dropEffect=internalDrag&&!event.ctrlKey&&!event.metaKey?'move':'copy';
    });
    section.addEventListener('dragleave',event=>{if(!section.contains(event.relatedTarget))clearGroupDrop(group);});
    section.addEventListener('drop',event=>{
      if(!acceptsDrop(event))return;
      event.preventDefault();event.stopPropagation();
      let data=internalDrag;
      try{const serialized=event.dataTransfer?.getData('application/x-dv-tab');if(serialized)data=JSON.parse(serialized);}catch{data=null;}
      const payload={pane:group.pane,groupId:group.id,targetId:event.target.closest('.tab[data-group-id]')?.dataset.id,data,files:[...(event.dataTransfer?.files||[])],direction:dropDirection(group,event),copy:Boolean(event.ctrlKey||event.metaKey)};
      internalDrag=null;clearDragStyles();invoke(onDrop,payload);
    });
    body.addEventListener('pointerdown',event=>{if(event.target.closest('textarea,button,input'))return;invoke(onActivate,{pane:group.pane,groupId:group.id,docId:group.activeId});});
    return group;
  }
  function clearDragStyles(){for(const group of groups.values()){clearGroupDrop(group);group.tabs.querySelectorAll('.dragging').forEach(tab=>tab.classList.remove('dragging'));}}
  document.addEventListener('dragend',()=>{internalDrag=null;clearDragStyles();});
  document.addEventListener('drop',()=>{internalDrag=null;clearDragStyles();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){internalDrag=null;clearDragStyles();}});
  window.addEventListener('blur',()=>{internalDrag=null;clearDragStyles();});
  function tabId(value){return typeof value==='string'?value:value?.id||value?.docId;}
  function isPinned(node,id){return Array.isArray(node.pinned)?node.pinned.includes(id):node.pinned instanceof Set?node.pinned.has(id):Boolean(node.pinned?.[id]);}
  function updateGroup(node,pane,activeGroupId){
    let group=groups.get(node.id);
    if(!group){group=makeGroup(node,pane);groups.set(node.id,group);}
    group.node=node;group.pane=pane;group.section.dataset.pane=pane;group.tabs.dataset.pane=pane;
    group.section.classList.toggle('active-group',node.id===activeGroupId);
    const ids=(node.tabs||[]).map(tabId).filter(id=>id&&getDocument(id));
    const currentId=ids.includes(node.activeId)?node.activeId:ids[0]||null;
    const current=getDocument(currentId);
    const renderedTabs=[];
    for(const id of ids){
      const doc=getDocument(id),pinned=isPinned(node,id);
      let tab=group.tabNodes.get(id);
      if(!tab){tab=element('div','tab');tab.dataset.id=id;tab.dataset.groupId=node.id;tab.setAttribute('role','tab');tab.draggable=true;group.tabNodes.set(id,tab);}
      tab.dataset.pane=pane;tab.classList.toggle('active',id===currentId);tab.classList.toggle('pinned',pinned);tab.setAttribute('aria-selected',String(id===currentId));tab.tabIndex=id===currentId?0:-1;tab.title=`${doc.path||doc.name}${pinned?' · Pinned':''}`;
      const content=`${renderIcon(pane==='text'?'file':'chart')}<span class="tab-name">${htmlEscape(doc.name)}</span>${pinned?`<span class="tab-pin" aria-label="Pinned" title="Pinned">${pinIcon}</span>`:''}<button class="tab-close" data-close-tab="${htmlEscape(id)}" data-pane="${pane}" data-group-id="${htmlEscape(node.id)}" aria-label="Close ${htmlEscape(doc.name)} tab" title="Close tab">${doc.dirty?'•':'×'}</button>`;
      if(tab.innerHTML!==content)tab.innerHTML=content;
      renderedTabs.push(tab);
    }
    replaceOnlyIfNeeded(group.tabs,renderedTabs);
    for(const [id,tab] of group.tabNodes)if(!ids.includes(id)){tab.remove();group.tabNodes.delete(id);}
    const old=group.editors.get(group.activeId);
    const switched=group.activeId!==currentId;
    if(switched)rememberEditor(old);
    group.activeId=currentId;
    if(pane==='text'){
      for(const id of ids){
        const doc=getDocument(id);
        let record=group.editors.get(id);
        if(!record){record=makeEditor(group,id);group.editors.set(id,record);group.body.append(record.surface);}
        if(record.editor.value!==doc.content){rememberEditor(record);record.editor.value=doc.content;record.lineContent=null;record.wrapKey=null;restoreEditor(record);}
        record.editor.classList.toggle('wrap',wrap);record.editor.wrap=wrap?'soft':'off';record.editor.style.fontSize=`${fontSize}px`;
        record.surface.style.setProperty('--editor-size',`${fontSize}px`);record.surface.classList.toggle('hidden',id!==currentId);
        if(id===currentId){if(switched)restoreEditor(record);scheduleGutter(record);}
      }
      for(const [id,record] of group.editors)if(!ids.includes(id)){record.surface.remove();group.editors.delete(id);}
      if(!current){if(group.empty.parentNode!==group.body)group.body.append(group.empty);group.empty.classList.remove('hidden');}else group.empty.remove();
    }else{
      replaceOnlyIfNeeded(group.body,[current?group.canvas:group.empty]);
    }
    return group.section;
  }
  function branchChildren(node){return node.children||[node.first,node.second];}
  function branchDirection(node){return node.direction||node.axis||node.orientation||'horizontal';}
  function horizontal(node){return ['horizontal','row','x'].includes(branchDirection(node));}
  function makeBranch(node,pane){
    const section=element('div','group-split');section.dataset.splitId=node.id;
    const first=element('div','group-split-child'),second=element('div','group-split-child');
    const handle=element('div','group-resize-handle');handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-label','Resize editor groups');handle.dataset.splitId=node.id;
    section.append(first,handle,second);
    const record={section,first,second,handle,node,pane};
    const update=(ratio,notify=true)=>{const bounded=Math.max(.12,Math.min(.88,ratio));record.first.style.flex=`0 0 calc(${bounded*100}% - 2.5px)`;record.second.style.flex='1 1 0';handle.setAttribute('aria-valuenow',String(Math.round(bounded*100)));if(notify)invoke(onResize,{pane:record.pane,splitId:record.node.id,ratio:bounded});};
    handle.addEventListener('pointerdown',event=>{
      event.preventDefault();event.stopPropagation();handle.setPointerCapture(event.pointerId);document.body.classList.add('group-resizing');
      const move=ev=>{const rect=section.getBoundingClientRect();const ratio=horizontal(record.node)?(ev.clientX-rect.left)/rect.width:(ev.clientY-rect.top)/rect.height;update(ratio);};
      const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);document.body.classList.remove('group-resizing');};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
    });
    handle.addEventListener('keydown',event=>{const left=horizontal(record.node)?'ArrowLeft':'ArrowUp',right=horizontal(record.node)?'ArrowRight':'ArrowDown';if([left,right,'Home'].includes(event.key)){event.preventDefault();event.stopPropagation();update(event.key==='Home'?.5:(Number(record.node.ratio)||.5)+(event.key===right?.03:-.03));}});
    record.update=update;return record;
  }
  function renderNode(node,pane,activeGroupId,seenGroups,seenBranches){
    if(!node)return null;
    if(node.type!=='split'&&!node.children&&!node.first){seenGroups.add(node.id);return updateGroup(node,pane,activeGroupId);}
    seenBranches.add(node.id);
    let branch=branches.get(node.id);if(!branch){branch=makeBranch(node,pane);branches.set(node.id,branch);}
    branch.node=node;branch.pane=pane;branch.section.classList.toggle('group-split-horizontal',horizontal(node));branch.section.classList.toggle('group-split-vertical',!horizontal(node));
    branch.handle.setAttribute('aria-orientation',horizontal(node)?'vertical':'horizontal');branch.update(Number.isFinite(node.ratio)?node.ratio:.5,false);
    const children=branchChildren(node);
    const first=renderNode(children[0],pane,activeGroupId,seenGroups,seenBranches),second=renderNode(children[1],pane,activeGroupId,seenGroups,seenBranches);
    replaceOnlyIfNeeded(branch.first,first?[first]:[]);replaceOnlyIfNeeded(branch.second,second?[second]:[]);
    return branch.section;
  }
  function render(){
    const seenGroups=new Set(),seenBranches=new Set();
    // Clear compatibility IDs before assigning them to the active groups.
    for(const group of groups.values()){group.tabs.removeAttribute('id');for(const record of group.editors.values()){record.editor.removeAttribute('id');record.gutter.removeAttribute('id');record.surface.removeAttribute('id');}}
    for(const pane of ['text','visualizer']){
      const host=hosts[pane];if(!host)continue;host.classList.add('group-host');host.dataset.pane=pane;
      const root=renderNode(getRoot(pane),pane,getActiveGroup(pane),seenGroups,seenBranches);
      replaceOnlyIfNeeded(host,root?[root]:[]);
      const active=groups.get(getActiveGroup(pane));
      if(active){active.tabs.id=`${pane}-tabs`;if(pane==='text'){const record=active.editors.get(active.activeId);if(record){record.editor.id='editor';record.gutter.id='line-gutter';record.surface.id='editor-surface';}}}
    }
    for(const [id,group] of groups)if(!seenGroups.has(id)){group.observer.disconnect();group.section.remove();groups.delete(id);}
    for(const [id,branch] of branches)if(!seenBranches.has(id)){branch.section.remove();branches.delete(id);}
  }
  function setOptions(options={}){
    const nextFont=Math.min(28,Math.max(10,Number(options.fontSize)||fontSize));
    const nextWrap=typeof options.wrap==='boolean'?options.wrap:wrap;
    if(nextFont===fontSize&&nextWrap===wrap)return;
    fontSize=nextFont;wrap=nextWrap;
    for(const group of groups.values())for(const record of group.editors.values())record.wrapKey=null;
    if(!renderQueued){renderQueued=true;queueMicrotask(()=>{renderQueued=false;render();});}
  }
  return {
    render,setOptions,
    getEditor(groupId){const group=groups.get(groupId);return group?.editors.get(group.activeId)?.editor||null;},
    getGutter(groupId){const group=groups.get(groupId);return group?.editors.get(group.activeId)?.gutter||null;},
    updateGutter(groupId){const group=groups.get(groupId);const record=group?.editors.get(group.activeId);if(record)drawGutter(record);},
    focusGroup(pane,id){const group=groups.get(id);if(!group||group.pane!==pane)return;const record=group.editors.get(group.activeId);if(record)record.editor.focus();else group.tabs.querySelector('.tab.active')?.focus();}
  };
}
