import {createWorkspace,openDocument,updateContent,closeDocument,setLayout,markSaved,activeDocument,activeGroup,lineCount,serializePreferences} from './model.mjs';
import {createExplorer} from './explorer-controller.mjs';
import {isWithin,normalizePath,remapPath} from './explorer-menu.mjs';
import {createGroupView} from './group-view.mjs';
import {createTabController} from './tab-controller.mjs';
import {findGroup,closeGroupTabs,reorderGroupTab,moveTabBetweenGroups,pinTab,dropTabToSplit,insertGroupAtEdge} from './groups.mjs';

const $ = (selector) => document.querySelector(selector);
const state = createWorkspace();
const bridge = window.dv;
let editor = document.createElement('textarea');
const viewPositions = new Map();
let recent = [], isHome = true, currentEditorId = null, menuName = null;
let wrap = false, fontSize = 14, closing = false, dragInfo = null, findIndex = -1, activePane = 'text';
let toastTimer, resizeObserver, saveInFlight = null, tabChordUntil = 0;
const paths = {
  home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  files:'M8 3h8l4 4v13H8Z M16 3v5h4 M4 7v14h12',
  file:'M6 3h8l4 4v14H6Z M14 3v5h4',
  folder:'M3 6h6l2 2h10v12H3Z',
  folderOpen:'M3 19V5h6l2 2h9v4 M3 19l3-8h16l-3 8Z',
  search:'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5-2 6 6',
  plus:'M12 5v14 M5 12h14',
  newFile:'M13 3H6v18h12V8l-5-5v5h5 M9 14h6 M12 11v6',
  history:'M3 4v5h5 M3.5 9a9 9 0 1 1-.2 6 M12 7v5l3 2',
  layout:'M3 4h18v16H3Z M11 4v16',
  text:'M5 5h14 M12 5v14 M8 19h8',
  chart:'M4 4v16h17 M8 15l4-5 4 3 5-7',
  down:'m7 10 5 5 5-5',
  left:'m14 6-6 6 6 6',
  right:'m9 6 6 6-6 6',
  save:'M5 3h12l4 4v14H3V3Z M7 3v6h10V3 M7 21v-8h10v8',
  help:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01',
  settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  focus:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
  check:'m5 12 4 4L19 6',
  close:'m6 6 12 12 M18 6 6 18'
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const escape = (text) => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

for (const [id,name] of Object.entries({'home-button':'home','explorer-button':'files','search-button':'search','new-button':'newFile','help-button':'help','settings-button':'settings','collapse-button':'left','add-file-button':'newFile','open-folder-button':'folderOpen','save-button':'save','pane-new-button':'plus','welcome-new-icon':'plus','welcome-open-icon':'folderOpen','welcome-folder-icon':'folderOpen'})) $(`#${id}`).innerHTML=icon(name);
$('#history-button').innerHTML=icon('history')+'<span class="button-label">History</span>';
$('#layout-button').innerHTML=icon('layout')+'<span class="button-label">Layout</span>'+icon('down');
$('#text-pane-label').innerHTML=icon('text')+'TEXT';
$('#visual-pane-label').innerHTML=icon('chart')+'VISUALIZER';
try {
  const preferences=JSON.parse(localStorage.getItem('dv.preferences') || '{}');
  if(['split','text','visualizer'].includes(preferences.layout)) state.layout=preferences.layout;
  if(typeof preferences.explorerOpen==='boolean') state.explorerOpen=preferences.explorerOpen;
  if(Number.isFinite(preferences.splitRatio)) state.splitRatio=Math.min(.8,Math.max(.2,preferences.splitRatio));
  wrap=preferences.wrap===true;
  fontSize=Math.min(22,Math.max(11,Number(preferences.fontSize)||14));
}catch{}
function remember(){try{localStorage.setItem('dv.preferences',JSON.stringify({...serializePreferences(state),wrap,fontSize}));}catch{}}
function notify(message,error=false){clearTimeout(toastTimer);const el=$('#toast');el.textContent=message;el.classList.toggle('error',error);el.classList.remove('hidden');toastTimer=setTimeout(()=>el.classList.add('hidden'),error?7000:3000);}
async function safely(fn){try{return await fn();}catch(error){notify(error.message?.replace(/^Error invoking remote method '[^']+': Error: /,'') || 'Something went wrong.',true);return null;}}
function syncDirty(){bridge?.setDirty(state.documents.some(doc=>doc.dirty));}
function storePosition(){if(currentEditorId)viewPositions.set(currentEditorId,{start:editor.selectionStart,end:editor.selectionEnd,top:editor.scrollTop,left:editor.scrollLeft});}
function docById(id){return state.documents.find(doc=>doc.id===id);}
function currentPane(){return state.layout==='split'?activePane:state.layout;}
function currentDocument(){return isHome?null:activeDocument(state,currentPane());}
function paneProps(pane){return pane==='text'?['textTabs','activeTextId']:['visualizerTabs','activeVisualizerId'];}
function updateMeta(){
  const doc=currentDocument();
  $('#window-title').textContent=!isHome&&doc?`${doc.dirty?'●  ':''}${doc.name}`:'Data Visualizer';
  document.title=!isHome&&doc?`${doc.name}${doc.dirty?' •':''} — Data Visualizer`:'Data Visualizer';
  $('#document-format').textContent=doc?.name.match(/\.([^.]+)$/)?.[1]?.toUpperCase() || 'Plain text';
  $('#status-message').textContent=doc&&!isHome?(doc.dirty?'Unsaved changes':doc.path?'Saved locally':'New document'):'Local workspace';
  $('#wrap-status').textContent=wrap?'Word wrap':'No wrap';
  document.querySelectorAll('.tab').forEach(tab=>{const d=docById(tab.dataset.id);const close=tab.querySelector('.tab-close');if(close)close.textContent=d?.dirty?'•':'×';});
  syncDirty();
}
function updateCursor(){
  const text=editor.value.slice(0,editor.selectionStart),line=text.split('\n').length,column=text.length-text.lastIndexOf('\n');
  $('#cursor-position').textContent=`Ln ${line}, Col ${column}`;
  $('#line-gutter')?.querySelectorAll('[data-line]').forEach(el=>el.classList.toggle('current',Number(el.dataset.line)===line));
}
function renderGutter(){
  groupView.updateGutter(activeGroup(state).id);
  updateCursor();
}
function activateGroupTab({pane,groupId,docId}){state.activeGroups[pane]=groupId;const group=findGroup(state.layouts[pane],groupId);if(group&&docId)group.activeId=docId;activePane=pane;isHome=false;render();groupView.focusGroup(pane,groupId);}
const tabs=createTabController({state,bridge,render,notify,confirmDocument,onEmpty(){isHome=true;},onActivate:activateGroupTab,revealInExplorer(doc){state.explorerOpen=true;render();explorer.revealDocument(doc);}});
const groupView=createGroupView({
  hosts:{text:$('#text-groups'),visualizer:$('#visualizer-groups')},getRoot:pane=>state.layouts[pane],getActiveGroup:pane=>activeGroup(state,pane).id,getDocument:docById,icon,escape,
  onActivate:activateGroupTab,onClose:context=>tabs.close(context),onContext:context=>{hideMenu();explorer.hide();tabs.show(context);},
  onEdit({docId,content,editor:input}){updateContent(state,docId,content);groupView.render();editor=groupView.getEditor(activeGroup(state).id)||input;updateMeta();renderExplorer();renderGutter();},
  onEditorFocus({groupId,docId,editor:input}){state.activeGroups.text=groupId;state.activeTextId=docId;activePane='text';editor=input;currentEditorId=docId;updateMeta();},
  onCursor(input){if(input===groupView.getEditor(activeGroup(state).id)){editor=input;updateCursor();}},
  onResize({pane,splitId,ratio}){const visit=node=>{if(node.type==='split'){if(node.id===splitId)node.ratio=ratio;else{visit(node.first);visit(node.second);}}};visit(state.layouts[pane]);},
  async onDrop({pane,groupId,targetId,data,files,direction=null,copy=false}){
    await safely(async()=>{
      const target=findGroup(state.layouts[pane],groupId);if(!target)return;
      if(data?.pane&&data.groupId){
        if(!['text','visualizer'].includes(data.pane))return;
        const source=findGroup(state.layouts[data.pane],data.groupId);
        if(!source?.tabs.includes(data.id)||!docById(data.id))return;
        const wasPinned=source.pinned.includes(data.id);
        let destinationId=groupId;
        if(direction){
          const result=data.pane===pane
            ?dropTabToSplit(state.layouts[pane],data.groupId,groupId,data.id,direction,{copy})
            :insertGroupAtEdge(state.layouts[pane],groupId,[data.id],direction,{pinned:wasPinned?[data.id]:[]});
          if(!result)return;
          state.layouts[pane]=result.root;destinationId=result.groupId;
        }else if(data.pane===pane&&!copy){
          const result=moveTabBetweenGroups(state.layouts[pane],data.groupId,groupId,data.id,targetId);
          if(!result)return;
          state.layouts[pane]=result.root;
        }else{
          if(targetId!=null&&!target.tabs.includes(targetId))return;
          if(!target.tabs.includes(data.id))target.tabs.push(data.id);
          if(wasPinned)pinTab(target,data.id,true);
          reorderGroupTab(target,data.id,targetId);target.activeId=data.id;
        }
        if(data.pane!==pane&&!copy){state.layouts[data.pane]=closeGroupTabs(state.layouts[data.pane],data.groupId,[data.id]);activeGroup(state,data.pane);}
        activateGroupTab({pane,groupId:destinationId,docId:data.id});
      }else{
        let filePaths=[],documentIds=[];
        if(Array.isArray(data?.paths)||Array.isArray(data?.ids)){
          filePaths=Array.isArray(data.paths)?data.paths:[];documentIds=Array.isArray(data.ids)?data.ids:[];
        }else if(data?.id)documentIds=[data.id];
        else if(data?.path)filePaths=[data.path];
        else if(files?.length)filePaths=Array.from(files).map(file=>bridge.getPathForFile(file)).filter(Boolean);
        const opened=filePaths.length?await bridge.openPaths(filePaths):[];
        const documents=[...opened,...documentIds.map(docById).filter(Boolean)];if(!documents.length)return;
        // A file read can finish after another group was focused or the drop target was closed.
        let destination=findGroup(state.layouts[pane],groupId)||activeGroup(state,pane);
        if(direction){
          const result=insertGroupAtEdge(state.layouts[pane],destination.id,[],direction);
          if(!result)return;
          state.layouts[pane]=result.root;destination=findGroup(result.root,result.groupId);
        }
        state.activeGroups[pane]=destination.id;addFiles(documents);
        const doc=activeDocument(state,pane);if(doc)activateGroupTab({pane,groupId:destination.id,docId:doc.id});
      }
    });
  }
});
const explorer=createExplorer({
  element:$('#explorer'),list:$('#file-list'),dialog:$('#dialog'),bridge,icon,escape,
  getDocuments:()=>state.documents,getActiveId:()=>isHome?null:state.activeTextId,
  openPaths,notify,renderAll:render,
  onMoved(oldPath,newPath){
    for(const doc of state.documents){if(doc.path&&isWithin(doc.path,oldPath)){doc.path=remapPath(doc.path,oldPath,newPath);doc.name=doc.path.split(/[\\/]/).pop();}}
    recent=recent.map(item=>{const path=remapPath(item.path,oldPath,newPath);return {...item,path,name:path.split(/[\\/]/).pop()};});
  },
  onDeleted(path){for(const doc of [...state.documents])if(doc.path&&isWithin(doc.path,path))closeDocument(state,doc.id);recent=recent.filter(item=>!isWithin(item.path,path));if(!state.documents.length)isHome=true;},
  async beforeDelete(path){for(const doc of state.documents.filter(item=>item.path&&isWithin(item.path,path)))if(!await confirmDocument(doc))return false;return true;},
  async getSnapshot(item){const doc=state.documents.find(entry=>entry.path&&normalizePath(entry.path)===normalizePath(item.path));if(doc)return {...doc,name:`${doc.name}${doc.dirty?' (unsaved)':''}`};return (await bridge.openPaths([item.path]))[0];},
  onOpenVersion(entry){const stamp=new Date(entry.timestamp).toISOString().replace(/[:.]/g,'-').slice(0,19);const name=`${entry.name.replace(/\.[^.]+$/,'')} version ${stamp}.dv`;const doc=openDocument(state,{name,content:''});updateContent(state,doc.id,entry.content);isHome=false;activePane='text';if(state.layout==='visualizer')state.layout='split';render();editor.focus();notify('Saved version opened as a new document.');return true;},
  async onOpenResult(match){
    await openPaths([match.path]);const doc=state.documents.find(entry=>entry.path&&normalizePath(entry.path)===normalizePath(match.path));if(!doc)return false;
    if(state.layout==='visualizer')state.layout='split';state.activeTextId=doc.id;activePane='text';render();
    const lines=editor.value.split('\n');const line=Math.min(lines.length,Math.max(1,match.line));const start=lines.slice(0,line-1).reduce((sum,value)=>sum+value.length+1,0)+Math.max(0,(match.column||1)-1);
    editor.focus();editor.setSelectionRange(start,start);editor.scrollTop=Math.max(0,(line-3)*23);renderGutter();return true;
  }
});
function renderExplorer(){explorer.render();}
function renderRecent(){
  $('#recent-list').innerHTML=recent.length?recent.slice(0,4).map(item=>`<button class="recent-file" data-file-path="${escape(item.path)}" title="${escape(item.path)}">${icon('file')}<span class="recent-name">${escape(item.name)}</span><span class="recent-path">${escape(item.path.replace(/[/\\][^/\\]+$/,''))}</span></button>`).join(''):'<div class="recent-empty">A fresh start. Files you open will appear here.</div>';
}
function render(){
  document.body.classList.toggle('focus-mode',state.focusMode);
  for(const mode of ['split','text','visualizer'])document.body.classList.toggle(`layout-${mode}`,state.layout===mode);
  document.documentElement.style.setProperty('--split',`${state.splitRatio*100}%`);
  document.documentElement.style.setProperty('--editor-size',`${fontSize}px`);
  $('#explorer').classList.toggle('hidden',!state.explorerOpen);
  $('#explorer-button').classList.toggle('active',state.explorerOpen);
  $('#home-button').classList.toggle('active',isHome);
  $('#welcome').classList.toggle('hidden',!isHome);
  $('#workspace').classList.toggle('hidden',isHome);
  $('#exit-focus').classList.toggle('hidden',!state.focusMode);
  renderExplorer();renderRecent();groupView.setOptions({fontSize,wrap});groupView.render();
  const doc=activeDocument(state);
  editor=groupView.getEditor(activeGroup(state).id)||document.createElement('textarea');currentEditorId=doc?.id||null;
  $('#save-button').disabled=!doc;
  updateMeta();requestAnimationFrame(renderGutter);remember();
}
function addFiles(files){if(!files?.length)return;storePosition();for(const file of files){openDocument(state,file);if(file.path){recent=recent.filter(item=>item.path!==file.path);recent.unshift({path:file.path,name:file.name,updatedAt:Date.now()});}}isHome=false;render();editor.focus();}
async function openPaths(paths){await safely(async()=>addFiles(await bridge.openPaths(paths)));}
function newFile(){storePosition();let index=1;while(state.documents.some(d=>d.name===`Untitled ${index}.dv`))index++;openDocument(state,{name:`Untitled ${index}.dv`,content:''});isHome=false;if(state.layout==='visualizer')state.layout='split';render();editor.focus();}
async function save(doc=currentDocument(),saveAs=false){
  if(!doc)return false;
  while(saveInFlight)await saveInFlight.catch(()=>{});
  if(!docById(doc.id))return false;
  const snapshot={id:doc.id,path:doc.path,name:doc.name,content:doc.content,saveAs,occupiedPaths:state.documents.filter(other=>other.id!==doc.id&&other.path).map(other=>other.path)};
  const operation=(async()=>{const result=await safely(()=>bridge.saveFile(snapshot));if(!result)return false;markSaved(state,doc.id,{...result,content:snapshot.content});recent=recent.filter(item=>item.path!==result.path);recent.unshift({path:result.path,name:result.name,updatedAt:Date.now()});await safely(()=>explorer.refresh());render();notify(`Saved ${result.name}`);return !doc.dirty;})();
  saveInFlight=operation;
  try{return await operation;}finally{if(saveInFlight===operation)saveInFlight=null;}
}
async function confirmDocument(doc){if(!doc.dirty)return true;const choice=await bridge.confirmClose(doc.name);if(choice==='cancel')return false;if(choice==='save')return await save(doc);return true;}
async function closeCurrent(){const doc=currentDocument();if(!doc||!await safely(()=>confirmDocument(doc)))return;storePosition();closeDocument(state,doc.id);if(!state.documents.length)isHome=true;render();}
async function closeTab(id,pane){return tabs.close({pane,groupId:activeGroup(state,pane).id,docId:id});}
function setView(layout){setLayout(state,layout);render();}
function toggleFocus(){state.focusMode=!state.focusMode;render();}
function revealEditor(){const doc=currentDocument();if(!doc){notify('Open a document to edit its text.');return false;}storePosition();if(!state.textTabs.includes(doc.id))state.textTabs.push(doc.id);state.activeTextId=doc.id;activePane='text';if(state.layout==='visualizer')state.layout='split';render();return true;}
function editCommand(command){if(!revealEditor())return;editor.focus();document.execCommand(command);if(command!=='selectAll'){const doc=activeDocument(state);if(doc)updateContent(state,doc.id,editor.value);renderGutter();updateMeta();}}
function insertText(text){if(!revealEditor())return;editor.focus();document.execCommand('insertText',false,text);}
function showFind(){if(!revealEditor())return;$('#find-bar').classList.remove('hidden');$('#find-input').focus();$('#find-input').select();}
function findNext(reset=false){const query=$('#find-input').value;if(!query){$('#find-result').textContent='';return;}const text=editor.value.toLowerCase(),needle=query.toLowerCase();let from=reset?0:Math.max(editor.selectionEnd,findIndex+1);let index=text.indexOf(needle,from);if(index<0)index=text.indexOf(needle);findIndex=index;let count=0,pos=0;while((pos=text.indexOf(needle,pos))!==-1){count++;pos+=needle.length;}$('#find-result').textContent=count?`${count} match${count===1?'':'es'}`:'No matches';if(index>=0){editor.focus();editor.setSelectionRange(index,index+query.length);editor.scrollTop=Math.max(0,(lineCount(editor.value.slice(0,index))-3)*23);renderGutter();}}
function showDialog(title,body){hideMenu();$('#dialog').className='';$('#dialog').removeAttribute('aria-labelledby');$('#dialog').innerHTML=`<div id="dialog-content"><div class="dialog-heading"><h2>${escape(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div></div>`;$('#dialog').showModal();}
function shortcuts(){showDialog('Keyboard shortcuts',[['New document','Ctrl N'],['Open files','Ctrl O'],['Save','Ctrl S'],['Save as','Ctrl Shift S'],['Close document','Ctrl W'],['Find in text','Ctrl F'],['Toggle explorer','Ctrl B'],['Focus view','Ctrl Shift M'],['Exit focus','Esc']].map(([name,key])=>`<div class="shortcut-row"><span>${name}</span><kbd>${key}</kbd></div>`).join(''));}
function settings(){showDialog('Editor settings',`<div class="settings-row"><label for="font-size">Text size <span id="font-size-value">${fontSize}px</span></label><input id="font-size" type="range" min="11" max="22" value="${fontSize}"></div><div class="settings-row"><label for="word-wrap">Wrap long lines</label><input id="word-wrap" type="checkbox" ${wrap?'checked':''}></div><p>These preferences are saved on this computer.</p>`);$('#font-size').addEventListener('input',event=>{fontSize=Number(event.target.value);$('#font-size-value').textContent=`${fontSize}px`;render();});$('#word-wrap').addEventListener('change',event=>{wrap=event.target.checked;render();});}
async function history(){const doc=currentDocument();if(!doc?.path){showDialog('Save history','<p>Save a document to start its history. Previous saved versions will appear here.</p>');return;}const versions=await safely(()=>bridge.getHistory(doc.path));if(!versions)return;showDialog('Save history',`<p>${escape(doc.name)}</p>${versions.length?versions.map((v,i)=>`<div class="history-row"><div>${escape(new Date(v.timestamp).toLocaleString())}<small>${v.content.length.toLocaleString()} characters</small></div><button data-restore="${i}">Restore</button></div>`).join(''):'<p>No saved versions yet.</p>'}<div class="history-note">Restoring changes your editor. Save to write the restored version to disk.</div>`);$('#dialog-content').querySelectorAll('[data-restore]').forEach(button=>button.addEventListener('click',async()=>{if(!await safely(()=>confirmDocument(doc)))return;updateContent(state,doc.id,versions[Number(button.dataset.restore)].content);$('#dialog').close();isHome=false;openDocument(state,doc);render();notify('Version restored in the editor.');}));}
const actions={
  home:()=>{storePosition();isHome=true;state.focusMode=false;render();},new:newFile,open:()=>safely(async()=>addFiles(await bridge.openFiles())),
  'open-folder':()=>safely(async()=>{const result=await explorer.addFolder();if(result){state.explorerOpen=true;render();}}),
  save:()=>save(),'save-as':()=>save(currentDocument(),true),close:closeCurrent,
  explorer:()=>{state.explorerOpen=!state.explorerOpen;render();},focus:toggleFocus,
  'layout-split':()=>setView('split'),'layout-text':()=>setView('text'),'layout-visualizer':()=>setView('visualizer'),
  undo:()=>editCommand('undo'),redo:()=>editCommand('redo'),'select-all':()=>editCommand('selectAll'),find:showFind,'find-next':()=>findNext(),
  'close-find':()=>{$('#find-bar').classList.add('hidden');editor.focus();},
  'insert-tab':()=>insertText('  '),'insert-line':()=>insertText('\n'),'insert-date':()=>insertText(new Date().toLocaleDateString()),
  wrap:()=>{wrap=!wrap;render();},indent:()=>indent(false),outdent:()=>indent(true),history,settings,shortcuts,
  about:()=>showDialog('About Data Visualizer','<div class="dialog-logo">DV</div><p>Data Visualizer · Version 0.4.1</p><p>A local workspace for raw text and visualization, with file and folder actions, comparison, image previews, search, and saved history.</p>'),
  'close-dialog':()=>$('#dialog').close(),
  'reveal-file':()=>{const doc=currentDocument();if(doc?.path)safely(()=>bridge.showInFolder(doc.path));else notify('Save the document first.');}
};
function indent(outdent){if(!revealEditor())return;const start=editor.selectionStart,end=editor.selectionEnd;if(start===end&&!outdent){insertText('  ');return;}const lineStart=editor.value.lastIndexOf('\n',start-1)+1;const block=editor.value.slice(lineStart,end);const replacement=block.split('\n').map(line=>outdent?line.replace(/^( {1,2}|\t)/,''):`  ${line}`).join('\n');editor.focus();editor.setSelectionRange(lineStart,end);document.execCommand('insertText',false,replacement);editor.setSelectionRange(lineStart,lineStart+replacement.length);}
const menuDefs={
  file:[['New document','new','Ctrl N'],['Open files…','open','Ctrl O'],['Open folder…','open-folder'],null,['Save','save','Ctrl S'],['Save as…','save-as','Ctrl Shift S'],['Show in folder','reveal-file'],null,['Close document','close','Ctrl W'],['Home','home']],
  edit:[['Undo','undo','Ctrl Z'],['Redo','redo','Ctrl Y'],null,['Select all','select-all','Ctrl A'],['Find in text','find','Ctrl F']],
  insert:[['New line','insert-line'],['Indent','insert-tab','Tab'],['Current date','insert-date']],
  view:[['Toggle explorer','explorer','Ctrl B'],null,['Text only view','layout-text'],['Visualizer only view','layout-visualizer'],['Split view','layout-split'],null,['Focus view','focus','Ctrl Shift M']],
  format:[['Word wrap','wrap'],['Indent selection','indent','Tab'],['Outdent selection','outdent','Shift Tab'],null,['Editor settings…','settings']],
  help:[['Keyboard shortcuts','shortcuts'],['About Data Visualizer','about']],
  layout:[['Text only view','layout-text',null,'text'],['Visualizer only view','layout-visualizer',null,'chart'],['Split view','layout-split',null,'layout'],null,['Focus view','focus','Ctrl Shift M','focus']]
};
function hideMenu(){menuName=null;$('#menu-popup').classList.add('hidden');document.querySelectorAll('[data-menu]').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-expanded','false');});}
function showMenu(name,button){explorer.hide();if(menuName===name){hideMenu();return;}hideMenu();menuName=name;button.classList.add('active');button.setAttribute('aria-expanded','true');const menu=$('#menu-popup');menu.innerHTML=(name==='layout'?'<div class="menu-title">Layout options</div>':'')+menuDefs[name].map(item=>{if(!item)return '<div class="menu-separator"></div>';const [label,action,key,ic]=item;const checked=(action===`layout-${state.layout}`)||(action==='focus'&&state.focusMode)||(action==='wrap'&&wrap)||(action==='explorer'&&state.explorerOpen);return `<button role="menuitem" class="menu-item" data-action="${action}"><span class="check">${checked?icon('check'):ic?icon(ic):''}</span><span>${label}</span>${key?`<kbd>${key}</kbd>`:''}</button>`;}).join('');const box=button.getBoundingClientRect();menu.classList.remove('hidden');menu.style.top=`${box.bottom+5}px`;menu.style.left=`${Math.min(box.left,window.innerWidth-menu.offsetWidth-7)}px`;}
document.addEventListener('click',event=>{
  const menuButton=event.target.closest('[data-menu]');if(menuButton){showMenu(menuButton.dataset.menu,menuButton);return;}
  const actionButton=event.target.closest('[data-action]');if(actionButton){const action=actionButton.dataset.action;if(actionButton.id==='save-button')activePane='text';hideMenu();if(actionButton.id==='add-file-button'&&explorer.newFileInSelection())return;safely(async()=>actions[action]?.());return;}
  if(event.target.closest('.tab[data-group-id]'))return;
  const doc=event.target.closest('[data-doc]');if(doc){addFiles([docById(doc.dataset.doc)]);return;}
  const file=event.target.closest('[data-file-path]');if(file){openPaths([file.dataset.filePath]);return;}
  if(!event.target.closest('#menu-popup'))hideMenu();
});
document.addEventListener('keydown',event=>{
  if($('#dialog').open)return;
  const key=event.key.toLowerCase();
  const groupContext=()=>{const pane=currentPane(),group=activeGroup(state,pane);return {pane,groupId:group.id,docId:isHome?null:group.activeId};};
  if(tabChordUntil>Date.now()){
    tabChordUntil=0;let action;if(key==='w')action='close-all';if(key==='u')action='close-saved';if(event.ctrlKey&&event.shiftKey&&key==='c')action='copy-relative';
    if(action){event.preventDefault();tabs.run(action,groupContext());return;}
  }
  if(event.ctrlKey&&key==='k'){event.preventDefault();tabChordUntil=Date.now()+2000;return;}
  if(event.shiftKey&&event.altKey&&['c','r'].includes(key)){event.preventDefault();tabs.run(key==='c'?'copy-path':'reveal-file',groupContext());return;}
  if(!$('#menu-popup').classList.contains('hidden')&&['ArrowDown','ArrowUp','Escape'].includes(event.key)){event.preventDefault();if(event.key==='Escape'){hideMenu();return;}const buttons=[...$('#menu-popup').querySelectorAll('button')];let index=buttons.indexOf(document.activeElement);index=(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index].focus();return;}
  if(event.key==='Escape'){hideMenu();explorer.hide();if(state.focusMode){state.focusMode=false;render();}$('#find-bar').classList.add('hidden');return;}
  if(event.ctrlKey&&!event.altKey){let action;const key=event.key.toLowerCase();if(key==='n')action='new';if(key==='o')action='open';if(key==='s')action=event.shiftKey?'save-as':'save';if(key==='b')action='explorer';if(key==='f')action='find';if(key==='w')action='close';if(key==='m'&&event.shiftKey)action='focus';if(action){event.preventDefault();safely(async()=>actions[action]());}}
  if(!isHome&&event.ctrlKey&&(event.key==='F4'||event.key==='\\'||(event.shiftKey&&event.key==='Enter'))){event.preventDefault();const pane=currentPane(),group=activeGroup(state,pane);if(group.activeId)tabs.run(event.key==='F4'?'close':event.key==='\\'?'split-right':'pin',{pane,groupId:group.id,docId:group.activeId});}
});
$('#find-input').addEventListener('input',()=>{findIndex=-1;$('#find-result').textContent='';});
$('#find-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();findNext(findIndex<0);}if(event.key==='Escape')actions['close-find']();});
$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog')){const rect=$('#dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('#dialog').close();}});

document.addEventListener('dragstart',event=>{const doc=event.target.closest('[data-doc]'),file=event.target.closest('[data-file-path]');if(doc)dragInfo={id:doc.dataset.doc};else if(file)dragInfo={path:file.dataset.filePath};else return;event.dataTransfer.setData('application/x-dv-tab',JSON.stringify(dragInfo));event.dataTransfer.effectAllowed='copyMove';});
document.addEventListener('dragend',()=>{dragInfo=null;document.querySelectorAll('.dragging,.drop-active,.drop-target').forEach(el=>el.classList.remove('dragging','drop-active','drop-target'));});
document.addEventListener('dragover',event=>event.preventDefault());
document.addEventListener('drop',event=>{event.preventDefault();if(isHome&&event.dataTransfer.files.length){const filePaths=[...event.dataTransfer.files].map(file=>bridge.getPathForFile(file)).filter(Boolean);openPaths(filePaths);}});
$('#split-handle').addEventListener('pointerdown',event=>{event.preventDefault();const handle=event.currentTarget;handle.setPointerCapture(event.pointerId);document.body.classList.add('drag-resizing');const move=ev=>{const rect=$('#workspace').getBoundingClientRect();state.splitRatio=Math.max(.2,Math.min(.8,(ev.clientX-rect.left)/rect.width));document.documentElement.style.setProperty('--split',`${state.splitRatio*100}%`);};const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);document.body.classList.remove('drag-resizing');remember();renderGutter();};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);});
$('#split-handle').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();state.splitRatio=event.key==='Home'?.5:Math.max(.2,Math.min(.8,state.splitRatio+(event.key==='ArrowRight'?.03:-.03)));render();}});
resizeObserver=new ResizeObserver(()=>{if(!isHome)renderGutter();});resizeObserver.observe($('#text-groups'));
window.addEventListener('resize',hideMenu);
bridge?.onFiles(files=>addFiles(files));
bridge?.onRequestClose(async()=>{if(closing)return;closing=true;try{for(const doc of state.documents){if(!await safely(()=>confirmDocument(doc)))return;}bridge.approveClose();}finally{closing=false;}});
render();
if(bridge){const initial=await safely(()=>bridge.getInitialState());if(initial){recent=initial.recent||[];explorer.hydrate(initial.folders||[]);if(initial.files?.length)addFiles(initial.files);else render();}}else{notify('Launch Data Visualizer from its desktop application to open and save local files.',true);}
