import {flattenGroups,findGroup,splitGroup,moveToNeighbor,closeGroupTabs,pinTab} from './groups.mjs';
import {activeGroup,closeDocument} from './model.mjs';

export const tabMenuActions=['close','close-others','close-right','close-saved','close-all','copy-path','copy-relative','reveal-file','reveal-explorer','pin','split-right','split-move'];
export function createTabController({state,bridge,render,notify,confirmDocument,onEmpty,onActivate,revealInExplorer}){
  const menu=document.createElement('div');menu.className='menu-popup tab-context-menu hidden';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Tab actions');
  const submenu=document.createElement('div');submenu.className='menu-popup tab-split-menu hidden';submenu.setAttribute('role','menu');submenu.setAttribute('aria-label','Split and move');
  document.body.append(menu,submenu);
  let current=null;
  const docFor=id=>state.documents.find(doc=>doc.id===id);
  const refs=id=>['text','visualizer'].flatMap(pane=>flattenGroups(state.layouts[pane])).filter(group=>group.tabs.includes(id));
  function hide(){menu.classList.add('hidden');submenu.classList.add('hidden');}
  function groupFor(context){return findGroup(state.layouts[context.pane],context.groupId);}
  async function closeTabs(context,ids){
    const group=groupFor(context);if(!group)return;
    const targets=ids.filter(id=>group.tabs.includes(id));
    for(const id of targets){const doc=docFor(id);if(doc&&refs(id).length===1&&!await confirmDocument(doc))return;}
    state.layouts[context.pane]=closeGroupTabs(state.layouts[context.pane],group.id,targets);
    for(const id of targets)if(!refs(id).length)closeDocument(state,id);
    activeGroup(state,context.pane);if(!state.documents.length)onEmpty();render();
  }
  function split(context,direction,move){
    const result=splitGroup(state.layouts[context.pane],context.groupId,context.docId,direction,{move});
    if(!result)return;
    state.layouts[context.pane]=result.root;state.activeGroups[context.pane]=result.groupId;
    onActivate({pane:context.pane,groupId:result.groupId,docId:context.docId});
  }
  async function run(action,context=current){
    hide();if(!context)return;const group=groupFor(context),doc=docFor(context.docId);if(!group||!doc)return;
    try{
      const unpinned=id=>!group.pinned.includes(id);
      if(action==='close')return await closeTabs(context,[doc.id]);
      if(action==='close-others')return await closeTabs(context,group.tabs.filter(id=>id!==doc.id&&unpinned(id)));
      if(action==='close-right')return await closeTabs(context,group.tabs.slice(group.tabs.indexOf(doc.id)+1).filter(unpinned));
      if(action==='close-saved')return await closeTabs(context,group.tabs.filter(id=>unpinned(id)&&docFor(id)?.path&&!docFor(id).dirty));
      if(action==='close-all')return await closeTabs(context,group.tabs.filter(unpinned));
      if(action==='pin'){pinTab(group,doc.id,!group.pinned.includes(doc.id));render();return;}
      if(action==='copy-path'||action==='copy-relative'){if(doc.path){await bridge.copyPath({path:doc.path,relative:action==='copy-relative'});notify('Path copied.');}return;}
      if(action==='reveal-file'){if(doc.path)await bridge.showInFolder(doc.path);return;}
      if(action==='reveal-explorer'){revealInExplorer(doc);return;}
      if(action==='split-right'){split(context,'right',false);return;}
      if(action==='split-in-group'){split(context,'right',false);return;}
      if(action.startsWith('split-')){split(context,action.slice(6),true);return;}
      if(action.startsWith('move-')){
        const result=moveToNeighbor(state.layouts[context.pane],context.groupId,doc.id,action.slice(5));
        if(!result){notify('There is no group in that direction. Split this group first.');return;}
        state.layouts[context.pane]=result.root;state.activeGroups[context.pane]=result.groupId;onActivate({pane:context.pane,groupId:result.groupId,docId:doc.id});
      }
    }catch(error){notify(error.message?.replace(/^Error invoking remote method '[^']+': Error: /,'')||'Could not complete this tab action.',true);}
  }
  function row(action,label,shortcut='',disabled=false){const button=document.createElement('button');button.className='menu-item';button.setAttribute('role','menuitem');button.dataset.tabAction=action;button.disabled=disabled;const text=document.createElement('span');text.textContent=label;button.append(text);if(shortcut){const key=document.createElement('kbd');key.textContent=shortcut;button.append(key);}return button;}
  function separator(container){const line=document.createElement('div');line.className='menu-separator';container.append(line);}
  function showSubmenu(anchor){
    submenu.replaceChildren();
    [['split-up','Split Up'],['split-down','Split Down'],['split-left','Split Left'],['split-right-move','Split Right'],null,['move-up','Move Above'],['move-down','Move Below'],['move-left','Move Left'],['move-right','Move Right'],null,['split-in-group','Split in Group']].forEach(item=>item?submenu.append(row(...item)):separator(submenu));
    const rect=anchor.getBoundingClientRect();submenu.classList.remove('hidden');
    const left=rect.right+4+submenu.offsetWidth<innerWidth?rect.right+4:Math.max(6,rect.left-submenu.offsetWidth-4);
    submenu.style.left=`${left}px`;submenu.style.top=`${Math.max(6,Math.min(rect.top,innerHeight-submenu.offsetHeight-6))}px`;
  }
  function show(context){
    if(document.querySelector('dialog[open]'))return;
    hide();current={...context};document.querySelector('#menu-popup')?.classList.add('hidden');document.querySelector('.explorer-context-menu')?.classList.add('hidden');
    const group=groupFor(context),doc=docFor(context.docId);if(!group||!doc)return;
    menu.replaceChildren();
    const definitions=[['close','Close','Ctrl+F4'],['close-others','Close Others'],['close-right','Close to the Right'],['close-saved','Close Saved'],['close-all','Close All','Ctrl+K W'],null,['copy-path','Copy Path','Shift+Alt+C',!doc.path],['copy-relative','Copy Relative Path','Ctrl+K Ctrl+Shift+C',!doc.path],null,['reveal-file','Reveal in File Explorer','Shift+Alt+R',!doc.path],['reveal-explorer','Reveal in Explorer View'],null,['pin',group.pinned.includes(doc.id)?'Unpin':'Pin','Ctrl+Shift+Enter'],null,['split-right','Split Right','Ctrl+\\'],['split-move','Split & Move','›']];
    definitions.forEach(item=>item?menu.append(row(...item)):separator(menu));
    menu.classList.remove('hidden');menu.style.left=`${Math.max(6,Math.min(context.x,innerWidth-menu.offsetWidth-6))}px`;menu.style.top=`${Math.max(6,Math.min(context.y,innerHeight-menu.offsetHeight-6))}px`;
    menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
  menu.addEventListener('pointerover',event=>{const button=event.target.closest('[data-tab-action]');if(button?.dataset.tabAction==='split-move')showSubmenu(button);else if(button)submenu.classList.add('hidden');});
  menu.addEventListener('click',event=>{const button=event.target.closest('[data-tab-action]');if(!button||button.disabled)return;if(button.dataset.tabAction==='split-move'){showSubmenu(button);submenu.querySelector('button')?.focus();}else run(button.dataset.tabAction);});
  submenu.addEventListener('click',event=>{const button=event.target.closest('[data-tab-action]');if(!button)return;const action=button.dataset.tabAction;if(action==='split-right-move'){hide();split(current,'right',true);}else run(action);});
  for(const popup of [menu,submenu])popup.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();hide();return;}
    if(event.key==='ArrowRight'&&document.activeElement?.dataset.tabAction==='split-move'){event.preventDefault();showSubmenu(document.activeElement);submenu.querySelector('button')?.focus();return;}
    if(event.key==='ArrowLeft'&&popup===submenu){event.preventDefault();submenu.classList.add('hidden');menu.querySelector('[data-tab-action=split-move]')?.focus();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...popup.querySelectorAll('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target)&&!submenu.contains(event.target))hide();});window.addEventListener('resize',hide);
  return {show,hide,run,close:context=>run('close',context)};
}
