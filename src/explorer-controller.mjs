import {explorerMenus,normalizePath,isWithin,remapPath} from './explorer-menu.mjs';
import {openCompare,openImageGallery,openFolderSearch,openTimeline} from './explorer-views.mjs';

export function createExplorer(options){
  const {element,list,dialog,bridge,icon,escape,getDocuments,getActiveId,openPaths,notify,renderAll,onMoved,onDeleted,beforeDelete,getSnapshot,onOpenResult,onOpenVersion}=options;
  let roots=[],selected=null,clipboard=null,compareSelection=null,busy=false,chord=false;
  let anchor=null,dragItems=null,dragBadge=null,unsavedDropNotice=false;
  const selection=new Map();
  const collapsed=new Set();
  const popup=document.createElement('div');
  popup.className='menu-popup explorer-context-menu hidden';
  popup.setAttribute('role','menu');popup.setAttribute('aria-label','Explorer actions');
  document.body.append(popup);
  const pathName=value=>String(value).split(/[\\/]/).filter(Boolean).pop()||value;
  const rootFor=value=>roots.filter(root=>isWithin(value,root.path)).sort((a,b)=>b.path.length-a.path.length)[0];
  const samePath=(a,b)=>normalizePath(a)===normalizePath(b);
  function hide(){popup.classList.add('hidden');}
  function itemFrom(row){
    if(!row)return null;
    const path=row.dataset.entryPath||null;
    const kind=row.dataset.entryKind;
    return {path,name:row.dataset.entryName||pathName(path),kind,type:kind==='file'?'file':'directory',rootPath:row.dataset.rootPath||rootFor(path)?.path,docId:row.dataset.doc,rowId:row.dataset.selectionId};
  }
  const itemKey=item=>item?.path?normalizePath(item.path):`document:${item?.docId}`;
  function paintSelection(){list.querySelectorAll('[data-entry-kind]').forEach(row=>{const active=selection.has(itemKey(itemFrom(row)));row.classList.toggle('selected',active);row.setAttribute('aria-pressed',String(active));});}
  function reconcileSelection(){
    const entries=[...list.querySelectorAll('[data-entry-kind]')].map(itemFrom);
    const previous=[...selection.values()],primary=selected;
    const anchored=previous.find(item=>item.rowId===anchor)||(primary?.rowId===anchor?primary:null);
    const currentItem=item=>{
      if(!item)return null;
      // Document IDs remain stable across Save As; paths do not. Prefer the same
      // row when possible so Open Files and folder-tree copies stay distinguishable.
      return entries.find(entry=>entry.rowId===item.rowId)
        ||(item.docId&&entries.find(entry=>entry.docId===item.docId))
        ||entries.find(entry=>itemKey(entry)===itemKey(item))||null;
    };
    selection.clear();
    for(const item of previous){const entry=currentItem(item);if(entry)selection.set(itemKey(entry),entry);}
    const nextPrimary=currentItem(primary);
    selected=nextPrimary&&selection.has(itemKey(nextPrimary))?selection.get(itemKey(nextPrimary)):[...selection.values()].at(-1)||null;
    if(!entries.some(item=>item.rowId===anchor))anchor=currentItem(anchored)?.rowId||null;
    paintSelection();
  }
  function select(item,{toggle=false,range=false,additive=false}={}){
    if(!item){selected=null;selection.clear();anchor=null;paintSelection();return;}
    const key=itemKey(item),rows=[...list.querySelectorAll('[data-entry-kind]')];
    const rowId=item.rowId||rows.find(row=>itemKey(itemFrom(row))===key)?.dataset.selectionId;
    if(range&&anchor){
      const first=rows.findIndex(row=>row.dataset.selectionId===anchor),last=rows.findIndex(row=>row.dataset.selectionId===rowId);
      if(first>=0&&last>=0){if(!additive)selection.clear();for(const row of rows.slice(Math.min(first,last),Math.max(first,last)+1)){const entry=itemFrom(row);selection.set(itemKey(entry),entry);}}
      else{selection.clear();selection.set(key,item);anchor=rowId;}
    }else if(toggle){selection.has(key)?selection.delete(key):selection.set(key,item);anchor=rowId;}
    else{selection.clear();selection.set(key,item);anchor=rowId;}
    selected=selection.has(key)?selection.get(key):[...selection.values()].at(-1)||null;paintSelection();
  }
  function rowAttributes(item){return `data-entry-kind="${item.kind}" data-entry-name="${escape(item.name)}" data-selection-id="${escape(item.rowId||`${item.rootPath||'workspace'}|${itemKey(item)}`)}" aria-pressed="${selection.has(itemKey(item))}"${item.path?` data-entry-path="${escape(item.path)}"`:''}${item.rootPath?` data-root-path="${escape(item.rootPath)}"`:''}`;}
  function rowClasses(item){return [selection.has(itemKey(item))?'selected':'',clipboard?.mode==='cut'&&samePath(item.path,clipboard.path)?'cut-entry':'',compareSelection?.path&&samePath(item.path,compareSelection.path)?'compare-selected':''].filter(Boolean).join(' ');}
  function fileRow(entry,depth,rootPath,doc,scope=rootPath){
    const item={...entry,kind:'file',rootPath,docId:doc?.id,rowId:`${scope}|${entry.path?normalizePath(entry.path):doc?.id}`};
    return `<button class="file-row ${doc?.id===getActiveId()?'active':''} ${rowClasses(item)}" ${rowAttributes(item)} ${doc?`data-doc="${escape(doc.id)}"`:`data-file-path="${escape(entry.path)}"`} draggable="true" style="padding-left:${18+depth*14}px" title="${escape(entry.path||entry.name)}">${icon('file')}<span>${escape(entry.name)}</span>${doc?.dirty?'<i class="dirty-mark"></i>':''}</button>`;
  }
  function render(){
    const docs=getDocuments();
    const findDoc=path=>docs.find(doc=>doc.path&&samePath(doc.path,path));
    const branch=(entries,rootPath,depth)=>entries.map(entry=>{
      if(entry.type==='file')return fileRow(entry,depth,rootPath,findDoc(entry.path));
      const item={...entry,kind:'folder',rootPath};
      const isCollapsed=collapsed.has(normalizePath(entry.path));
      return `<button class="tree-folder ${rowClasses(item)}" ${rowAttributes(item)} draggable="true" data-explorer-folder="${escape(entry.path)}" aria-expanded="${!isCollapsed}" style="padding-left:${9+depth*14}px" title="${escape(entry.path)}">${icon(isCollapsed?'right':'down')}${icon('folder')}<span>${escape(entry.name)}</span></button>${isCollapsed?'':branch(entry.children||[],rootPath,depth+1)}`;
    }).join('');
    let html='';
    if(docs.length){html='<div class="explorer-section-label">OPEN FILES</div>'+docs.map(doc=>fileRow(doc,0,rootFor(doc.path)?.path,doc,'open')).join('');}
    for(const root of roots){
      const item={...root,kind:'root',rootPath:root.path};
      const isCollapsed=collapsed.has(normalizePath(root.path));
      html+=`<button class="tree-folder workspace-root ${rowClasses(item)}" ${rowAttributes(item)} data-explorer-folder="${escape(root.path)}" aria-expanded="${!isCollapsed}" title="${escape(root.path)}">${icon(isCollapsed?'right':'down')}<span>${escape(root.name)}</span></button>${isCollapsed?'':branch(root.entries||[],root.path,1)}`;
    }
    if(!html)html='<div class="explorer-empty">Your open files appear here.<br><button data-action="open-folder">Open a folder</button> to explore.</div>';
    list.innerHTML=html;
    reconcileSelection();
    element.querySelector('#folder-label').textContent='WORKSPACE';
    const toolbar=element.querySelector('#add-file-button');
    toolbar.title=roots.length?'New file in selected folder':'New document';
  }
  async function refresh(){roots=await bridge.refreshWorkspace();clipboard=await bridge.getFileClipboard();render();return roots;}
  async function addFolder(){const result=await bridge.addWorkspaceFolder();if(result){await refresh();select({...result,kind:'root',rootPath:result.path});renderAll();}return result;}
  function hydrate(folders){roots=Array.isArray(folders)?folders:[];render();}
  function allowed(action,item){
    if(action==='add-root')return true;
    if(!item?.path)return false;
    if(action==='paste')return Boolean(clipboard)&&item.kind!=='file';
    return true;
  }
  function showContext(item,x,y){
    if(dialog.open)return;
    select(item);
    document.querySelector('#menu-popup')?.classList.add('hidden');
    const entries=explorerMenus[item.kind]||explorerMenus.root;
    popup.innerHTML=entries.map(row=>{
      if(!row)return '<div class="menu-separator"></div>';
      const [action,label,shortcut]=row;
      const title=action==='compare'&&compareSelection&&!samePath(compareSelection.path,item.path)?'Compare with Selected':label;
      return `<button class="menu-item ${action==='delete'?'danger-item':''}" role="menuitem" data-explorer-action="${action}" ${allowed(action,item)?'':'disabled'}><span>${title}</span>${shortcut?`<kbd>${shortcut}</kbd>`:''}</button>`;
    }).join('');
    popup.classList.remove('hidden');
    popup.style.left=`${Math.max(6,Math.min(x,innerWidth-popup.offsetWidth-6))}px`;
    popup.style.top=`${Math.max(6,Math.min(y,innerHeight-popup.offsetHeight-6))}px`;
    popup.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  function promptName(title,initial,submit){
    hide();
    dialog.className='';dialog.removeAttribute('aria-labelledby');
    dialog.innerHTML=`<div class="dialog-heading"><h2>${escape(title)}</h2><button class="icon-button explorer-dialog-close" aria-label="Close dialog">${icon('close')}</button></div><form class="dialog-body entry-name-form"><label for="entry-name">Name</label><input id="entry-name" name="name" type="text" value="${escape(initial)}" autocomplete="off" required maxlength="240"><p class="entry-name-error" role="alert"></p><div class="dialog-form-actions"><button type="button" class="secondary-button explorer-dialog-close">Cancel</button><button class="primary-button" type="submit">${title.startsWith('Rename')?'Rename':'Create'}</button></div></form>`;
    dialog.querySelectorAll('.explorer-dialog-close').forEach(button=>button.addEventListener('click',()=>dialog.close()));
    dialog.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();const button=dialog.querySelector('[type=submit]');button.disabled=true;
      try{await submit(dialog.querySelector('#entry-name').value);dialog.close();}
      catch(error){dialog.querySelector('.entry-name-error').textContent=error.message?.replace(/^Error invoking remote method '[^']+': Error: /,'')||'Could not complete this action.';}
      finally{button.disabled=false;}
    });
    dialog.showModal();const input=dialog.querySelector('#entry-name');input.focus();const dot=initial.lastIndexOf('.');input.setSelectionRange(0,dot>0?dot:initial.length);
  }
  function moved(result){
    if(!result?.oldPath)return;
    onMoved(result.oldPath,result.path);
    const remap=item=>{if(!item?.path||!isWithin(item.path,result.oldPath))return item;const path=remapPath(item.path,result.oldPath,result.path);return {...item,path,name:pathName(path),rootPath:rootFor(path)?.path,rowId:null};};
    selected=remap(selected);const previousSelection=[...selection.values()];selection.clear();for(const item of previousSelection){const next=remap(item);selection.set(itemKey(next),next);}anchor=null;
    if(compareSelection?.path&&isWithin(compareSelection.path,result.oldPath))compareSelection={...compareSelection,path:remapPath(compareSelection.path,result.oldPath,result.path),name:pathName(remapPath(compareSelection.path,result.oldPath,result.path))};
    const previous=[...collapsed];collapsed.clear();previous.forEach(value=>collapsed.add(normalizePath(remapPath(value,result.oldPath,result.path))));
  }
  async function run(action,item=selected){
    hide();if(busy||!allowed(action,item))return;
    try{
      switch(action){
        case 'add-root':await addFolder();break;
        case 'remove-root':roots=await bridge.removeWorkspaceFolder(item.path);select(null);renderAll();notify('Folder removed from the workspace. Its files are unchanged.');break;
        case 'new-file':case 'new-folder':{
          const type=action==='new-file'?'file':'directory';
          promptName(type==='file'?'New File':'New Folder',type==='file'?'Untitled.dv':'New folder',async name=>{
            const result=await bridge.createEntry({parentPath:item.path,name,type});collapsed.delete(normalizePath(item.path));await refresh();if(type==='file')await openPaths([result.path]);renderAll();
          });break;
        }
        case 'reveal':await bridge.showInFolder(item.path);break;
        case 'copy-path':case 'copy-relative':await bridge.copyPath({path:item.path,...(action==='copy-relative'?(item.rootPath?{relativeTo:item.rootPath}:{relative:true}):{})});notify(action==='copy-path'?'Path copied.':'Relative path copied.');break;
        case 'cut':case 'copy':clipboard=await bridge.setFileClipboard({path:item.path,mode:action});render();notify(`${item.name} ready to ${action==='cut'?'move':'copy'}. Select a destination folder and paste.`);break;
        case 'paste':{
          busy=true;const result=await bridge.pasteEntry(item.path);if(result){if(result.mode==='cut')moved(result);collapsed.delete(normalizePath(item.path));await refresh();renderAll();notify(`${result.name||pathName(result.path)} ${result.mode==='cut'?'moved':'copied'}.`);}break;
        }
        case 'rename':promptName('Rename',item.name,async name=>{const result=await bridge.renameEntry({path:item.path,name});moved(result);await refresh();renderAll();});break;
        case 'delete':{
          busy=true;if(!await beforeDelete(item.path))return;
          const result=await bridge.deleteEntry(item.path);
          if(result){onDeleted(item.path);if(compareSelection?.path&&isWithin(compareSelection.path,item.path))compareSelection=null;select(null);await refresh();renderAll();notify(`${item.name} permanently deleted.`);}break;
        }
        case 'compare':{
          if(!compareSelection||samePath(compareSelection.path,item.path)){compareSelection={path:item.path,name:item.name};render();notify(`${item.name} selected. Right-click another file and choose Compare with Selected.`);}
          else{const first=await getSnapshot(compareSelection),second=await getSnapshot(item);if(first&&second)openCompare({dialog,first,second});}
          break;
        }
        case 'find-folder':openFolderSearch({dialog,folder:item,onSearch:query=>bridge.findInFolder({path:item.path,query}),onOpenResult});break;
        case 'images':{
          const result=await bridge.getFolderImages(item.path);openImageGallery({dialog,folder:item,images:result.images,onOpenImage:path=>bridge.openImage(typeof path==='string'?path:path.path)});if(result.truncated)notify('Showing the first 120 images in this folder.');break;
        }
        case 'timeline':{
          const entries=await bridge.getFolderTimeline(item.path);openTimeline({dialog,folder:item,entries,onOpen:onOpenVersion});break;
        }
      }
    }catch(error){notify(error.message?.replace(/^Error invoking remote method '[^']+': Error: /,'')||'Could not complete this action.',true);}
    finally{busy=false;}
  }
  element.addEventListener('contextmenu',event=>{
    event.preventDefault();
    const row=event.target.closest('[data-entry-kind]');
    const item=itemFrom(row)||{...(roots[0]||{}),kind:'root'};
    // Reading clipboard state is local and leaves the selected file untouched.
    bridge.getFileClipboard().then(value=>{clipboard=value;showContext(item,event.clientX,event.clientY);}).catch(error=>notify(error.message,true));
  });
  element.addEventListener('click',event=>{
    const row=event.target.closest('[data-entry-kind]');
    if(row){select(itemFrom(row),{toggle:event.ctrlKey||event.metaKey,range:event.shiftKey,additive:event.ctrlKey||event.metaKey});if(event.ctrlKey||event.metaKey||event.shiftKey){event.preventDefault();event.stopPropagation();return;}}
    const folderButton=event.target.closest('[data-explorer-folder]');
    if(folderButton){const key=normalizePath(folderButton.dataset.explorerFolder);collapsed.has(key)?collapsed.delete(key):collapsed.add(key);render();list.querySelectorAll('[data-entry-path]').forEach(node=>{if(samePath(node.dataset.entryPath,selected.path))node.focus({preventScroll:true});});}
  });
  popup.addEventListener('click',event=>{const button=event.target.closest('[data-explorer-action]');if(button&&!button.disabled)run(button.dataset.explorerAction);});
  popup.addEventListener('keydown',event=>{
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const buttons=[...popup.querySelectorAll('button:not(:disabled)')];let index=buttons.indexOf(document.activeElement);index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;buttons[index]?.focus();}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();focusSelected();}
  });
  function focusSelected(){list.querySelectorAll('[data-entry-kind]').forEach(row=>{if(selected&&(selected.path?samePath(row.dataset.entryPath,selected.path):row.dataset.doc===selected.docId))row.focus({preventScroll:true});});}
  function clearDropTarget(){list.querySelectorAll('.drop-folder-target').forEach(row=>row.classList.remove('drop-folder-target'));}
  function endDrag(){dragItems=null;dragBadge?.remove();dragBadge=null;unsavedDropNotice=false;clearDropTarget();list.querySelectorAll('.dragging-entry').forEach(row=>row.classList.remove('dragging-entry'));}
  function draggedPaths(event){
    if(dragItems)return dragItems.filter(item=>item.path&&item.kind!=='root').map(item=>item.path);
    try{const data=JSON.parse(event.dataTransfer?.getData('application/x-dv-explorer')||'null');return Array.isArray(data?.paths)?data.paths.filter(path=>typeof path==='string'&&path):[];}catch{return [];}
  }
  function hasUnsavedDrag(event){
    if(dragItems)return dragItems.some(item=>!item.path);
    try{return Boolean(JSON.parse(event.dataTransfer?.getData('application/x-dv-explorer')||'null')?.hasUnsaved);}catch{return false;}
  }
  function validDestination(item,paths){
    return !busy&&item?.path&&item.kind!=='file'&&paths.length>0&&!paths.some(path=>isWithin(item.path,path)||roots.some(root=>isWithin(root.path,path)));
  }
  list.addEventListener('dragstart',event=>{
    const row=event.target.closest('[data-entry-kind]'),item=itemFrom(row);
    if(!item||!event.dataTransfer)return;
    event.stopPropagation();
    if(busy||item.kind==='root'){event.preventDefault();return;}
    hide();if(!selection.has(itemKey(item)))select(item);
    dragItems=[...selection.values()].filter(entry=>entry.kind!=='root');
    const paths=dragItems.filter(entry=>entry.path).map(entry=>entry.path);
    const files=dragItems.filter(entry=>entry.kind==='file');
    event.dataTransfer.setData('application/x-dv-explorer',JSON.stringify({paths,hasUnsaved:dragItems.some(entry=>!entry.path)}));
    event.dataTransfer.setData('application/x-dv-tab',JSON.stringify({paths:files.filter(entry=>entry.path).map(entry=>entry.path),ids:files.filter(entry=>!entry.path&&entry.docId).map(entry=>entry.docId)}));
    event.dataTransfer.effectAllowed='copyMove';
    list.querySelectorAll('[data-entry-kind]').forEach(node=>node.classList.toggle('dragging-entry',selection.has(itemKey(itemFrom(node)))&&node.dataset.entryKind!=='root'));
    dragBadge=document.createElement('div');dragBadge.className='explorer-drag-badge';dragBadge.textContent=dragItems.length===1?item.name:`${dragItems.length} items`;document.body.append(dragBadge);event.dataTransfer.setDragImage?.(dragBadge,12,14);
  });
  element.addEventListener('dragover',event=>{
    if(!event.dataTransfer?.types.includes('application/x-dv-explorer'))return;
    event.preventDefault();event.stopPropagation();clearDropTarget();
    const row=event.target.closest('[data-entry-kind]'),item=itemFrom(row);
    const unsaved=hasUnsavedDrag(event),valid=!unsaved&&validDestination(item,draggedPaths(event));
    if(unsaved&&item?.kind!=='file'&&item?.path&&!unsavedDropNotice){unsavedDropNotice=true;notify('Save new documents before moving them into folders.');}
    event.dataTransfer.dropEffect=valid?'move':'none';if(valid)row.classList.add('drop-folder-target');
    const rect=list.getBoundingClientRect();if(event.clientY<rect.top+30)list.scrollTop-=12;else if(event.clientY>rect.bottom-30)list.scrollTop+=12;
  });
  element.addEventListener('dragleave',event=>{if(!element.contains(event.relatedTarget))clearDropTarget();});
  element.addEventListener('drop',async event=>{
    if(!event.dataTransfer?.types.includes('application/x-dv-explorer'))return;
    event.preventDefault();event.stopPropagation();
    const item=itemFrom(event.target.closest('[data-entry-kind]')),paths=draggedPaths(event),unsaved=hasUnsavedDrag(event),valid=!unsaved&&validDestination(item,paths);endDrag();
    if(unsaved&&item?.kind!=='file'&&item?.path){notify('Save new documents before moving them into folders.');return;}
    if(!valid){if(item&&paths.length&&!busy)notify('Choose a destination folder outside the items you are moving.',true);return;}
    busy=true;
    try{
      const result=await bridge.moveEntries({paths,destinationPath:item.path});
      for(const entry of result.moved||[])moved(entry);
      collapsed.delete(normalizePath(item.path));await refresh();renderAll();
      const count=(result.moved||[]).filter(entry=>!entry.unchanged).length,failures=result.failed||[];
      if(failures.length)notify(`${count} ${count===1?'item':'items'} moved. ${failures.length} could not be moved. ${failures.slice(0,3).map(failure=>`${pathName(failure.path)}: ${failure.message}`).join(' ')}`,true);
      else notify(count?`${count} ${count===1?'item':'items'} moved to ${item.name}.`:'The selected items are already in this folder.');
    }catch(error){notify(error.message?.replace(/^Error invoking remote method '[^']+': Error: /,'')||'Could not move the selected items.',true);}
    finally{busy=false;}
  });
  document.addEventListener('dragend',endDrag);
  window.addEventListener('blur',endDrag);
  document.addEventListener('pointerdown',event=>{if(!popup.contains(event.target))hide();});
  window.addEventListener('resize',hide);
  list.addEventListener('keydown',event=>{
    const item=itemFrom(event.target.closest('[data-entry-kind]'))||selected;
    if(!item)return;
    if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();const rect=event.target.getBoundingClientRect();showContext(item,rect.left+20,rect.bottom);return;}
    let action;
    const key=event.key.toLowerCase();
    if((event.ctrlKey||event.metaKey)&&key==='a'){event.preventDefault();event.stopPropagation();selection.clear();for(const row of list.querySelectorAll('[data-entry-kind]')){const entry=itemFrom(row);if(entry.kind!=='root')selection.set(itemKey(entry),entry);}selected=selection.get(itemKey(item))||[...selection.values()].at(-1)||null;paintSelection();return;}
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();const rows=[...list.querySelectorAll('[data-entry-kind]')],index=rows.indexOf(event.target.closest('[data-entry-kind]')),next=rows[Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)))];if(next){select(itemFrom(next),{range:event.shiftKey,additive:event.ctrlKey||event.metaKey});next.focus();}return;}
    if(chord){chord=false;if(event.ctrlKey&&event.shiftKey&&key==='c')action='copy-relative';}
    if(event.ctrlKey&&key==='k'){chord=true;event.preventDefault();event.stopPropagation();return;}
    if(event.key==='F2')action='rename';
    if(event.key==='Delete')action='delete';
    if(event.ctrlKey&&!event.shiftKey&&['x','c','v'].includes(key))action={x:'cut',c:'copy',v:'paste'}[key];
    if(event.shiftKey&&event.altKey&&key==='r')action='reveal';
    if(event.shiftKey&&event.altKey&&key==='c')action='copy-path';
    if(event.shiftKey&&event.altKey&&key==='f')action='find-folder';
    if(action&&explorerMenus[item.kind].some(row=>row?.[0]===action)){event.preventDefault();event.stopPropagation();if(selection.has(itemKey(item)))run(action,item);}
  });
  return {render,refresh,hydrate,addFolder,hide,revealDocument(doc){select({path:doc.path,name:doc.name,kind:'file',docId:doc.id,rootPath:rootFor(doc.path)?.path});render();const row=[...list.querySelectorAll('[data-doc]')].find(node=>node.dataset.doc===doc.id);row?.scrollIntoView({block:'nearest'});row?.focus({preventScroll:true});},newFileInSelection(){const parent=selected?.kind==='file'?rootFor(selected.path):selected;const target=parent?.path?parent:roots[0];if(target){run('new-file',{...target,kind:target.kind||'root'});return true;}return false;}};
}
