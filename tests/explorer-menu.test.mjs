import test from 'node:test';
import assert from 'node:assert/strict';
import {explorerMenus,isWithin,remapPath} from '../src/explorer-menu.mjs';

test('workspace root menu exactly includes the nine O actions from image 1',()=>{
  assert.deepEqual(explorerMenus.root.filter(Boolean).map(row=>row[0]),['new-file','new-folder','reveal','images','add-root','remove-root','timeline','paste','copy-path']);
});
test('file menu exactly includes the eight O actions from image 2',()=>{
  assert.deepEqual(explorerMenus.file.filter(Boolean).map(row=>row[0]),['reveal','compare','cut','copy','copy-path','copy-relative','rename','delete']);
});
test('subfolder menu exactly includes the eleven O actions from image 3',()=>{
  assert.deepEqual(explorerMenus.folder.filter(Boolean).map(row=>row[0]),['new-file','new-folder','reveal','find-folder','cut','copy','paste','copy-path','copy-relative','rename','delete']);
});
test('renaming a directory updates only its descendants, preserving their spelling',()=>{
  assert.equal(remapPath('C:\\Data\\Old\\Readme.txt','C:\\Data\\Old','C:\\Data\\New'),'C:\\Data\\New\\Readme.txt');
  assert.equal(remapPath('C:\\Data\\Older\\Readme.txt','C:\\Data\\Old','C:\\Data\\New'),'C:\\Data\\Older\\Readme.txt');
  assert.equal(isWithin('c:/data/old/file.txt','C:\\Data\\Old'),true);
});
